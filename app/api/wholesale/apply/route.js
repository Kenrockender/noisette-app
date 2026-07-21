import { currentCustomer } from "@/lib/session";
import { applyForWholesale } from "@/lib/store";

export const dynamic = "force-dynamic";

/** POST /api/wholesale/apply  { businessName, address, npwp } */
export async function POST(request) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  // Applies for the session's own account. A customerId in the body would let
  // anyone apply on someone else's behalf.
  const res = await applyForWholesale(c.id, body ?? {});
  if (res.error) {
    const status = res.error === "missing_fields" ? 400 : 409;
    return Response.json(res, { status });
  }
  return Response.json(res, { status: 201 });
}
