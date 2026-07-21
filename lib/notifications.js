import { normalizeWhatsapp } from "./auth.js";

/**
 * Outbound WhatsApp, queued rather than sent inline.
 *
 * The rule this file exists to enforce: a failed send must never fail an order
 * that has already taken the customer's money. So `enqueue` only writes a row
 * and cannot throw past its caller, and delivery happens later in `drainQueue`,
 * which in production is a worker (BullMQ per the PRD) and here runs whenever
 * staff open the outbox.
 *
 * Like the OTP sender in lib/auth.js, actual delivery fails closed: until the
 * WhatsApp Business API is wired into `deliverWhatsapp`, production sends do
 * not happen and the rows sit visibly queued in the outbox rather than being
 * silently lost. In development a send just logs, so the queue can be watched
 * doing its job.
 *
 * Mirrors the `notifications` table in db/schema.sql.
 */

const MAX_ATTEMPTS = 5;

const g = globalThis;
const db = (g.__noisette ??= {});
db.notifications ??= new Map(); // notificationId -> notification
db.notifSeq ??= 0;

/**
 * Message texts live here, not scattered through routes. A template that does
 * not exist is a programming error and refuses loudly at enqueue time, not at
 * send time three retries later.
 */
const TEMPLATES = {
  order_paid: (p) =>
    `Noisette: order ${p.orderId} confirmed for ${p.pickupDate}, ${p.slotTime}. ` +
    `Show code ${p.orderId} at the counter, Jl. Bondowoso No.8.`,
  order_ready: (p) =>
    `Noisette: order ${p.orderId} is ready. See you at Jl. Bondowoso No.8.`,
  order_cancelled: (p) =>
    `Noisette: order ${p.orderId} is cancelled` +
    `${p.refunded ? " and your payment has been refunded" : ""}. ` +
    `Sorry to miss you — order again any time.`,
  wholesale_approved: (p) =>
    `Noisette: wholesale account approved for ${p.businessName}. ` +
    `Trade prices and standing orders are at /wholesale.`,
  wholesale_rejected: (p) =>
    `Noisette: we could not approve the wholesale application for ${p.businessName}. ` +
    `Reply here if you would like to talk it through.`,
  commission_received: (p) =>
    `Noisette: we received your bespoke enquiry ${p.commissionId} for ${p.neededOn}. ` +
    `The patissier reads every brief personally; expect a quote within two days.`,
  commission_quoted: (p) =>
    `Noisette: your bespoke commission ${p.commissionId} is quoted at ${p.quote}` +
    `${p.deposit ? `, deposit ${p.deposit} to book the week` : ""}. Reply here to confirm.`,
  commission_deposit_paid: (p) =>
    `Noisette: deposit received for bespoke commission ${p.commissionId}. ` +
    `Your week is booked and the patissier is on it. Collection ${p.neededOn}.`,
  commission_ready: (p) =>
    `Noisette: your bespoke cake ${p.commissionId} is ready. ` +
    `Collect it at Jl. Bondowoso No.8. See you soon.`,
  // Sent the day before, so a pickup does not quietly lapse into a no-show.
  pickup_reminder: (p) =>
    `Noisette: reminder — order ${p.orderId} is for pickup tomorrow ${p.pickupDate}, ` +
    `${p.slotTime}. Show code ${p.orderId} at Jl. Bondowoso No.8.`,
  subscription_reminder: (p) =>
    `Noisette: your standing box is ready for pickup tomorrow ${p.pickupDate}. ` +
    `See you at Jl. Bondowoso No.8.`,
  delivery_reminder: (p) =>
    `Noisette: your wholesale delivery lands tomorrow ${p.date}${p.items ? ` (${p.items})` : ""}. ` +
    `We will call on arrival.`,
};

/**
 * Queue a message. Never sends, never throws business errors upward; the
 * return value exists for tests, not for callers to branch on. Callers have
 * already done the thing the message describes.
 */
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

/** The WhatsApp Business API call goes here. Fails closed until it exists. */
async function deliverWhatsapp(whatsapp, text) {
  if (process.env.NODE_ENV === "production")
    return { delivered: false, reason: "whatsapp_not_configured" };
  console.log(`[wa -> ${whatsapp}] ${text} (dev only, not sent)`);
  return { delivered: true };
}

/**
 * Attempt every queued row once. Sent rows are done; failures keep their error
 * and retry on the next drain until MAX_ATTEMPTS burns them to `failed`, where
 * they wait, visible, for a human and the retry button.
 */
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

/** Put a failed row back in the queue. Attempts start over; humans said so. */
export function retryNotification(id) {
  const n = db.notifications.get(id);
  if (!n) return { error: "not_found" };
  if (n.status !== "failed") return { error: "not_failed" };
  n.status = "queued";
  n.attempts = 0;
  n.lastError = null;
  return { notification: n };
}

/** Newest first, with the rendered text so the outbox shows real messages. */
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
