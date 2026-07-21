/**
 * Which backend is live (plan.md #5).
 *
 * The whole migration is gated on environment, not a code switch. When the
 * Postgres and Redis connection strings are present the real adapters run;
 * when they are not (local `npm run dev` with nothing provisioned, and every
 * `node --test` run in CI) the in-memory maps that shipped Phase 1 stay in
 * charge. One codebase, two backends, chosen by what is configured.
 *
 * This is deliberately not the "repository abstraction only" option: the
 * Postgres and Redis adapters are real and wired here. The in-memory path is
 * kept solely so the test suite and a bare checkout still run without any
 * infrastructure, which is a property worth not losing.
 */

/** True when Supabase/Neon Postgres is configured. */
export function hasPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * True when Upstash Redis is configured. Upstash's REST client needs both the
 * URL and the token; either one missing means fall back rather than half-connect.
 */
export function hasRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * A production deploy must have both. Fail-closed, same doctrine as the OTP
 * sender and payment webhook: a serverless instance silently running on its own
 * in-memory maps would lose every session and oversell stock the moment it
 * scaled past one instance. Better to refuse to boot.
 */
export function assertProductionBackends() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = [];
  if (!hasPostgres()) missing.push("DATABASE_URL");
  if (!hasRedis()) missing.push("UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN");
  if (missing.length) {
    throw new Error(
      `Refusing to start in production without durable state. Missing: ${missing.join(", ")}. ` +
        `See db/README.md.`
    );
  }
}
