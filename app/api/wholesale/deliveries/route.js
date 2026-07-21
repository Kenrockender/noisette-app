import { requireWholesale } from "@/lib/session";
import { deliveriesFor, invoicesFor, setDeliverySkipped } from "@/lib/deliveries";

export const dynamic = "force-dynamic";

/** GET: this account's deliveries (with skip/stage state) and derived invoices. */
export async function GET() {
  const { res, customer } = await requireWholesale();
  if (res) return res;

  return Response.json({
    deliveries: await deliveriesFor(customer.id),
    invoices: await invoicesFor(customer.id),
  });
}

/**
 * POST: { standingOrderId, date, skip } — skip or un-skip one occurrence.
 * 409 `too_late` inside the two-day cutoff; the kitchen has planned the bake.
 */
export async function POST(request) {
  const { res, customer } = await requireWholesale();
  if (res) return res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const result = await setDeliverySkipped({
    customerId: customer.id, // session, never body
    standingOrderId: body?.standingOrderId,
    date: body?.date,
    skip: !!body?.skip,
  });

  if (result.error) {
    const status =
      result.error === "not_found" || result.error === "no_such_delivery" ? 404
      : ["too_late", "already_in_progress"].includes(result.error) ? 409
      : 400;
    return Response.json(result, { status });
  }
  return Response.json(result);
}
