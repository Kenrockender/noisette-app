import { listStandingOrders, wholesaleSchedule, getCustomer } from "../store.js";
import { query } from "../db/pg.js";

const SKIP_CUTOFF_DAYS = 2;

const isoDay = (d) => {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
};

function earliestSkippable() {
  const d = new Date();
  d.setDate(d.getDate() + SKIP_CUTOFF_DAYS);
  return isoDay(d);
}

/** One account's deliveries (the portal), or everyone's (the counter). */
export async function deliveriesFor(customerId) {
  const schedule = await wholesaleSchedule(customerId);
  if (schedule.length === 0) return [];
  
  const soIds = [...new Set(schedule.map(s => s.standingOrderId))];
  const dates = [...new Set(schedule.map(s => s.date))];
  
  const overrides = await query(
    `SELECT standing_order_id, delivery_date, skipped, stage 
     FROM delivery_overrides 
     WHERE standing_order_id = ANY($1::bigint[]) AND delivery_date = ANY($2::date[])`,
    [soIds, dates]
  );
  
  const overrideMap = new Map();
  for (const row of overrides.rows) {
    const dateStr = isoDay(row.delivery_date);
    overrideMap.set(`${row.standing_order_id}:${dateStr}`, row);
  }
  
  return schedule.map((row) => {
    const k = `${row.standingOrderId}:${row.date}`;
    const override = overrideMap.get(k);
    const skipped = override?.skipped || false;
    return {
      ...row,
      skipped,
      stage: skipped ? null : (override?.stage || "pending"),
    };
  });
}

/** The delivery run for one trading day, with names the driver can use. */
export async function deliveriesOn(date) {
  const soById = new Map((await listStandingOrders()).map((s) => [s.id, s]));
  const schedule = (await wholesaleSchedule(undefined)).filter((d) => d.date === date);
  if (schedule.length === 0) return [];
  
  const soIds = [...new Set(schedule.map(s => s.standingOrderId))];
  
  const overrides = await query(
    `SELECT standing_order_id, skipped, stage 
     FROM delivery_overrides 
     WHERE delivery_date = $1::date AND standing_order_id = ANY($2::bigint[])`,
    [date, soIds]
  );
  
  const overrideMap = new Map(overrides.rows.map(r => [String(r.standing_order_id), r]));
  
  const out = [];
  for (const row of schedule) {
    const override = overrideMap.get(String(row.standingOrderId));
    const skipped = override?.skipped || false;
    const stage = skipped ? null : (override?.stage || "pending");
    
    const so = soById.get(row.standingOrderId);
    const c = so ? await getCustomer(so.customerId) : null;
    
    out.push({
      ...row,
      skipped,
      stage,
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

  const res = await query(
    `SELECT stage FROM delivery_overrides WHERE standing_order_id = $1 AND delivery_date = $2`,
    [standingOrderId, date]
  );
  if (res.rows.length > 0 && res.rows[0].stage !== 'pending') {
    return { error: "already_in_progress" };
  }

  await query(
    `INSERT INTO delivery_overrides (standing_order_id, delivery_date, skipped, stage)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (standing_order_id, delivery_date) 
     DO UPDATE SET skipped = $3, updated_at = now()`,
    [standingOrderId, date, !!skip]
  );

  return { ok: true, skipped: !!skip };
}

/** pending -> packed -> delivered, forwards only, and never for a skip. */
export async function advanceDelivery(standingOrderId, date) {
  const res = await query(
    `SELECT skipped, stage FROM delivery_overrides WHERE standing_order_id = $1 AND delivery_date = $2`,
    [standingOrderId, date]
  );
  
  if (res.rows.length > 0 && res.rows[0].skipped) {
    return { error: "skipped" };
  }
  
  const occurs = (await wholesaleSchedule(undefined)).some(
    (d) => d.standingOrderId === standingOrderId && d.date === date
  );
  if (!occurs) return { error: "no_such_delivery" };

  const cur = res.rows.length > 0 ? res.rows[0].stage : "pending";
  const next = { pending: "packed", packed: "delivered" }[cur];
  if (!next) return { error: "already_delivered" };

  await query(
    `INSERT INTO delivery_overrides (standing_order_id, delivery_date, stage)
     VALUES ($1, $2, $3)
     ON CONFLICT (standing_order_id, delivery_date)
     DO UPDATE SET stage = $3, updated_at = now()`,
    [standingOrderId, date, next]
  );

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
