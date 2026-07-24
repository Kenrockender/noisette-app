import { query } from "../db/pg.js";
import { listOrders, subscriptionsOn, getCustomer, listStandingOrders } from "../store.js";
import { deliveriesOn } from "../deliveries.js";
import { enqueueNotification } from "../notifications.js";

/**
 * Day-before reminders.
 */

const isoDay = (d) => d.toISOString().slice(0, 10);

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDay(d);
}

export async function enqueueDailyReminders(date = tomorrowIso()) {
  let queued = 0;

  const once = async (key, make) => {
    const { rowCount } = await query(
      "INSERT INTO reminder_log (reminder_key) VALUES ($1) ON CONFLICT DO NOTHING",
      [key]
    );
    if (rowCount > 0) {
      const r = await make();
      if (r && !r.error) {
        queued += 1;
      }
    }
  };

  // Retail pickups landing tomorrow, still awaiting collection.
  for (const o of await listOrders(date)) {
    if (!["paid", "preparing", "ready"].includes(o.status)) continue;
    await once(`pickup:${o.id}`, () =>
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
    await once(`sub:${s.standingOrderId}:${date}`, () =>
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
    await once(`delivery:${d.standingOrderId}:${date}`, () =>
      enqueueNotification({
        to: c.whatsapp,
        template: "delivery_reminder",
        payload: { date, items },
      })
    );
  }

  return { date, queued };
}
