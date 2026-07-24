import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, getAvailability, upsertCustomer } from "../lib/store.js";
import { submitCommission, quoteCommission, setWeekCapacity, weekStartOf } from "../lib/commissions.js";
import {
  createInvoice,
  invoiceForOrder,
  signPayload,
  handlePaymentCallback,
  simulateProviderPayment,
  simulateCommissionDeposit,
  cancelAndRefundOrder,
} from "../lib/payments.js";

function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function freshOrder(productId = "eggtart") {
  const date = (await getAvailability()).dates[0];
  await upsertCustomer("628123123123", { name: "Payer" });
  const res = await createOrder({
    items: [{ productId, qty: 1 }], pickupDate: date, slotIndex: 0,
    name: "Payer", whatsapp: "628123123123",
  });
  assert.ok(res.order, res.error);
  return res.order;
}

test("an invoice is minted once per order (idempotent)", async () => {
  const order = await freshOrder();
  const a = await createInvoice(order);
  const b = await createInvoice(order);
  assert.equal(a.id, b.id);
  assert.equal((await invoiceForOrder(order.id)).id, a.id);
});

test("a callback with a bad signature is rejected and learns nothing", async () => {
  const order = await freshOrder();
  const invoice = await createInvoice(order);
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount });
  const res = await handlePaymentCallback(rawBody, "deadbeef");
  assert.equal(res.error, "bad_signature");
});

test("a valid signed callback pays the order, and replays are safe", async () => {
  const order = await freshOrder();
  const invoice = await createInvoice(order);
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount });
  const sig = signPayload(rawBody);

  const first = await handlePaymentCallback(rawBody, sig);
  assert.equal(first.order.status, "paid");
  const second = await handlePaymentCallback(rawBody, sig);
  assert.equal(second.replay, true);
});

test("an amount mismatch leaves the order unpaid", async () => {
  const order = await freshOrder();
  const invoice = await createInvoice(order);
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount + 1 });
  const res = await handlePaymentCallback(rawBody, signPayload(rawBody));
  assert.equal(res.error, "amount_mismatch");
});

test("the demo provider drives a payment through the real verified door", async () => {
  const order = await freshOrder();
  const res = await simulateProviderPayment(order.id);
  assert.equal(res.order.status, "paid");
});

test("cancelling a paid order releases stock and refunds the invoice, idempotently", async () => {
  const date = (await getAvailability()).dates[0];
  const before = (await getAvailability(date)).stock.hazelnut;
  const order = await freshOrder("hazelnut");
  await simulateProviderPayment(order.id);

  const res = await cancelAndRefundOrder(order.id, "customer");
  assert.equal(res.order.status, "cancelled", res.error);
  assert.equal(res.refunded, true);
  assert.equal((await getAvailability(date)).stock.hazelnut, before, "the unit is back on the shelf");

  // Cancelling an already-cancelled order is not a second release.
  const again = await cancelAndRefundOrder(order.id, "customer");
  assert.equal(again.order.status, "cancelled");
  assert.equal((await getAvailability(date)).stock.hazelnut, before);
});

test("a bespoke deposit goes through the same signed door, and books the week", async () => {
  const neededOn = inDays(90);
  const c = await submitCommission({ name: "Payer2", whatsapp: "081200000090", neededOn, servings: 20, brief: "brief" });
  assert.ok(c.commission, c.error);
  await quoteCommission(c.commission.id, 1_000_000, 500_000);

  const res = await simulateCommissionDeposit(c.commission.id);
  assert.equal(res.commission.status, "deposit_paid", res.error);
  assert.equal(res.invoice.status, "paid");
  assert.equal(res.invoice.amount, 500_000);

  // Once paid the commission is no longer "quoted", so a second tap (a retry,
  // a double click) cannot mint or pay a second deposit invoice for it.
  const second = await simulateCommissionDeposit(c.commission.id);
  assert.equal(second.error, "not_quoted");
});

test("a bespoke deposit is refused once the week is full", async () => {
  const neededOn = inDays(150); // far enough from the other test's date to land in a different week
  const week = weekStartOf(neededOn);
  const cap = await setWeekCapacity(week, 0);
  assert.ok(cap.ok, cap.error);
  const c = await submitCommission({ name: "Payer3", whatsapp: "081200000091", neededOn, servings: 20, brief: "brief" });
  await quoteCommission(c.commission.id, 1_000_000, 500_000);

  const res = await simulateCommissionDeposit(c.commission.id);
  assert.equal(res.error, "week_full");
});
