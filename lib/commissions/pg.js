import { query, transaction } from "../db/pg.js";
import { normalizeWhatsapp } from "../auth.js";
import { weekStartOf } from "./memory.js";

const MIN_LEAD_DAYS = 14;
const DEFAULT_WEEK_CAPACITY = 3;

const STATUS_FLOW = {
  enquiry: "quoted",
  quoted: "deposit_paid",
  deposit_paid: "in_production",
  in_production: "ready",
  ready: "collected",
};

const formatId = (id) => "B-" + String(id).padStart(4, "0");
const parseId = (id) => parseInt(String(id).replace("B-", ""), 10);
const toMs = (v) => (v == null ? null : new Date(v).getTime());
const isoDay = (d) => {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
};

function earliestNeededOn() {
  const d = new Date();
  d.setDate(d.getDate() + MIN_LEAD_DAYS);
  return isoDay(d);
}

const mapRow = (r) => {
  if (!r) return null;
  return {
    id: formatId(r.id),
    customerId: r.customer_id != null ? String(r.customer_id) : null,
    name: r.name || "",
    whatsapp: r.whatsapp,
    neededOn: isoDay(r.needed_on),
    servings: r.servings,
    brief: r.brief,
    status: r.status,
    quoteIdr: r.quote_idr,
    depositIdr: r.deposit_idr,
    createdAt: toMs(r.created_at),
    stageAt: {},
  };
};

export async function weekCapacity(weekStart) {
  const res = await query("SELECT max_cakes FROM commission_capacity WHERE week_starting = $1", [weekStart]);
  return res.rows.length > 0 ? res.rows[0].max_cakes : DEFAULT_WEEK_CAPACITY;
}

export async function bookedCakes(weekStart) {
  const end = new Date(weekStart + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);
  const res = await query(`
    SELECT COUNT(*) as count 
    FROM commissions 
    WHERE status IN ('deposit_paid','in_production','ready','collected') 
      AND needed_on BETWEEN $1 AND $2
  `, [weekStart, weekEnd]);
  return parseInt(res.rows[0].count, 10);
}

export async function submitCommission({ customerId, name, whatsapp, neededOn, servings, brief }) {
  const wa = normalizeWhatsapp(whatsapp);
  if (!wa) return { error: "invalid_number" };
  if (!name?.trim()) return { error: "missing_fields" };
  if (!brief?.trim()) return { error: "missing_fields" };
  if (!neededOn || !/^\d{4}-\d{2}-\d{2}$/.test(neededOn)) return { error: "invalid_date" };

  const minDate = earliestNeededOn();
  if (neededOn < minDate) return { error: "too_soon", minDate, leadDays: MIN_LEAD_DAYS };

  const s = Math.floor(Number(servings));
  const validServings = Number.isFinite(s) && s > 0 ? s : null;
  const validBrief = brief.trim().slice(0, 2000);

  const res = await query(`
    INSERT INTO commissions (customer_id, whatsapp, name, needed_on, servings, brief)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [customerId || null, wa, name.trim(), neededOn, validServings, validBrief]);

  return { commission: mapRow(res.rows[0]) };
}

export async function quoteCommission(id, quoteIdr, depositIdr) {
  const dbId = parseId(id);
  const check = await query("SELECT status FROM commissions WHERE id = $1", [dbId]);
  if (check.rows.length === 0) return { error: "not_found" };
  if (check.rows[0].status !== "enquiry") return { error: "not_an_enquiry" };

  const q = Math.floor(Number(quoteIdr));
  if (!Number.isFinite(q) || q <= 0) return { error: "invalid_quote" };
  const d = depositIdr == null || depositIdr === "" ? Math.round(q / 2) : Math.floor(Number(depositIdr));
  if (!Number.isFinite(d) || d < 0 || d > q) return { error: "invalid_deposit" };

  const res = await query(`
    UPDATE commissions
    SET quote_idr = $1, deposit_idr = $2, status = 'quoted'
    WHERE id = $3 AND status = 'enquiry'
    RETURNING *
  `, [q, d, dbId]);

  if (res.rows.length === 0) return { error: "not_found" };
  return { commission: mapRow(res.rows[0]) };
}

/**
 * `existingClient` lets a caller already inside its own transaction (e.g.
 * lib/payments/pg.js's handlePaymentCallback, confirming a deposit) run this
 * on that SAME connection instead of opening a second one. Without it, this
 * function's writes would commit independently the moment it returns, so a
 * later failure in the caller's transaction could leave the commission
 * advanced to deposit_paid while the invoice that was supposed to cause it
 * never actually gets marked paid.
 */
export async function advanceCommission(id, existingClient) {
  const dbId = parseId(id);

  const run = async (client) => {
    const c = await client.query("SELECT * FROM commissions WHERE id = $1", [dbId]);
    if (c.rows.length === 0) return { error: "not_found" };
    const comm = c.rows[0];
    
    if (comm.status === "declined") return { error: "declined" };
    if (comm.status === "enquiry") return { error: "quote_first" };
    
    const next = STATUS_FLOW[comm.status];
    if (!next) return { error: "already_collected" };

    if (next === "deposit_paid") {
      const week = weekStartOf(isoDay(comm.needed_on));
      const weekEndDate = new Date(week + "T00:00:00Z");
      weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
      const weekEnd = isoDay(weekEndDate);

      // The capacity row is locked purely as a per-week mutex, serializing
      // concurrent advances for the same week. The actual count is derived
      // fresh from `commissions` (same query as the exported bookedCakes()),
      // never trusted from a stored counter — a stored counter here could
      // drift from reality the moment any other write path touches a
      // commission's status, per the "commitments are derived, not stored"
      // doctrine the rest of the pg adapters follow (see lib/store/pg.js).
      await client.query(`
        INSERT INTO commission_capacity (week_starting, max_cakes)
        VALUES ($1, $2)
        ON CONFLICT (week_starting) DO NOTHING
      `, [week, DEFAULT_WEEK_CAPACITY]);

      const capRes = await client.query(
        `SELECT max_cakes FROM commission_capacity WHERE week_starting = $1 FOR UPDATE`,
        [week]
      );
      const max = capRes.rows[0].max_cakes;

      const bookedRes = await client.query(`
        SELECT COUNT(*)::int AS n FROM commissions
        WHERE status IN ('deposit_paid','in_production','ready','collected')
          AND needed_on BETWEEN $1 AND $2
      `, [week, weekEnd]);
      const booked = bookedRes.rows[0].n;
      if (booked >= max) return { error: "week_full", week, booked, max };

      // Kept in step for anyone reading the table directly; the gate above
      // never depends on it.
      await client.query(
        `UPDATE commission_capacity SET booked_cakes = $2 WHERE week_starting = $1`,
        [week, booked + 1]
      );
    }
    
    const upd = await client.query(`
      UPDATE commissions 
      SET status = $1 
      WHERE id = $2 
      RETURNING *
    `, [next, dbId]);
    
    return { commission: mapRow(upd.rows[0]) };
  };
  return existingClient ? run(existingClient) : transaction(run);
}

export async function declineCommission(id) {
  const dbId = parseId(id);
  const res = await query(`
    UPDATE commissions
    SET status = 'declined'
    WHERE id = $1 AND status IN ('enquiry', 'quoted')
    RETURNING *
  `, [dbId]);
  
  if (res.rows.length === 0) {
    const check = await query("SELECT status FROM commissions WHERE id = $1", [dbId]);
    if (check.rows.length === 0) return { error: "not_found" };
    return { error: "past_declining" };
  }
  
  return { commission: mapRow(res.rows[0]) };
}

export async function setWeekCapacity(weekStart, maxCakes) {
  const n = Math.floor(Number(maxCakes));
  if (!Number.isFinite(n) || n < 0) return { error: "invalid_amount" };
  
  const booked = await bookedCakes(weekStart);
  if (n < booked) return { error: "below_committed", committed: booked };
  
  await query(`
    INSERT INTO commission_capacity (week_starting, max_cakes, booked_cakes)
    VALUES ($1, $2, $3)
    ON CONFLICT (week_starting) DO UPDATE SET max_cakes = EXCLUDED.max_cakes
  `, [weekStart, n, booked]);
  
  return { ok: true, weekStart, maxCakes: n };
}

export async function getCommission(id) {
  const res = await query("SELECT * FROM commissions WHERE id = $1", [parseId(id)]);
  return res.rows.length > 0 ? mapRow(res.rows[0]) : null;
}

export async function listCommissions() {
  const res = await query(`
    SELECT * FROM commissions 
    ORDER BY needed_on ASC, created_at ASC
  `);
  return res.rows.map(mapRow);
}

export async function commissionsFor(whatsapp) {
  const wa = normalizeWhatsapp(whatsapp);
  const res = await query(`
    SELECT * FROM commissions 
    WHERE whatsapp = $1
    ORDER BY created_at DESC
  `, [wa]);
  return res.rows.map(mapRow);
}

export async function commissionWeeks(n = 6) {
  const out = [];
  const monday = weekStartOf(new Date().toISOString().slice(0, 10));
  const d = new Date(monday + "T00:00:00Z");
  
  for (let i = 0; i < n; i++) {
    const week = isoDay(d);
    
    const [b, max] = await Promise.all([
      bookedCakes(week),
      weekCapacity(week)
    ]);
    
    out.push({ week, booked: b, max });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
