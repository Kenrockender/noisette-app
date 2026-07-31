/**
 * Runs the real test suite against a real Postgres wire protocol, not the
 * in-memory adapter.
 *
 * plan.md's own record is explicit that lib/store/pg.js was verified this way
 * once, and the five modules cut over after it (commissions, deliveries,
 * notifications, reviews, the invoice ledger in payments) never were — only
 * `node --check` and the in-memory test run. This closes that gap without
 * needing Docker or a provisioned Supabase/Neon instance: PGlite runs a real
 * Postgres (WASM build of the actual server, not an emulation) in-process,
 * and @electric-sql/pglite-socket speaks the real wire protocol over a local
 * TCP port, so `pg` (what lib/db/pg.js already uses) connects to it exactly
 * like it would to Supabase. DATABASE_URL is the only thing that changes.
 *
 * PGlite is single-writer under the hood, so this forces one pool connection
 * (PG_POOL_MAX=1) and one test file at a time (--test-concurrency=1) to keep
 * pglite-socket's query queue from deadlocking two genuinely concurrent
 * transactions against the same in-process database. That is a limitation of
 * this harness, not of the app: a real Postgres handles the pool this app
 * actually ships with (PG_POOL_MAX default 5) without either constraint.
 *
 * Usage: npm run test:pg
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 28543; // arbitrary, unlikely to collide with a real local Postgres on 5432

async function main() {
  console.log("[verify-pg] booting PGlite (a real Postgres, WASM build)...");
  const db = new PGlite();
  await db.waitReady;

  const schema = readFileSync(path.join(root, "db/schema.sql"), "utf8");
  console.log("[verify-pg] applying db/schema.sql...");
  await db.exec(schema);

  // maxConnections defaults to 1; lib/db/pg.js's pool opens up to PG_POOL_MAX
  // (default 5) concurrent connections, so leaving this at 1 resets every
  // connection past the first with ECONNRESET.
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  const databaseUrl = `postgres://postgres@127.0.0.1:${PORT}/postgres`;
  console.log(`[verify-pg] listening on ${databaseUrl}`);

  // PGlite is single-writer under the hood — pglite-socket's multiplexer queues
  // queries across connections but does not give concurrent transactions true
  // session isolation, so two connections each mid-transaction (this app holds
  // SELECT ... FOR UPDATE locks across several statements) can deadlock the
  // queue rather than one just waiting on the other's lock like real Postgres.
  // Forcing one pool connection and one test file at a time sidesteps that
  // entirely; it is a harness constraint, not a statement about the app.
  const env = { ...process.env, DATABASE_URL: databaseUrl, PG_POOL_MAX: "1" };

  const run = (label, cmd, args) =>
    new Promise((resolve, reject) => {
      console.log(`\n[verify-pg] ${label}`);
      const child = spawn(cmd, args, { cwd: root, env, stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`))));
      child.on("error", reject);
    });

  try {
    await run("seeding products (db/seed-products.mjs)...", process.execPath, ["db/seed-products.mjs"]);
    await run("running node --test against the Postgres adapters...", process.execPath, ["--test", "--test-concurrency=1"]);
    console.log("\n[verify-pg] PASS: the full suite is green against real Postgres.");
  } finally {
    await server.stop();
    await db.close();
  }
}

main().catch((err) => {
  console.error("\n[verify-pg] FAIL:", err.message);
  process.exitCode = 1;
});
