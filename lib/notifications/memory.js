import { normalizeWhatsapp } from "../auth.js";
import { TEMPLATES, MAX_ATTEMPTS, deliverWhatsapp } from "./templates.js";

/**
 * In-memory notifications adapter (plan.md #5).
 *
 * Mirrors ./pg.js function for function. See lib/notifications.js for the
 * dispatcher and the doctrine (queue, never send inline, fail closed).
 */

const g = globalThis;
const db = (g.__noisette ??= {});
db.notifications ??= new Map(); // notificationId -> notification
db.notifSeq ??= 0;

export function enqueueNotification({ to, template, payload = {}, orderId = null }) {
  const whatsapp = normalizeWhatsapp(to);
  if (!whatsapp) return { error: "invalid_number" };
  if (!TEMPLATES[template]) return { error: "unknown_template", template };

  const n = {
    id: "M-" + String(++db.notifSeq).padStart(4, "0"),
    whatsapp,
    template,
    payload,
    orderId,
    status: "queued", // queued | sent | failed
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    sentAt: null,
  };
  db.notifications.set(n.id, n);
  return { notification: n };
}

export async function drainQueue() {
  let sent = 0;
  for (const n of db.notifications.values()) {
    if (n.status !== "queued") continue;
    const text = TEMPLATES[n.template](n.payload);
    const res = await deliverWhatsapp(n.whatsapp, text);
    n.attempts += 1;
    if (res.delivered) {
      n.status = "sent";
      n.sentAt = Date.now();
      n.lastError = null;
      sent += 1;
    } else {
      n.lastError = res.reason || "delivery_failed";
      if (n.attempts >= MAX_ATTEMPTS) n.status = "failed";
    }
  }
  return { sent };
}

export function retryNotification(id) {
  const n = db.notifications.get(id);
  if (!n) return { error: "not_found" };
  if (n.status !== "failed") return { error: "not_failed" };
  n.status = "queued";
  n.attempts = 0;
  n.lastError = null;
  return { notification: n };
}

export function listNotifications(limit = 50) {
  return [...db.notifications.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((n) => ({ ...n, text: TEMPLATES[n.template](n.payload) }));
}

export function notificationCounts() {
  const counts = { queued: 0, sent: 0, failed: 0 };
  for (const n of db.notifications.values()) counts[n.status] += 1;
  return counts;
}
