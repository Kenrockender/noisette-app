import { deliveriesOn, advanceDelivery } from "@/lib/deliveries";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** GET ?date=YYYY-MM-DD: the delivery run for one trading day. */
export async function GET(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const date = new URL(request.url).searchParams.get("date");
  if (!date) return Response.json({ error: "missing_date" }, { status: 400 });
  return Response.json({ deliveries: await deliveriesOn(date) });
}

/** PATCH { standingOrderId, date }: pending -> packed -> delivered. */
export async function PATCH(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const res = await advanceDelivery(body?.standingOrderId, body?.date);
  if (res.error) {
    const status = res.error === "no_such_delivery" ? 404 : 409;
    return Response.json(res, { status });
  }
  return Response.json(res);
}
