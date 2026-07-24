import { listStandingOrders, wholesaleSchedule, getCustomer } from "../store.js";

/**
 * Wholesale deliveries: the days a standing order actually lands.
 *
 * A delivery is DERIVED from its template, never materialized (same doctrine
 * as the commitments in store.js). What this module stores is only what cannot
 * be derived: the two per-date facts of "this one was skipped" and "this one
 * has been packed / handed to the driver".
 *
 * Skips: "not this Tuesday, we are closed" pauses one occurrence, not the
 * template. The cutoff is two days, because by then the kitchen has planned
 * the bake. A skip does NOT free the wholesale pool for that date: the
 * allocation was promised to this account and stays theirs. Freeing it would
 * let another cafe take it, and then an un-skip ("actually we are open after
 * all") could be refused for capacity that was yours all along.
 *
 * Invoices: wholesale runs on invoices, not QRIS holds. An invoice here is a
 * calendar month of non-skipped deliveries, derived on read with a stable
 * number, covering the schedule window. Generating the PDF and recording
 * payment against credit terms is the remaining production work.
 */

const SKIP_CUTOFF_DAYS = 2;

const g = globalThis;
const db = (g.__noisette ??= {});
db.deliverySkips ??= new Map(); // `${standingOrderId}:${date}` -> { at }
db.deliveryStages ??= new Map(); // `${standingOrderId}:${date}` -> "packed" | "delivered"

const key = (soId, date) => `${soId}:${date}`;

const isoDay = (d) => d.toISOString().slice(0, 10);

function earliestSkippable() {
  const d = new Date();
  d.setDate(d.getDate() + SKIP_CUTOFF_DAYS);
  return isoDay(d);
}

function decorate(row) {
  const k = key(row.standingOrderId, row.date);
  const skipped = db.deliverySkips.has(k);
  return {
    ...row,
    skipped,
    stage: skipped ? null : db.deliveryStages.get(k) || "pending", // pending | packed | delivered
  };
}

/** One account's deliveries (the portal), or everyone's (the counter). */
export async function deliveriesFor(customerId) {
  return (await wholesaleSchedule(customerId)).map(decorate);
}

/** The delivery run for one trading day, with names the driver can use. */
export async function deliveriesOn(date) {
  // Fetched once: listStandingOrders() rebuilds and sorts the full list, so
  // calling it inside the map was O(n^2) in standing orders.
  const soById = new Map((await listStandingOrders()).map((s) => [s.id, s]));
  const rows = (await wholesaleSchedule(undefined)).filter((d) => d.date === date).map(decorate);
  const out = [];
  for (const d of rows) {
    const so = soById.get(d.standingOrderId);
    const c = so ? await getCustomer(so.customerId) : null;
    out.push({
      ...d,
      businessName: c?.businessName || c?.name || "?",
      address: c?.address || "",
    });
  }
  return out;
}

/**
 * Skip or un-skip one occurrence. The caller passes the customerId from the
 * session; ownership is checked here so the route cannot forget to.
 */
export async function setDeliverySkipped({ customerId, standingOrderId, date, skip }) {
  const mine = (await listStandingOrders(customerId)).some((s) => s.id === standingOrderId);
  if (!mine) return { error: "not_found" };

  const occurs = (await wholesaleSchedule(customerId)).some(
    (d) => d.standingOrderId === standingOrderId && d.date === date
  );
  if (!occurs) return { error: "no_such_delivery" };

  if (date < earliestSkippable())
    return { error: "too_late", cutoffDays: SKIP_CUTOFF_DAYS };

  const k = key(standingOrderId, date);
  if (db.deliveryStages.has(k)) return { error: "already_in_progress" };

  if (skip) db.deliverySkips.set(k, { at: Date.now() });
  else db.deliverySkips.delete(k);
  return { ok: true, skipped: !!skip };
}

/** pending -> packed -> delivered, forwards only, and never for a skip. */
export async function advanceDelivery(standingOrderId, date) {
  const k = key(standingOrderId, date);
  if (db.deliverySkips.has(k)) return { error: "skipped" };

  const occurs = (await wholesaleSchedule(undefined)).some(
    (d) => d.standingOrderId === standingOrderId && d.date === date
  );
  if (!occurs) return { error: "no_such_delivery" };

  const cur = db.deliveryStages.get(k) || "pending";
  const next = { pending: "packed", packed: "delivered" }[cur];
  if (!next) return { error: "already_delivered" };
  db.deliveryStages.set(k, next);
  return { ok: true, stage: next };
}

/**
 * Invoices for one account: the schedule window's non-skipped deliveries,
 * grouped by calendar month under a stable number. Everything derived; there
 * is no invoice row to drift out of sync with the deliveries it bills.
 */
export async function invoicesFor(customerId) {
  const months = new Map();
  for (const d of await deliveriesFor(customerId)) {
    if (d.skipped) continue;
    const month = d.date.slice(0, 7); // YYYY-MM
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(d);
  }

  return [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, lines]) => ({
      number: `WINV-${month.replace("-", "")}-${customerId}`,
      month,
      lines: lines.map((d) => ({
        date: d.date,
        items: d.items,
        total: d.total,
        delivered: d.stage === "delivered",
      })),
      deliveries: lines.length,
      total: lines.reduce((a, d) => a + d.total, 0),
    }));
}
