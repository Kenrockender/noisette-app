import { listOrders, subscriptionsOn, getCustomer, listStandingOrders } from "../store.js";
import { deliveriesOn } from "../deliveries.js";
import { enqueueNotification } from "../notifications.js";

/**
 * Day-before reminders.
 *
 * The outbox already carries the reactive messages (paid, ready, wholesale
 * decision). These are the proactive ones the shop was missing: a retail pickup
 * reminder the day before, a subscription-box reminder, and a wholesale
 * delivery reminder. Each is enqueued once — a Set of keys survives with the
 * store so re-running the sweep (which the demo does whenever the outbox opens)
 * cannot send the same reminder twice.
 *
 * In production this is a scheduled job that runs each morning for the next
 * day; here it is a plain function a route calls. Enqueue never sends, so a
 * WhatsApp outage cannot fail anything — the rows just wait in the outbox.
 */

const g = globalThis;
const db = (g.__noisette ??= {});
db.remindersSent ??= new Set();

const isoDay = (d) => d.toISOString().slice(0, 10);

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDay(d);
}

export async function enqueueDailyReminders(date = tomorrowIso()) {
  const sent = db.remindersSent;
  let queued = 0;
  const once = (key, make) => {
    if (sent.has(key)) return;
    const r = make();
    if (r && !r.error) {
      sent.add(key);
      queued += 1;
    }
  };

  // Retail pickups landing tomorrow, still awaiting collection.
  for (const o of await listOrders(date)) {
    if (!["paid", "preparing", "ready"].includes(o.status)) continue;
    once(`pickup:${o.id}`, () =>
      enqueueNotification({
        to: o.customer.whatsapp,
        template: "pickup_reminder",
        payload: { orderId: o.id, pickupDate: o.pickupDate, slotTime: o.slotTime },
        orderId: o.id,
      })
    );
  }

  // Subscription boxes landing tomorrow.
  for (const s of await subscriptionsOn(date)) {
    const c = await getCustomer(s.customerId);
    if (!c) continue;
    once(`sub:${s.standingOrderId}:${date}`, () =>
      enqueueNotification({
        to: c.whatsapp,
        template: "subscription_reminder",
        payload: { pickupDate: date },
      })
    );
  }

  // Wholesale deliveries landing tomorrow, skips excluded. The standing-order
  // list is built once; rebuilding it per delivery was O(n^2).
  const soById = new Map((await listStandingOrders()).map((s) => [s.id, s]));
  for (const d of await deliveriesOn(date)) {
    if (d.skipped) continue;
    const so = soById.get(d.standingOrderId);
    const c = so ? await getCustomer(so.customerId) : null;
    if (!c) continue;
    const items = (d.items || []).map((it) => `${it.qty} ${it.name}`).join(", ");
    once(`delivery:${d.standingOrderId}:${date}`, () =>
      enqueueNotification({
        to: c.whatsapp,
        template: "delivery_reminder",
        payload: { date, items },
      })
    );
  }

  return { date, queued };
}
