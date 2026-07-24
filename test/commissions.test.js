import { test } from "node:test";
import assert from "node:assert/strict";
import {
  submitCommission,
  quoteCommission,
  advanceCommission,
  declineCommission,
  setWeekCapacity,
  weekStartOf,
} from "../lib/commissions.js";

function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

test("an enquiry inside the two-week lead is refused", async () => {
  const res = await submitCommission({
    name: "Ana", whatsapp: "081200000001", neededOn: inDays(3),
    servings: 20, brief: "A birthday cake",
  });
  assert.equal(res.error, "too_soon");
  assert.ok(res.minDate);
});

test("the full commission flow: enquiry, quote, deposit books the week", async () => {
  const neededOn = inDays(30);
  const res = await submitCommission({
    name: "Bima", whatsapp: "081200000002", neededOn,
    servings: 40, brief: "Two-tier hazelnut",
  });
  assert.ok(res.commission, res.error);
  const id = res.commission.id;

  // Cannot advance an enquiry: it needs a quote first.
  assert.equal((await advanceCommission(id)).error, "quote_first");

  const q = await quoteCommission(id, 1_500_000, 750_000);
  assert.equal(q.commission.status, "quoted");
  assert.equal(q.commission.depositIdr, 750_000);

  const dep = await advanceCommission(id);
  assert.equal(dep.commission.status, "deposit_paid");
});

test("a full week refuses the fourth deposit by name", async () => {
  const neededOn = inDays(45);
  const week = weekStartOf(neededOn);
  await setWeekCapacity(week, 1);

  const a = await submitCommission({ name: "C", whatsapp: "081200000003", neededOn, servings: 10, brief: "one" });
  const b = await submitCommission({ name: "D", whatsapp: "081200000004", neededOn, servings: 10, brief: "two" });
  await quoteCommission(a.commission.id, 500_000, 250_000);
  await quoteCommission(b.commission.id, 500_000, 250_000);

  assert.equal((await advanceCommission(a.commission.id)).commission.status, "deposit_paid");
  const full = await advanceCommission(b.commission.id);
  assert.equal(full.error, "week_full");
  assert.equal(full.week, week);
});

test("declining is only allowed before money changes hands", async () => {
  const neededOn = inDays(60);
  const res = await submitCommission({ name: "E", whatsapp: "081200000005", neededOn, servings: 10, brief: "x" });
  await quoteCommission(res.commission.id, 400_000, 200_000);
  await advanceCommission(res.commission.id); // deposit_paid
  assert.equal((await declineCommission(res.commission.id)).error, "past_declining");
});
