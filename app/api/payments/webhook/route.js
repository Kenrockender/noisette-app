// Relative on purpose: node --test exercises this handler directly (see
// test/routes.test.js) and node does not resolve the "@/" alias.
import { handlePaymentCallback } from "../../../../lib/payments.js";
import { notifyAdminDay } from "../../../../lib/adminEvents.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/webhook
 *
 * Where the payment provider's callback points. The signature is computed over
 * the RAW body, so the body is read as text and never re-serialized before
 * verification; JSON.parse then stringify can reorder keys and break the HMAC.
 *
 * Every payment in this build goes through here (the demo QR tap included),
 * so the verification path runs constantly instead of first running in
 * production.
 */
export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-callback-signature");

  const res = await handlePaymentCallback(rawBody, signature);
  if (res.error) {
    const status =
      res.error === "bad_signature" ? 401
      : res.error === "unknown_invoice" || res.error === "not_found" ? 404
      : res.error === "hold_expired" ? 409
      : 400;
    return Response.json(res, { status });
  }
  if (res.order) notifyAdminDay(res.order.pickupDate);

  // A retail callback resolves to an order; a bespoke deposit callback
  // resolves to a commission. Either way the provider gets its 200 — a thrown
  // TypeError here turned successful deposits into an infinite retry loop.
  return Response.json({ ok: true, id: res.order?.id ?? res.commission?.id, replay: !!res.replay });
}
