import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { hasRedis } from "./db/backend.js";
import { redis, rk } from "./db/redis.js";

/**
 * Staff auth for the counter.
 *
 * A PIN, not accounts. The counter is a tablet by the pass shared by whoever
 * is on shift; per-person accounts with passwords would be theatre that ends
 * with the PIN taped to the tablet anyway. One shared PIN, rotated by changing
 * an environment variable, held in a cookie for the length of a shift.
 *
 * Fail-closed, same doctrine as the OTP sender and the payment webhook: in
 * production the PIN comes from STAFF_PIN or sign-in is impossible. There is
 * no production default. A guessable default PIN on a route that reallocates
 * stock is the same open door this whole codebase keeps refusing to ship.
 *
 * The dev fallback PIN exists so the demo is usable, and the sign-in screen
 * says what it is, the same way the OTP screen shows its demo code.
 */

export const STAFF_COOKIE = "noisette_staff";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one shift, morning bake to close
const SESSION_TTL_S = SESSION_TTL_MS / 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_S = ATTEMPT_WINDOW_MS / 1000;
const ATTEMPT_MAX = 10;

const DEV_PIN = "080808";

const g = globalThis;
const st = (g.__noisetteStaff ??= {});
st.sessions ??= new Map(); // token -> expiresAt
st.attempts ??= []; // timestamps of failed tries, all callers pooled

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

function configuredPin() {
  if (process.env.STAFF_PIN) return process.env.STAFF_PIN;
  if (process.env.NODE_ENV === "production") return null; // fail closed
  return DEV_PIN;
}

/** Shown on the sign-in screen in development only, like the OTP demo code. */
export function demoPinHint() {
  if (process.env.NODE_ENV === "production" || process.env.STAFF_PIN) return null;
  return DEV_PIN;
}

async function tooManyAttempts() {
  if (hasRedis()) {
    const r = await redis();
    const hits = await r.get(rk.staffAttempts());
    return Number(hits || 0) >= ATTEMPT_MAX;
  }
  const now = Date.now();
  st.attempts = st.attempts.filter((t) => now - t < ATTEMPT_WINDOW_MS);
  return st.attempts.length >= ATTEMPT_MAX;
}

async function recordFailedAttempt() {
  if (hasRedis()) {
    const r = await redis();
    const hits = await r.incr(rk.staffAttempts());
    if (hits === 1) await r.expire(rk.staffAttempts(), ATTEMPT_WINDOW_S);
    return;
  }
  st.attempts.push(Date.now());
}

function samePin(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function staffSignIn(pin) {
  const expected = configuredPin();
  if (!expected) return { error: "not_configured" };
  if (await tooManyAttempts()) return { error: "rate_limited" };

  if (!samePin(String(pin || "").trim(), expected)) {
    await recordFailedAttempt();
    return { error: "wrong_pin" };
  }

  const token = randomBytes(32).toString("hex");
  if (hasRedis()) {
    const r = await redis();
    // Store only the token hash, with the shift TTL. Never the raw token.
    await r.set(rk.staffSession(sha256(token)), "1", { ex: SESSION_TTL_S });
  } else {
    st.sessions.set(token, Date.now() + SESSION_TTL_MS);
  }
  return { token, maxAge: Math.floor(SESSION_TTL_S) };
}

export async function staffSignOut(token) {
  if (!token) return;
  if (hasRedis()) {
    const r = await redis();
    await r.del(rk.staffSession(sha256(token)));
    return;
  }
  st.sessions.delete(token);
}

export async function isStaff(token) {
  if (!token) return false;
  if (hasRedis()) {
    const r = await redis();
    return Boolean(await r.get(rk.staffSession(sha256(token))));
  }
  const exp = st.sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    st.sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * The guard every /api/admin/* route runs first. Reads the cookie itself so
 * no route invents its own idea of who is staff.
 */
export async function requireStaff() {
  const jar = await cookies(); // async since Next 15
  const token = jar.get(STAFF_COOKIE)?.value;
  if (!(await isStaff(token))) {
    return { res: Response.json({ error: "staff_only" }, { status: 401 }) };
  }
  return {};
}
