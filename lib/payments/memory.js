import { getOrder, markPaid, cancelOrder } from "../store.js";
import { getCommission, advanceCommission, weekStartOf, weekCapacity, bookedCakes } from "../commissions.js";
import { enqueueNotification } from "../notifications.js";
import { signatureValid, signPayload, CALLBACK_MAX_AGE_MS } from "./crypto.js";

const g = globalThis;
const db = (g.__noisette ??= {});
db.invoices ??= new Map(); // invoiceId -> invoice
db.invoiceByOrder ??= new Map(); // orderId -> invoiceId
db.invoiceByCommission ??= new Map(); // commissionId -> invoiceId
db.invSeq ??= 0;

/**
 * Create the provider invoice for an order.
 *
 * With a real provider this is the API call that returns a checkout URL / QR
 * string; here it mints the equivalent object locally. Idempotent per order,
 * because "create invoice" retried must not bill twice.
 */
export function createInvoice(order) {
  const existing = db.invoiceByOrder.get(order.id);
  if (existing) return db.invoices.get(existing);

  const invoice = {
    id: "INV-" + String(++db.invSeq).padStart(5, "0"),
    orderId: order.id,
    amount: order.total,
    currency: "IDR",
    status: "pending", // pending | paid | expired
    // The provider's payment window mirrors the stock hold. One clock, not two.
    expiresAt: order.holdExpiresAt,
    createdAt: Date.now(),
  };
  db.invoices.set(invoice.id, invoice);
  db.invoiceByOrder.set(order.id, invoice.id);
  order.paymentRef = invoice.id; // what schema.sql calls payment_ref
  return invoice;
}

export function invoiceForOrder(orderId) {
  const id = db.invoiceByOrder.get(orderId);
  return id ? db.invoices.get(id) : null;
}

/**
 * Create the deposit invoice for a bespoke commission.
 *
 * A deposit is a partial charge against a commission, not a full-price order,
 * so it gets its own invoice keyed by commission. Only a quoted commission can
 * be billed, and only if the week can still take it — billing a deposit the
 * kitchen cannot honour is the exact failure the capacity model exists to
 * prevent, just at the money step. Idempotent per commission.
 */
export function createCommissionDepositInvoice(commissionId) {
  const c = getCommission(commissionId);
  if (!c) return { error: "not_found" };
  if (c.status !== "quoted") return { error: "not_quoted" };
  if (!c.depositIdr || c.depositIdr <= 0) return { error: "no_deposit" };

  const week = weekStartOf(c.neededOn);
  if (bookedCakes(week) >= weekCapacity(week)) return { error: "week_full", week };

  const existing = db.invoiceByCommission.get(commissionId);
  if (existing) return { invoice: db.invoices.get(existing) };

  const invoice = {
    id: "DINV-" + String(++db.invSeq).padStart(5, "0"),
    kind: "commission_deposit",
    commissionId,
    amount: c.depositIdr,
    currency: "IDR",
    status: "pending",
    createdAt: Date.now(),
  };
  db.invoices.set(invoice.id, invoice);
  db.invoiceByCommission.set(commissionId, invoice.id);
  return { invoice };
}

/**
 * Record a refund against an order's invoice.
 *
 * The inventory reversal is store.cancelOrder's job; this is only the money
 * side. Safe to call for an order that was never paid (nothing to refund) and
 * idempotent once refunded. With a real provider this becomes the refund API
 * call; here it flips the ledger so the outbox and the account both read true.
 */
export function refundOrderInvoice(orderId) {
  const id = db.invoiceByOrder.get(orderId);
  const invoice = id ? db.invoices.get(id) : null;
  if (!invoice) return { refunded: false, reason: "no_invoice" };
  if (invoice.status === "refunded") return { refunded: true, invoice, replay: true };
  if (invoice.status !== "paid") return { refunded: false, reason: "not_paid" };
  invoice.status = "refunded";
  invoice.refundedAt = Date.now();
  return { refunded: true, invoice };
}

/**
 * Cancel an order and refund it in one call, so a route can never reverse the
 * stock without reversing the money or the other way round. The inventory
 * reversal is store.cancelOrder's job; refundOrderInvoice is the money side;
 * this just makes sure both run together, in order, for every caller.
 */
export async function cancelAndRefundOrder(orderId, actor) {
  const cancelled = await cancelOrder(orderId, { actor });
  if (cancelled.error) return cancelled;
  const refund = refundOrderInvoice(orderId);
  return { order: cancelled.order, refunded: refund.refunded };
}

export async function handlePaymentCallback(rawBody, signature) {
  if (!signatureValid(rawBody, signature)) return { error: "bad_signature" };

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { error: "bad_payload" };
  }

  // Anti-replay: the timestamp is inside the signed body, so an attacker who
  // captured an old signed callback cannot refresh it. Only enforced when the
  // provider sends one; the idempotency check below still guards the rest.
  if (payload?.ts != null) {
    const ts = Number(payload.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CALLBACK_MAX_AGE_MS)
      return { error: "stale_callback" };
  }

  const invoice = db.invoices.get(payload?.invoiceId);
  if (!invoice) return { error: "unknown_invoice" };
  if (payload?.status !== "PAID") return { error: "unhandled_status", status: payload?.status };
  if (invoice.status === "paid") {
    // Providers redeliver webhooks. Same answer both times, no double effects.
    return invoice.commissionId
      ? { commission: getCommission(invoice.commissionId), invoice, replay: true }
      : { order: await getOrder(invoice.orderId), invoice, replay: true };
  }

  // Amount mismatch means someone paid a different invoice than we issued.
  // Refuse and leave it unpaid for a human to look at.
  if (Number(payload?.amount) !== invoice.amount) return { error: "amount_mismatch" };

  // A bespoke deposit books the week the money lands, exactly like the manual
  // "deposit received" step it replaces. Capacity is enforced by advanceCommission,
  // so a race that filled the week leaves the deposit unbooked for a human.
  if (invoice.commissionId) {
    const c = getCommission(invoice.commissionId);
    if (!c) return { error: "unknown_commission" };
    if (c.status !== "quoted") return { error: "not_quoted", status: c.status };
    const adv = advanceCommission(invoice.commissionId); // quoted -> deposit_paid, checks the week
    if (adv.error) return adv;

    invoice.status = "paid";
    invoice.paidAt = Date.now();

    enqueueNotification({
      to: adv.commission.whatsapp,
      template: "commission_deposit_paid",
      payload: { commissionId: adv.commission.id, neededOn: adv.commission.neededOn },
    });
    return { commission: adv.commission, invoice };
  }

  const res = await markPaid(invoice.orderId);
  if (res.error) return res; // hold_expired: money arrived after the pastries were released

  invoice.status = "paid";
  invoice.paidAt = Date.now();

  // Queued, never inline: the receipt message must not be able to fail the payment.
  enqueueNotification({
    to: res.order.customer.whatsapp,
    template: "order_paid",
    payload: { orderId: res.order.id, pickupDate: res.order.pickupDate, slotTime: res.order.slotTime },
    orderId: res.order.id,
  });

  return { order: res.order, invoice };
}

export async function simulateProviderPayment(orderId) {
  const order = await getOrder(orderId);
  if (!order) return { error: "not_found" };
  const invoice = createInvoice(order); // orders from before this build get one on demand
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount, ts: Date.now() });
  const signature = signPayload(rawBody);
  return handlePaymentCallback(rawBody, signature);
}

export async function simulateCommissionDeposit(commissionId) {
  const made = createCommissionDepositInvoice(commissionId);
  if (made.error) return made;
  const invoice = made.invoice;
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount, ts: Date.now() });
  return handlePaymentCallback(rawBody, signPayload(rawBody));
}
