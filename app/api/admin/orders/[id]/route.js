import { advanceOrder } from "@/lib/store";
import { cancelAndRefundOrder } from "@/lib/payments";
import { enqueueNotification } from "@/lib/notifications";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/orders/:id  { to? }
 *
 * Omit `to` to step one stage. Pass it to jump (the counter scans a code for an
 * order still marked preparing and hands it over in one move). Backwards moves
 * are refused: an order that has left the building has left the building.
 */
export async function PATCH(request, { params }) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body means "advance one stage", which is the common case
  }

  const res = await advanceOrder((await params).id, body?.to);
  if (res.error) {
    const status = res.error === "not_found" ? 404 : 409;
    return Response.json(res, { status });
  }

  // Queued, not sent. The stage has already advanced; a WhatsApp outage must
  // not un-advance it or error this request.
  if (res.order.status === "ready") {
    enqueueNotification({
      to: res.order.customer.whatsapp,
      template: "order_ready",
      payload: { orderId: res.order.id },
      orderId: res.order.id,
    });
  }

  return Response.json(res);
}

/**
 * DELETE /api/admin/orders/:id — staff cancel and refund.
 *
 * Same door a customer's own cancel uses (cancelAndRefundOrder), so a
 * staff-initiated cancel and a self-serve one leave the identical trail:
 * stock back on the shelf, the invoice refunded, one notification either way.
 */
export async function DELETE(_req, { params }) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const result = await cancelAndRefundOrder((await params).id, "staff");
  if (result.error) {
    const status = result.error === "not_found" ? 404 : 409;
    return Response.json(result, { status });
  }

  enqueueNotification({
    to: result.order.customer.whatsapp,
    template: "order_cancelled",
    payload: { orderId: result.order.id, refunded: result.refunded },
    orderId: result.order.id,
  });

  return Response.json(result);
}
