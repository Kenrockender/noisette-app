import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailability,
  createOrder,
  upsertCustomer,
  saveStandingOrder,
  listStandingOrders,
  setAllocation,
} from "../lib/store.js";
import { submitCommission, quoteCommission } from "../lib/commissions.js";
import {
  createInvoice,
  createCommissionDepositInvoice,
  signPayload,
} from "../lib/payments.js";
import { POST as webhookPost } from "../app/api/payments/webhook/route.js";

/*
 * Regression tests for plan.md #1 and #2.
 *
 * Both bugs slipped past the old suite because it called lib functions
 * directly. #2 lived in the ROUTE's response shape, so the webhook is tested
 * here through its actual handler; #1's fix lives in saveStandingOrder, which
 * is the single enforcement point both POST routes call.
 */

function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const signedRequest = (rawBody) =>
  new Request("http://localhost/api/payments/webhook", {
    method: "POST",
    headers: { "x-callback-signature": signPayload(rawBody) },
    body: rawBody,
  });

/* ---- #1: standing order hijack (IDOR) ---- */

test("a standing order cannot be replaced by a customer who does not own it", async () => {
  const date = (await getAvailability()).dates[0];
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  await setAllocation(date, "bonbon", 40, "retail");

  const victim = await upsertCustomer("628111222333", { name: "Victim Cafe" });
  const attacker = await upsertCustomer("628444555666", { name: "Attacker" });

  const made = await saveStandingOrder({
    customerId: victim.id, channel: "retail", weekday,
    items: [{ productId: "bonbon", qty: 2 }], startsOn: date,
  });
  assert.ok(made.standingOrder, made.error);
  const soId = made.standingOrder.id;

  // The attack from the plan: replace the victim's id from another account.
  const hijack = await saveStandingOrder({
    id: soId, customerId: attacker.id, channel: "retail", weekday,
    items: [{ productId: "bonbon", qty: 2 }], startsOn: date,
  });
  assert.equal(hijack.error, "not_found", "ownership is enforced on replace");

  const victimList = (await listStandingOrders(victim.id)).map((s) => s.id);
  const attackerList = (await listStandingOrders(attacker.id)).map((s) => s.id);
  assert.ok(victimList.includes(soId), "the victim still owns the order");
  assert.ok(!attackerList.includes(soId), "the attacker gained nothing");
});

test("the owner can still edit their own standing order by id", async () => {
  const date = (await getAvailability()).dates[0];
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  await setAllocation(date, "eggtart", 40, "retail");

  const owner = await upsertCustomer("628777888999", { name: "Owner" });
  const made = await saveStandingOrder({
    customerId: owner.id, channel: "retail", weekday,
    items: [{ productId: "eggtart", qty: 2 }], startsOn: date,
  });
  assert.ok(made.standingOrder, made.error);

  const edited = await saveStandingOrder({
    id: made.standingOrder.id, customerId: owner.id, channel: "retail", weekday,
    items: [{ productId: "eggtart", qty: 3 }], startsOn: date,
  });
  assert.ok(edited.standingOrder, edited.error);
  assert.equal(edited.standingOrder.items[0].qty, 3);
});

/* ---- #2: webhook route must ack bespoke deposit callbacks ---- */

test("the webhook route returns 200 for a bespoke deposit callback", async () => {
  const c = await submitCommission({
    name: "Deposit Payer", whatsapp: "081200000199",
    neededOn: inDays(60), servings: 20, brief: "route-level deposit test",
  });
  assert.ok(c.commission, c.error);
  await quoteCommission(c.commission.id, 1_000_000, 500_000);

  const made = await createCommissionDepositInvoice(c.commission.id);
  assert.ok(made.invoice, made.error);
  const rawBody = JSON.stringify({ invoiceId: made.invoice.id, status: "PAID", amount: made.invoice.amount });

  const res = await webhookPost(signedRequest(rawBody));
  assert.equal(res.status, 200, "the provider gets its ack, not a 500");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, c.commission.id, "the ack names the commission");

  // Providers redeliver. The replay must ack too, or the retry loop returns.
  const replay = await webhookPost(signedRequest(rawBody));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replay, true);
});

test("the webhook route still acks a retail order callback", async () => {
  const date = (await getAvailability()).dates[0];
  await upsertCustomer("628123123124", { name: "Route Payer" });
  const order = await createOrder({
    items: [{ productId: "eggtart", qty: 1 }], pickupDate: date, slotIndex: 0,
    name: "Route Payer", whatsapp: "628123123124",
  });
  assert.ok(order.order, order.error);
  const invoice = await createInvoice(order.order);
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount });

  const res = await webhookPost(signedRequest(rawBody));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, order.order.id);
});

test("a timestamped callback that is too old is refused as a replay", async () => {
  const date = (await getAvailability()).dates[0];
  await upsertCustomer("628123123125", { name: "Stale Payer" });
  const order = await createOrder({
    items: [{ productId: "eggtart", qty: 1 }], pickupDate: date, slotIndex: 0,
    name: "Stale Payer", whatsapp: "628123123125",
  });
  assert.ok(order.order, order.error);
  const invoice = await createInvoice(order.order);
  const rawBody = JSON.stringify({
    invoiceId: invoice.id, status: "PAID", amount: invoice.amount,
    ts: Date.now() - 60 * 60 * 1000, // captured an hour ago
  });

  const res = await webhookPost(signedRequest(rawBody));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "stale_callback");
});

test("the webhook route still rejects a bad signature", async () => {
  const res = await webhookPost(
    new Request("http://localhost/api/payments/webhook", {
      method: "POST",
      headers: { "x-callback-signature": "deadbeef" },
      body: JSON.stringify({ invoiceId: "INV-00001", status: "PAID", amount: 1 }),
    })
  );
  assert.equal(res.status, 401);
});
