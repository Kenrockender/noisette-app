import { createHmac, timingSafeEqual } from "node:crypto";

/** Dev fallback only. `sign` and `verify` refuse to use it in production. */
export const DEV_SECRET = "noisette-dev-webhook-secret";

export function secret() {
  const s = process.env.PAYMENT_WEBHOOK_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") return null; // fail closed
  return DEV_SECRET;
}

/** HMAC-SHA256 over the raw body, hex. What the provider header carries. */
export function signPayload(rawBody) {
  const s = secret();
  if (!s) return null;
  return createHmac("sha256", s).update(rawBody).digest("hex");
}

export function signatureValid(rawBody, signature) {
  const expected = signPayload(rawBody);
  if (!expected || !signature) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How old a timestamped callback may be before it is refused as a replay. */
export const CALLBACK_MAX_AGE_MS = 5 * 60 * 1000;
