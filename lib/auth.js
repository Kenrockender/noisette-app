import { randomInt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { hasRedis } from "./db/backend.js";
import { redis, rk } from "./db/redis.js";

/**
 * WhatsApp OTP sign-in.
 *
 * Indonesia runs on WhatsApp, and every customer already gives us their number
 * at checkout to receive the pickup code. So the number is the identity and
 * there is no password to forget, reuse, or leak.
 *
 * IMPORTANT, read before deploying:
 *
 *   The code is not actually sent anywhere yet. In development it comes back in
 *   the API response so the flow is testable. In production that would hand
 *   anyone an account for any number they can type, so `issueOtp` refuses to
 *   return it outside development. Until the WhatsApp Business API is wired into
 *   `deliverOtp`, sign-in in production simply cannot complete. That is
 *   deliberate: failing closed beats shipping an open door.
 *
 * Storage (plan.md #5): when Upstash Redis is configured the OTP, its rate
 * limit, and the session tokens live in Redis with real TTLs; codes and tokens
 * are stored HASHED, never in the clear, so a snapshot of Redis cannot be
 * replayed as a login. With no Redis configured the whole thing runs on the
 * in-memory maps below, which is what `node --test` and a bare dev server use.
 */

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_TTL_S = OTP_TTL_MS / 1000;
const OTP_MAX_ATTEMPTS = 5; // per code, then it burns
const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;
const OTP_RATE_WINDOW_S = OTP_RATE_WINDOW_MS / 1000;
const OTP_RATE_MAX = 5; // per number per window
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_S = SESSION_TTL_MS / 1000;

export const SESSION_COOKIE = "noisette_session";

const g = globalThis;
if (!g.__noisetteAuth) {
  g.__noisetteAuth = {
    otps: new Map(), // whatsapp -> { code, expiresAt, attempts }
    rate: new Map(), // whatsapp -> number[] (request timestamps)
    sessions: new Map(), // token -> { customerId, expiresAt }
  };
}
const store = g.__noisetteAuth;

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

/** Digits only, so "0812-3456" and "0812 3456" are the same person. */
export function normalizeWhatsapp(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return null;
  // 08xx and +628xx and 628xx are all the same Indonesian number.
  let n = digits;
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (n.startsWith("620")) n = "62" + n.slice(3);
  if (!n.startsWith("62")) n = "62" + n;
  return n.length >= 10 && n.length <= 15 ? n : null;
}

/** Pretty form for display. Never used as a key. */
export function displayWhatsapp(n) {
  if (!n) return "";
  const local = n.startsWith("62") ? "0" + n.slice(2) : n;
  return local.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** Constant-time equality for two same-length hex strings. */
function sameHex(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function rateLimited(whatsapp) {
  if (hasRedis()) {
    const r = await redis();
    const hits = await r.incr(rk.otpRate(whatsapp));
    if (hits === 1) await r.expire(rk.otpRate(whatsapp), OTP_RATE_WINDOW_S);
    // incr already counted this request, so the cap is exceeded above MAX.
    return hits > OTP_RATE_MAX;
  }
  const now = Date.now();
  const hits = (store.rate.get(whatsapp) || []).filter((t) => now - t < OTP_RATE_WINDOW_MS);
  hits.push(now);
  store.rate.set(whatsapp, hits);
  return hits.length > OTP_RATE_MAX;
}

/**
 * Where the WhatsApp Business API call goes. Until it exists this only logs, so
 * `issueOtp` treats delivery as having failed in production.
 */
async function deliverOtp(whatsapp, code) {
  if (process.env.NODE_ENV === "production") return { delivered: false, reason: "whatsapp_not_configured" };
  console.log(`[auth] OTP for ${whatsapp} is ${code} (dev only, not sent)`);
  return { delivered: true };
}

export async function issueOtp(rawWhatsapp) {
  const whatsapp = normalizeWhatsapp(rawWhatsapp);
  if (!whatsapp) return { error: "invalid_number" };
  if (await rateLimited(whatsapp)) return { error: "rate_limited" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  if (hasRedis()) {
    const r = await redis();
    // Store only the hash, with the code's TTL; attempts are their own counter.
    await r.set(rk.otp(whatsapp), sha256(code), { ex: OTP_TTL_S });
    await r.del(`${rk.otp(whatsapp)}:att`);
  } else {
    store.otps.set(whatsapp, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  }

  const sent = await deliverOtp(whatsapp, code);
  if (!sent.delivered) return { error: "delivery_failed", reason: sent.reason };

  return {
    ok: true,
    whatsapp,
    // Dev convenience only. issueOtp cannot reach this line in production
    // because deliverOtp fails closed above.
    demoCode: process.env.NODE_ENV === "production" ? undefined : code,
  };
}

export async function verifyOtp(rawWhatsapp, code) {
  const whatsapp = normalizeWhatsapp(rawWhatsapp);
  if (!whatsapp) return { error: "invalid_number" };
  const given = String(code || "").trim();

  if (hasRedis()) {
    const r = await redis();
    const otpKey = rk.otp(whatsapp);
    const codeHash = await r.get(otpKey);
    if (!codeHash) return { error: "no_code" }; // absent or TTL-expired

    const attKey = `${otpKey}:att`;
    const attempts = await r.incr(attKey);
    if (attempts === 1) await r.expire(attKey, OTP_TTL_S);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await r.del(otpKey, attKey);
      return { error: "too_many_attempts" };
    }
    if (!sameHex(sha256(given), codeHash)) {
      return { error: "code_wrong", attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
    }
    await r.del(otpKey, attKey, rk.otpRate(whatsapp)); // single use, clear the rate window too
    return { ok: true, whatsapp };
  }

  const rec = store.otps.get(whatsapp);
  if (!rec) return { error: "no_code" };
  if (Date.now() > rec.expiresAt) {
    store.otps.delete(whatsapp);
    return { error: "code_expired" };
  }
  rec.attempts += 1;
  if (rec.attempts > OTP_MAX_ATTEMPTS) {
    store.otps.delete(whatsapp);
    return { error: "too_many_attempts" };
  }
  if (!sameHex(sha256(rec.code), sha256(given))) {
    return { error: "code_wrong", attemptsLeft: OTP_MAX_ATTEMPTS - rec.attempts };
  }
  store.otps.delete(whatsapp); // single use
  store.rate.delete(whatsapp);
  return { ok: true, whatsapp };
}

export async function createSession(customerId) {
  const token = randomBytes(32).toString("hex");
  if (hasRedis()) {
    const r = await redis();
    // Key on the token's hash, so Redis never holds a usable bearer token.
    await r.set(rk.session(sha256(token)), String(customerId), { ex: SESSION_TTL_S });
  } else {
    store.sessions.set(token, { customerId, expiresAt: Date.now() + SESSION_TTL_MS });
  }
  return { token, maxAge: Math.floor(SESSION_TTL_S) };
}

export async function readSession(token) {
  if (!token) return null;
  if (hasRedis()) {
    const r = await redis();
    const customerId = await r.get(rk.session(sha256(token)));
    return customerId ? { customerId: String(customerId) } : null;
  }
  const s = store.sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    store.sessions.delete(token);
    return null;
  }
  return s;
}

export async function destroySession(token) {
  if (!token) return;
  if (hasRedis()) {
    const r = await redis();
    await r.del(rk.session(sha256(token)));
    return;
  }
  store.sessions.delete(token);
}
