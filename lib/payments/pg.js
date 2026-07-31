import { query, transaction } from "../db/pg.js";
import { getOrder, markPaid, cancelOrder } from "../store.js";
import { getCommission, advanceCommission, weekStartOf, weekCapacity, bookedCakes } from "../commissions.js";
import { enqueueNotification } from "../notifications.js";
import { signatureValid, signPayload, CALLBACK_MAX_AGE_MS } from "./crypto.js";

const toMs = (v) => (v == null ? null : new Date(v).getTime());

// lib/commissions.js hands out ids as "B-0004"; the invoices.commission_id
// column is the bare BIGINT behind that prefix (see lib/commissions/pg.js's
// own formatId/parseId). Every query against that column must convert first,
// or Postgres rejects "B-0004" as an invalid bigint literal outright.
const commissionDbId = (id) => parseInt(String(id).replace(/^B-/, ""), 10);

function mapInvoice(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    orderId: row.order_id,
    commissionId: row.commission_id != null ? String(row.commission_id) : undefined,
    customerId: row.customer_id != null ? String(row.customer_id) : undefined,
    amount: row.amount_idr,
    currency: "IDR",
    status: row.status,
    providerRef: row.provider_ref,
    expiresAt: toMs(row.expires_at),
    paidAt: toMs(row.paid_at),
    refundedAt: toMs(row.refunded_at),
    createdAt: toMs(row.created_at),
  };
}

export async function createInvoice(order) {
  let q = await query(`SELECT * FROM invoices WHERE order_id = $1`, [order.id]);
  if (q.rows.length > 0) return mapInvoice(q.rows[0]);

  const expiresAt = order.holdExpiresAt ? new Date(order.holdExpiresAt) : null;
  const res = await query(`
    INSERT INTO invoices (id, kind, order_id, amount_idr, status, expires_at)
    VALUES ('INV-' || lpad(nextval('invoice_number_seq')::text, 5, '0'), 'order', $1, $2, 'pending', $3)
    RETURNING *
  `, [order.id, order.total, expiresAt]);
  
  const invoice = mapInvoice(res.rows[0]);
  order.paymentRef = invoice.id;
  return invoice;
}

export async function invoiceForOrder(orderId) {
  const q = await query(`SELECT * FROM invoices WHERE order_id = $1`, [orderId]);
  return q.rows.length > 0 ? mapInvoice(q.rows[0]) : null;
}

export async function createCommissionDepositInvoice(commissionId) {
  const c = await getCommission(commissionId);
  if (!c) return { error: "not_found" };
  if (c.status !== "quoted") return { error: "not_quoted" };
  if (!c.depositIdr || c.depositIdr <= 0) return { error: "no_deposit" };

  const week = weekStartOf(c.neededOn);
  if (await bookedCakes(week) >= await weekCapacity(week)) return { error: "week_full", week };

  const dbCommissionId = commissionDbId(commissionId);
  let q = await query(`SELECT * FROM invoices WHERE commission_id = $1 AND kind = 'commission_deposit'`, [dbCommissionId]);
  if (q.rows.length > 0) return { invoice: mapInvoice(q.rows[0]) };

  const res = await query(`
    INSERT INTO invoices (id, kind, commission_id, amount_idr, status)
    VALUES ('DINV-' || lpad(nextval('invoice_number_seq')::text, 5, '0'), 'commission_deposit', $1, $2, 'pending')
    RETURNING *
  `, [dbCommissionId, c.depositIdr]);
  
  return { invoice: mapInvoice(res.rows[0]) };
}

/**
 * `existingClient` — same reasoning as advanceCommission/markPaid: lets a
 * caller already inside its own transaction (cancelAndRefundOrder, below)
 * run this on that SAME connection instead of opening a second one.
 */
export async function refundOrderInvoice(orderId, existingClient) {
  const run = async (client) => {
    const q = await client.query(`SELECT * FROM invoices WHERE order_id = $1 FOR UPDATE`, [orderId]);
    const invoice = q.rows.length > 0 ? mapInvoice(q.rows[0]) : null;
    if (!invoice) return { refunded: false, reason: "no_invoice" };
    if (invoice.status === "refunded") return { refunded: true, invoice, replay: true };
    if (invoice.status !== "paid") return { refunded: false, reason: "not_paid" };

    const updated = await client.query(`
      UPDATE invoices SET status = 'refunded', refunded_at = now()
      WHERE order_id = $1 RETURNING *
    `, [orderId]);

    return { refunded: true, invoice: mapInvoice(updated.rows[0]) };
  };
  return existingClient ? run(existingClient) : transaction(run);
}

/**
 * Cancelling releases stock/slot (lib/store/pg.js's cancelOrder) and refunds
 * the invoice (refundOrderInvoice above) — two writes that must land
 * together. Both used to open their own transactions on separate pooled
 * connections, so a failure in the refund step after cancelOrder had already
 * committed could leave an order cancelled with its invoice still "paid".
 * Wrapping both in one transaction here, on one shared client, closes that
 * gap the same way handlePaymentCallback's nested-transaction fix did.
 */
export async function cancelAndRefundOrder(orderId, actor) {
  return transaction(async (client) => {
    const cancelled = await cancelOrder(orderId, { actor, client });
    if (cancelled.error) return cancelled;
    const refund = await refundOrderInvoice(orderId, client);
    return { order: cancelled.order, refunded: refund.refunded };
  });
}

export async function handlePaymentCallback(rawBody, signature) {
  if (!signatureValid(rawBody, signature)) return { error: "bad_signature" };

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { error: "bad_payload" };
  }

  if (payload?.ts != null) {
    const ts = Number(payload.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CALLBACK_MAX_AGE_MS)
      return { error: "stale_callback" };
  }

  return transaction(async (client) => {
    const { rows: invRows } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [payload?.invoiceId]);
    if (invRows.length === 0) return { error: "unknown_invoice" };
    const invoice = mapInvoice(invRows[0]);
    
    if (payload?.status !== "PAID") return { error: "unhandled_status", status: payload?.status };
    if (invoice.status === "paid") {
      return invoice.commissionId
        ? { commission: await getCommission(invoice.commissionId, client), invoice, replay: true }
        : { order: await getOrder(invoice.orderId, client), invoice, replay: true };
    }

    if (Number(payload?.amount) !== invoice.amount) return { error: "amount_mismatch" };

    if (invoice.commissionId) {
      const c = await getCommission(invoice.commissionId, client);
      if (!c) return { error: "unknown_commission" };
      if (c.status !== "quoted") return { error: "not_quoted", status: c.status };
      // Pass this transaction's own client through so the advance commits
      // (or rolls back) together with the invoice update below, instead of
      // on its own separate connection — see the comment on advanceCommission.
      const adv = await advanceCommission(invoice.commissionId, client);
      if (adv.error) return adv;

      const updated = await client.query(`
        UPDATE invoices SET status = 'paid', paid_at = now() 
        WHERE id = $1 RETURNING *
      `, [invoice.id]);
      const updatedInv = mapInvoice(updated.rows[0]);

      enqueueNotification({
        to: adv.commission.whatsapp,
        template: "commission_deposit_paid",
        payload: { commissionId: adv.commission.id, neededOn: adv.commission.neededOn },
      });
      return { commission: adv.commission, invoice: updatedInv };
    }

    // Same reasoning as the commission branch above: share this client so
    // the sale and the invoice's paid status commit or roll back together.
    const res = await markPaid(invoice.orderId, client);
    if (res.error) return res;

    const updated = await client.query(`
      UPDATE invoices SET status = 'paid', paid_at = now() 
      WHERE id = $1 RETURNING *
    `, [invoice.id]);
    const updatedInv = mapInvoice(updated.rows[0]);

    enqueueNotification({
      to: res.order.customer.whatsapp,
      template: "order_paid",
      payload: { orderId: res.order.id, pickupDate: res.order.pickupDate, slotTime: res.order.slotTime },
      orderId: res.order.id,
    });

    return { order: res.order, invoice: updatedInv };
  });
}

export async function simulateProviderPayment(orderId) {
  const order = await getOrder(orderId);
  if (!order) return { error: "not_found" };
  const invoice = await createInvoice(order);
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount, ts: Date.now() });
  const signature = signPayload(rawBody);
  return handlePaymentCallback(rawBody, signature);
}

export async function simulateCommissionDeposit(commissionId) {
  const made = await createCommissionDepositInvoice(commissionId);
  if (made.error) return made;
  const invoice = made.invoice;
  const rawBody = JSON.stringify({ invoiceId: invoice.id, status: "PAID", amount: invoice.amount, ts: Date.now() });
  return handlePaymentCallback(rawBody, signPayload(rawBody));
}
