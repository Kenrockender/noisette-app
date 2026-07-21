import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailability,
  createOrder,
  markPaid,
  getOrder,
  setAllocation,
  setSlotCapacity,
  saveStandingOrder,
  upsertCustomer,
  deleteStandingOrder,
} from "../lib/store.js";

/*
 * Every store function is dispatched through lib/store.js, whose contract is
 * async: the Postgres path returns a promise and the in-memory path returns a
 * value, and `await` handles both. These tests therefore await every store
 * call, so they stay correct under either backend rather than passing only
 * because the in-memory adapter happens to return synchronously.
 */

/** A pickup date that is guaranteed to be inside the open window. */
async function openDate() {
  return (await getAvailability()).dates[0];
}

const contact = { name: "Test Buyer", whatsapp: "081234567890" };

test("availability exposes the retail pool and a date rail", async () => {
  const a = await getAvailability();
  assert.ok(Array.isArray(a.dates) && a.dates.length >= 5);
  assert.equal(a.date, a.dates[0]);
  assert.ok(a.stock.pistachio >= 0);
  assert.ok(a.slots.length > 0);
});

test("an order cannot exceed the retail allocation (no oversell)", async () => {
  const date = await openDate();
  const free = (await getAvailability(date)).stock.piscok;
  assert.ok(free > 0, "fixture should have piscok stock");

  const ok = await createOrder({ items: [{ productId: "piscok", qty: free }], pickupDate: date, slotIndex: 0, ...contact });
  assert.ok(ok.order, "buying the whole shelf succeeds");

  const over = await createOrder({ items: [{ productId: "piscok", qty: 1 }], pickupDate: date, slotIndex: 0, ...contact });
  assert.equal(over.error, "insufficient_stock");
  assert.equal(over.available, 0);
});

test("a hold is all-or-nothing and rolls back on a bad line", async () => {
  const date = await openDate();
  const before = (await getAvailability(date)).stock.almond;
  const res = await createOrder({
    items: [{ productId: "almond", qty: 1 }, { productId: "almond", qty: before + 999 }],
    pickupDate: date, slotIndex: 1, ...contact,
  });
  assert.equal(res.error, "insufficient_stock");
  // The good line must have been released, so free stock is unchanged.
  assert.equal((await getAvailability(date)).stock.almond, before);
});

test("paying converts a hold to a sale", async () => {
  const date = await openDate();
  const res = await createOrder({ items: [{ productId: "eggtart", qty: 2 }], pickupDate: date, slotIndex: 2, ...contact });
  assert.ok(res.order);
  const paid = await markPaid(res.order.id);
  assert.equal(paid.order.status, "paid");
  assert.ok(paid.order.paidAt);
  // Paying again is idempotent, never a second sale.
  assert.equal((await markPaid(res.order.id)).order.status, "paid");
});

test("an expired hold releases stock and the slot", async () => {
  const date = await openDate();
  const alloc = await setAllocation(date, "hazelnut", 6, "retail");
  assert.ok(alloc.ok);
  const free = (await getAvailability(date)).stock.hazelnut;
  const res = await createOrder({ items: [{ productId: "hazelnut", qty: 1 }], pickupDate: date, slotIndex: 3, ...contact });
  assert.ok(res.order);
  // Force the hold into the past, then read availability which runs expireHolds.
  (await getOrder(res.order.id)).holdExpiresAt = Date.now() - 1;
  const after = (await getAvailability(date)).stock.hazelnut;
  assert.equal(after, free, "the released unit is back on the shelf");
});

test("a slot cannot be booked past capacity", async () => {
  const date = await openDate();
  await setSlotCapacity(date, 4, 1);
  const first = await createOrder({ items: [{ productId: "bonbon", qty: 1 }], pickupDate: date, slotIndex: 4, ...contact });
  assert.ok(first.order);
  const second = await createOrder({ items: [{ productId: "bonbon", qty: 1 }], pickupDate: date, slotIndex: 4, ...contact });
  assert.equal(second.error, "slot_full");
});

test("allocation cannot drop below what is already committed", async () => {
  const date = await openDate();
  const res = await setAllocation(date, "piscok", 0, "retail");
  // piscok was fully sold above, so zero is below committed.
  assert.equal(res.error, "below_committed");
});

test("a retail subscription reserves units from the retail pool", async () => {
  const date = (await getAvailability()).dates[0];
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const c = await upsertCustomer("628999000111", { name: "Subscriber" });
  await setAllocation(date, "bonbon", 20, "retail");
  const before = (await getAvailability(date)).stock.bonbon;
  const sub = await saveStandingOrder({
    customerId: c.id, channel: "retail", weekday,
    items: [{ productId: "bonbon", qty: 2 }], startsOn: date,
  });
  assert.ok(sub.standingOrder, sub.error);
  const after = (await getAvailability(date)).stock.bonbon;
  assert.equal(after, before - 2, "subscribed units come off the walk-in shelf");
});

test("editing a subscription's quantity re-checks capacity and updates the reservation", async () => {
  const date = (await getAvailability()).dates[0];
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const c = await upsertCustomer("628999000222", { name: "Subscriber2" });
  await setAllocation(date, "hazelnut", 10, "retail");
  const sub = await saveStandingOrder({
    customerId: c.id, channel: "retail", weekday,
    items: [{ productId: "hazelnut", qty: 2 }], startsOn: date,
  });
  assert.ok(sub.standingOrder, sub.error);
  const before = (await getAvailability(date)).stock.hazelnut;

  const edited = await saveStandingOrder({
    id: sub.standingOrder.id, customerId: c.id, channel: "retail", weekday,
    items: [{ productId: "hazelnut", qty: 5 }], startsOn: date,
  });
  assert.ok(edited.standingOrder, edited.error);
  assert.equal((await getAvailability(date)).stock.hazelnut, before - 3, "the increase draws three more from the shelf");

  const over = await saveStandingOrder({
    id: sub.standingOrder.id, customerId: c.id, channel: "retail", weekday,
    items: [{ productId: "hazelnut", qty: 999 }], startsOn: date,
  });
  assert.equal(over.error, "retail_capacity");
});

test("deleting a subscription frees its reservation for good", async () => {
  const date = (await getAvailability()).dates[0];
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const c = await upsertCustomer("628999000333", { name: "Subscriber3" });
  await setAllocation(date, "eggtart", 10, "retail");
  const before = (await getAvailability(date)).stock.eggtart;
  const sub = await saveStandingOrder({
    customerId: c.id, channel: "retail", weekday,
    items: [{ productId: "eggtart", qty: 3 }], startsOn: date,
  });
  assert.ok(sub.standingOrder, sub.error);
  assert.equal((await getAvailability(date)).stock.eggtart, before - 3);

  const other = await upsertCustomer("628999000444", { name: "NotOwner" });
  const denied = await deleteStandingOrder(sub.standingOrder.id, other.id);
  assert.equal(denied.error, "not_found", "ownership is enforced");

  const gone = await deleteStandingOrder(sub.standingOrder.id, c.id);
  assert.ok(gone.ok);
  assert.equal((await getAvailability(date)).stock.eggtart, before, "the reservation is released");
});
