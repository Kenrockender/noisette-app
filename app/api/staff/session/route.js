import { cookies } from "next/headers";
import { STAFF_COOKIE, staffSignIn, staffSignOut, isStaff, demoPinHint } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** GET: is this browser staff? Includes the demo PIN in development only. */
export async function GET() {
  const authed = await isStaff((await cookies()).get(STAFF_COOKIE)?.value);
  return Response.json({ authed, demoPin: authed ? undefined : demoPinHint() });
}

/** POST { pin } */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const res = await staffSignIn(body?.pin);
  if (res.error) {
    const status =
      res.error === "rate_limited" ? 429
      : res.error === "not_configured" ? 503
      : 401;
    return Response.json(res, { status });
  }

  (await cookies()).set(STAFF_COOKIE, res.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: res.maxAge,
    path: "/",
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  await staffSignOut((await cookies()).get(STAFF_COOKIE)?.value);
  (await cookies()).delete(STAFF_COOKIE);
  return new Response(null, { status: 204 });
}
