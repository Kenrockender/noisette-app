import { query } from "../db/pg.js";
import { normalizeWhatsapp } from "../auth.js";
import { TEMPLATES, MAX_ATTEMPTS, deliverWhatsapp } from "./templates.js";

/**
 * Postgres notifications adapter (plan.md #5).
 *
 * Mirrors ./memory.js function for function, against the `notifications`
 * table in db/schema.sql. IDs are the bare BIGSERIAL value as a string (not
 * the "M-0001" prefix memory uses), the same call already made for
 * standing_orders in lib/store/pg.js: routes and components treat ids as
 * opaque strings, so the two backends are free to differ in shape.
 */

const toMs = (v) => (v == null ? null : new Date(v).getTime());

function shape(r) {
  return {
    id: String(r.id),
    whatsapp: r.whatsapp,
    template: r.template,
    payload: r.payload || {},
    orderId: r.order_id,
    status: r.status,
    attempts: Number(r.attempts),
    lastError: r.last_error,
    createdAt: toMs(r.created_at),
    sentAt: toMs(r.sent_at),
  };
}

const COLS = `id, whatsapp, template, payload, order_id, status, attempts, last_error, created_at, sent_at`;

export async function enqueueNotification({ to, template, payload = {}, orderId = null }) {
  const whatsapp = normalizeWhatsapp(to);
  if (!whatsapp) return { error: "invalid_number" };
  if (!TEMPLATES[template]) return { error: "unknown_template", template };

  const { rows } = await query(
    `INSERT INTO notifications (order_id, whatsapp, template, payload, status, attempts)
     VALUES ($1, $2, $3, $4::jsonb, 'queued', 0)
     RETURNING ${COLS}`,
    [orderId, whatsapp, template, JSON.stringify(payload)]
  );
  return { notification: shape(rows[0]) };
}

export async function drainQueue() {
  let sent = 0;
  const { rows } = await query(
    `SELECT ${COLS} FROM notifications WHERE status = 'queued'`
  );
  for (const r of rows) {
    const text = TEMPLATES[r.template](r.payload || {});
    const res = await deliverWhatsapp(r.whatsapp, text);
    const attempts = Number(r.attempts) + 1;
    if (res.delivered) {
      await query(
        `UPDATE notifications SET status = 'sent', sent_at = now(), attempts = $2, last_error = NULL WHERE id = $1`,
        [r.id, attempts]
      );
      sent += 1;
    } else {
      const status = attempts >= MAX_ATTEMPTS ? "failed" : "queued";
      await query(
        `UPDATE notifications SET status = $2, attempts = $3, last_error = $4 WHERE id = $1`,
        [r.id, status, attempts, res.reason || "delivery_failed"]
      );
    }
  }
  return { sent };
}

export async function retryNotification(id) {
  const { rows } = await query(`SELECT status FROM notifications WHERE id = $1`, [id]);
  if (!rows.length) return { error: "not_found" };
  if (rows[0].status !== "failed") return { error: "not_failed" };
  const { rows: updated } = await query(
    `UPDATE notifications SET status = 'queued', attempts = 0, last_error = NULL WHERE id = $1 RETURNING ${COLS}`,
    [id]
  );
  return { notification: shape(updated[0]) };
}

export async function listNotifications(limit = 50) {
  const { rows } = await query(
    `SELECT ${COLS} FROM notifications ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  return rows.map((r) => ({ ...shape(r), text: TEMPLATES[r.template](r.payload || {}) }));
}

export async function notificationCounts() {
  const { rows } = await query(`SELECT status, count(*)::int AS n FROM notifications GROUP BY status`);
  const counts = { queued: 0, sent: 0, failed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}
