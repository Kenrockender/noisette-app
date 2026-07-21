import { requireWholesale } from "@/lib/session";
import { saveStandingOrder, listStandingOrders, wholesaleSchedule, setStandingOrderActive } from "@/lib/store";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** GET: this account's standing orders plus the deliveries they generate. */
export async function GET() {
  const { res, customer } = await requireWholesale();
  if (res) return res;

  const standing = await listStandingOrders(customer.id, "wholesale");
  return Response.json({
    standingOrders: standing.map((s) => ({ ...s, weekdayName: WEEKDAYS[s.weekday] })),
    schedule: await wholesaleSchedule(customer.id),
  });
}

/**
 * POST: create or replace a standing order.
 *
 * 409 `wholesale_capacity` names the date and product that broke it, because
 * "we cannot do that" is useless to someone trying to plan a cafe.
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

  const result = await saveStandingOrder({
    id: body?.id,
    customerId: customer.id, // never from the body
    weekday: body?.weekday,
    items: body?.items,
    startsOn: body?.startsOn,
    endsOn: body?.endsOn,
  });

  if (result.error) {
    const conflict = ["wholesale_capacity", "below_moq", "not_sold_wholesale"].includes(result.error);
    return Response.json(result, { status: conflict ? 409 : 400 });
  }
  return Response.json(result, { status: 201 });
}

/** PATCH: pause or resume. { id, active } */
export async function PATCH(request) {
  const { res, customer } = await requireWholesale();
  if (res) return res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // Confirm the standing order belongs to this account before touching it.
  const mine = (await listStandingOrders(customer.id, "wholesale")).some((s) => s.id === body?.id);
  if (!mine) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await setStandingOrderActive(body.id, body.active);
  if (result.error) return Response.json(result, { status: 404 });
  return Response.json(result);
}
