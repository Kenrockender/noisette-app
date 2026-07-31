/**
 * Postgres pool for Supabase / Neon (plan.md #5).
 *
 * One pool per process, parked on globalThis so Next's dev HMR does not open a
 * new pool on every reload and exhaust the connection limit (Supabase's pooler
 * and Neon both cap connections hard). Import `pg` lazily so a checkout with no
 * DATABASE_URL and no `pg` installed still runs the in-memory path.
 *
 * Serverless note: point DATABASE_URL at the connection-pooler endpoint
 * (Supabase port 6543 / Neon pooled host), not the direct 5432, so short-lived
 * function invocations share connections instead of each grabbing one.
 */
import { hasPostgres } from "./backend.js";

const g = globalThis;

/**
 * Supabase and Neon require TLS, so that is the default. But forcing `ssl` at
 * a local Postgres (Docker, or the pglite harness in scripts/verify-pg.mjs)
 * makes the connection fail outright rather than just being unnecessary —
 * `localhost`/`127.0.0.1` is never a real cloud provider, so it is the one
 * signal safe enough to flip TLS off for. `no-verify` keeps it simple for the
 * pooler host in the TLS case; swap to a CA bundle if you pin certificates.
 */
export function sslFor(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  } catch {
    // Unparseable; fail toward the safer default (require TLS) below.
  }
  return { rejectUnauthorized: false };
}

async function makePool() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslFor(process.env.DATABASE_URL),
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => console.error("[pg] idle client error", err));
  return pool;
}

/** The shared pool, created on first use. Throws if Postgres is not configured. */
export async function pool() {
  if (!hasPostgres()) throw new Error("DATABASE_URL is not set; Postgres backend is unavailable.");
  if (!g.__noisettePgPool) g.__noisettePgPool = makePool();
  return g.__noisettePgPool;
}

/** Run one query. `rows` back, same shape as node-postgres. */
export async function query(text, params) {
  const p = await pool();
  return p.query(text, params);
}

/**
 * Run `fn` inside a single transaction with its own client.
 *
 * This is the seam every money- or stock-moving write goes through, so an order
 * that reserves five items either reserves all five or none. BEGIN, hand the
 * client to `fn`, COMMIT on success, ROLLBACK on any throw, and always release
 * the client back to the pool.
 */
export async function transaction(fn) {
  const p = await pool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A rollback that itself fails means the connection is already broken;
      // releasing it below discards it. Nothing useful to do here.
    }
    throw err;
  } finally {
    client.release();
  }
}
