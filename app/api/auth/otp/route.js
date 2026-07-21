import { issueOtp } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/otp  { whatsapp }
 *
 * Always answers the same shape whether or not the number has an account. Saying
 * "no account found" here would turn this into a free tool for checking which
 * phone numbers shop at Noisette.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const res = await issueOtp(body?.whatsapp);

  if (res.error === "invalid_number") return Response.json(res, { status: 400 });
  if (res.error === "rate_limited") return Response.json(res, { status: 429 });
  if (res.error === "delivery_failed") return Response.json(res, { status: 503 });

  return Response.json(res);
}
