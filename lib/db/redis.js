/**
 * Upstash Redis for the hot path (plan.md #5).
 *
 * Redis carries what Postgres should not: the six-digit OTP with a real TTL,
 * per-number and per-tablet rate-limit windows, customer and staff session
 * tokens, and the atomic stock counters that DECRBY under contention without a
 * row lock. The durable record still lands in Postgres; Redis is the fast,
 * expiring layer in front of it.
 *
 * Upstash's REST client is used rather than a TCP client because it survives
 * serverless cold starts and needs no connection pool. Imported lazily so a
 * checkout without the package or the env still runs the in-memory path.
 */
import { hasRedis } from "./backend.js";

const g = globalThis;

async function makeClient() {
  const { Redis } = await import("@upstash/redis");
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

/** The shared Redis client, created on first use. Throws if not configured. */
export async function redis() {
  if (!hasRedis()) throw new Error("Upstash Redis env is not set; Redis backend is unavailable.");
  if (!g.__noisetteRedis) g.__noisetteRedis = makeClient();
  return g.__noisetteRedis;
}

/** Key namespacing, so one Upstash database can be shared without collisions. */
export const rk = {
  otp: (whatsapp) => `otp:${whatsapp}`,
  otpRate: (whatsapp) => `otp:rate:${whatsapp}`,
  session: (tokenHash) => `sess:${tokenHash}`,
  staffSession: (tokenHash) => `staff:sess:${tokenHash}`,
  staffAttempts: () => `staff:attempts`,
  // Live stock counters, one per SKU per day, decremented on hold.
  retailHeld: (date, productId) => `stock:held:${date}:${productId}`,
};
