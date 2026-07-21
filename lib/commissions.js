import { normalizeWhatsapp } from "./auth.js";

/**
 * Bespoke commissions.
 *
 * Deliberately NOT in daily_inventory, and this file is where that sentence
 * stops being a README note and becomes code. A commission has no allocation
 * to decrement: it is a brief, a quote, a deposit and a date, two weeks out.
 * Its capacity is measured in cakes per week, not units per day, because one
 * wedding cake eats the patissier's Thursday no matter which day it is
 * collected.
 *
 *   enquiry -> quoted -> deposit_paid -> in_production -> ready -> collected
 *                    \-> declined (from enquiry or quoted only)
 *
 * Capacity is booked at DEPOSIT, not at enquiry. Talk is free; the week is
 * only spent when money lands. That is also why quoting never checks
 * capacity: the patissier may quote ten enquiries for one week knowing at
 * most three deposits will fit, and the fourth deposit is refused with the
 * week named.
 *
 * Mirrors `commissions` and `commission_capacity` in db/schema.sql.
 */

const MIN_LEAD_DAYS = 14; // two weeks out, per the PRD
const DEFAULT_WEEK_CAPACITY = 3;
const MAX_BRIEF = 2000;

const STATUS_FLOW = {
  enquiry: "quoted",
  quoted: "deposit_paid",
  deposit_paid: "in_production",
  in_production: "ready",
  ready: "collected",
};
export const COMMISSION_STAGES = ["enquiry", "quoted", "deposit_paid", "in_production", "ready", "collected"];

const g = globalThis;
const db = (g.__noisette ??= {});
db.commissions ??= new Map(); // commissionId -> commission
db.commSeq ??= 0;
db.commissionCapacity ??= new Map(); // weekStart (ISO Monday) -> maxCakes

const isoDay = (d) => d.toISOString().slice(0, 10);

/** ISO Monday of the week containing this date. */
export function weekStartOf(dateIso) {
  const d = new Date(dateIso + "T00:00:00Z");
  const shift = (d.getUTCDay() + 6) % 7; // Mon 0 ... Sun 6
  d.setUTCDate(d.getUTCDate() - shift);
  return isoDay(d);
}

function earliestNeededOn() {
  const d = new Date();
  d.setDate(d.getDate() + MIN_LEAD_DAYS);
  return isoDay(d);
}

export function weekCapacity(weekStart) {
  return db.commissionCapacity.get(weekStart) ?? DEFAULT_WEEK_CAPACITY;
}

/** Cakes that have spent this week: deposit landed and never refunded. */
export function bookedCakes(weekStart) {
  let n = 0;
  for (const c of db.commissions.values()) {
    if (weekStartOf(c.neededOn) !== weekStart) continue;
    if (["deposit_paid", "in_production", "ready", "collected"].includes(c.status)) n += 1;
  }
  return n;
}

/** Anyone may enquire; guests included. The brief is the whole application. */
export function submitCommission({ customerId, name, whatsapp, neededOn, servings, brief }) {
  const wa = normalizeWhatsapp(whatsapp);
  if (!wa) return { error: "invalid_number" };
  if (!name?.trim()) return { error: "missing_fields" };
  if (!brief?.trim()) return { error: "missing_fields" };
  if (!neededOn || !/^\d{4}-\d{2}-\d{2}$/.test(neededOn)) return { error: "invalid_date" };

  const minDate = earliestNeededOn();
  if (neededOn < minDate) return { error: "too_soon", minDate, leadDays: MIN_LEAD_DAYS };

  const s = Math.floor(Number(servings));
  const commission = {
    id: "B-" + String(++db.commSeq).padStart(4, "0"),
    customerId: customerId || null,
    name: name.trim(),
    whatsapp: wa,
    neededOn,
    servings: Number.isFinite(s) && s > 0 ? s : null,
    brief: brief.trim().slice(0, MAX_BRIEF),
    status: "enquiry",
    quoteIdr: null,
    depositIdr: null,
    createdAt: Date.now(),
    stageAt: {},
  };
  db.commissions.set(commission.id, commission);
  return { commission };
}

/** Enquiry only. Re-quoting a deal that has taken a deposit is a new deal. */
export function quoteCommission(id, quoteIdr, depositIdr) {
  const c = db.commissions.get(id);
  if (!c) return { error: "not_found" };
  if (c.status !== "enquiry") return { error: "not_an_enquiry" };

  const q = Math.floor(Number(quoteIdr));
  if (!Number.isFinite(q) || q <= 0) return { error: "invalid_quote" };
  const d = depositIdr == null || depositIdr === "" ? Math.round(q / 2) : Math.floor(Number(depositIdr));
  if (!Number.isFinite(d) || d < 0 || d > q) return { error: "invalid_deposit" };

  c.quoteIdr = q;
  c.depositIdr = d;
  c.status = "quoted";
  c.stageAt.quoted = Date.now();
  return { commission: c };
}

/**
 * Advance one stage. The quoted -> deposit_paid step is the one with teeth:
 * it books the week, and a full week refuses the deposit by name.
 */
export function advanceCommission(id) {
  const c = db.commissions.get(id);
  if (!c) return { error: "not_found" };
  if (c.status === "declined") return { error: "declined" };
  // Quoting is not an "advance": it needs an amount, so it has its own verb.
  // Without this, stepping an enquiry forward would mint a quote of nothing.
  if (c.status === "enquiry") return { error: "quote_first" };

  const next = STATUS_FLOW[c.status];
  if (!next) return { error: "already_collected" };

  if (next === "deposit_paid") {
    const week = weekStartOf(c.neededOn);
    const booked = bookedCakes(week);
    const max = weekCapacity(week);
    if (booked >= max) return { error: "week_full", week, booked, max };
  }

  c.status = next;
  c.stageAt[next] = Date.now();
  return { commission: c };
}

/** Before money only. After a deposit, unwinding is a refund conversation. */
export function declineCommission(id) {
  const c = db.commissions.get(id);
  if (!c) return { error: "not_found" };
  if (!["enquiry", "quoted"].includes(c.status)) return { error: "past_declining" };
  c.status = "declined";
  c.stageAt.declined = Date.now();
  return { commission: c };
}

/** Floor is what is already booked, same rule as every allocation here. */
export function setWeekCapacity(weekStart, maxCakes) {
  const n = Math.floor(Number(maxCakes));
  if (!Number.isFinite(n) || n < 0) return { error: "invalid_amount" };
  const booked = bookedCakes(weekStart);
  if (n < booked) return { error: "below_committed", committed: booked };
  db.commissionCapacity.set(weekStart, n);
  return { ok: true, weekStart, maxCakes: n };
}

export function getCommission(id) {
  return db.commissions.get(id) || null;
}

export function listCommissions() {
  return [...db.commissions.values()].sort(
    (a, b) => a.neededOn.localeCompare(b.neededOn) || a.createdAt - b.createdAt
  );
}

/** This number's commissions, for "where is my cake" in the account sheet. */
export function commissionsFor(whatsapp) {
  const wa = normalizeWhatsapp(whatsapp);
  return [...db.commissions.values()]
    .filter((c) => c.whatsapp === wa)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** The patissier's next weeks at a glance. */
export function commissionWeeks(n = 6) {
  const out = [];
  const monday = weekStartOf(isoDay(new Date()));
  const d = new Date(monday + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const week = isoDay(d);
    out.push({ week, booked: bookedCakes(week), max: weekCapacity(week) });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
