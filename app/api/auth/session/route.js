import { cookies } from "next/headers";
import { verifyOtp, createSession, readSession, destroySession, SESSION_COOKIE, displayWhatsapp } from "@/lib/auth";
import { upsertCustomer, getCustomer, claimGuestOrders } from "@/lib/store";

export const dynamic = "force-dynamic";

const shape = (c, extra = {}) => ({
  customer: { id: c.id, name: c.name, whatsapp: displayWhatsapp(c.whatsapp), type: c.type },
  ...extra,
});

/** POST: exchange a valid OTP for a session. */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const res = await verifyOtp(body?.whatsapp, body?.code);
  if (res.error) {
    const status = res.error === "too_many_attempts" ? 429 : 401;
    return Response.json(res, { status });
  }

  const customer = await upsertCustomer(res.whatsapp, { name: body?.name });
  // The number is proven, so any guest order placed with it is genuinely theirs.
  const { claimed } = await claimGuestOrders(customer.id);

  const { token, maxAge } = await createSession(customer.id);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });

  return Response.json(shape(customer, { claimedOrders: claimed }));
}

/** GET: who am I. 204 rather than 401, because "nobody" is a normal answer. */
export async function GET() {
  const s = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return new Response(null, { status: 204 });
  const c = await getCustomer(s.customerId);
  if (!c) return new Response(null, { status: 204 });
  return Response.json(shape(c));
}

/** DELETE: sign out. */
export async function DELETE() {
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
