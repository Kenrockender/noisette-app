import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth";
import { getCustomerOrders } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/account/orders returns the signed-in customer's order history. */
export async function GET() {
  const s = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return Response.json({ error: "not_signed_in" }, { status: 401 });

  // Scoped by session, never by a client-supplied id. An id in the query string
  // would let anyone read anyone's order history.
  return Response.json({ orders: await getCustomerOrders(s.customerId) });
}
