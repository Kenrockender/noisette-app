import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOrder } from "@/lib/store";
import { cancelAndRefundOrder } from "@/lib/payments";
import { enqueueNotification } from "@/lib/notifications";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const order = await getOrder((await params).id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ order });
}

/**
 * DELETE /api/orders/:id — the customer's own cancel.
 *
 * Guests have no session to prove ownership with, so this follows the same
 * rule as everything else in the account system: sign in with the number the
 * order was placed under to claim it, then cancel from there. A bare order id
 * is not treated as a bearer token for a money-moving action.
 */
export async function DELETE(_req, { params }) {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const order = await getOrder((await params).id);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (order.customerId !== session.customerId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await cancelAndRefundOrder((await params).id, "customer");
  if (result.error) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json(result, { status });
  }

  enqueueNotification({
    to: result.order.customer.whatsapp,
    template: "order_cancelled",
    payload: { orderId: result.order.id, refunded: result.refunded },
    orderId: result.order.id,
  });

  return NextResponse.json(result);
}
