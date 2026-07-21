import { currentCustomer } from "@/lib/session";
import { saveStandingOrder, listStandingOrders, setStandingOrderActive, subscriptionSchedule, deleteStandingOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Retail subscriptions. "A box of six every Friday" is the same machine as
 * "200 croissants every Tuesday": one standing_orders table, channel retail,
 * retail prices, drawn from the retail pool, paid at pickup.
 */

/** GET: my subscriptions and the pickups they generate. */
export async function GET() {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const subs = await listStandingOrders(c.id, "retail");
  return Response.json({
    subscriptions: subs.map((s) => ({ ...s, weekdayName: WEEKDAYS[s.weekday] })),
    schedule: await subscriptionSchedule(c.id),
  });
}

/** POST { weekday, items }: create, or edit quantity/weekday with { id } to replace. */
export async function POST(request) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const result = await saveStandingOrder({
    id: body?.id,
    customerId: c.id, // session, never body
    weekday: body?.weekday,
    items: body?.items,
    channel: "retail",
  });

  if (result.error) {
    return Response.json(result, { status: result.error === "retail_capacity" ? 409 : 400 });
  }
  return Response.json(result, { status: 201 });
}

/** PATCH { id, active }: pause or resume. */
export async function PATCH(request) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const mine = (await listStandingOrders(c.id, "retail")).some((s) => s.id === body?.id);
  if (!mine) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await setStandingOrderActive(body.id, body.active);
  if (result.error) return Response.json(result, { status: 404 });
  return Response.json(result);
}

/** DELETE ?id=...: stop a subscription for good, not just pause. */
export async function DELETE(request) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const result = await deleteStandingOrder(id, c.id);
  if (result.error) return Response.json(result, { status: 404 });
  return Response.json(result);
}
