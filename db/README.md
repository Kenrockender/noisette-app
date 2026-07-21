# Durable state: Postgres + Redis (plan.md #5)

Phase 1 kept everything in `globalThis` maps. That is correct for one process and
wrong for the moment the app scales past it: a second serverless instance has its
own maps, so sessions vanish between requests and two instances happily oversell
the same croissant. This directory is the migration to durable, shared state.

## Split of responsibilities

- **Postgres (Supabase / Neon)** — the durable record: products, daily inventory,
  orders and order items, customers, standing orders, reviews, notifications,
  commissions, deliveries, invoices, and the inventory audit log. Schema in
  [`schema.sql`](./schema.sql). CHECK constraints are the last line of defence
  against overselling, independent of the application logic.
- **Redis (Upstash)** — the hot, expiring layer: OTP codes with a real TTL,
  rate-limit windows, customer and staff sessions, and the live stock counters
  that decrement atomically under contention.

The backend is chosen by environment (see `lib/db/backend.js`), not a code flag.
With nothing configured the app runs the Phase 1 in-memory maps, so `node --test`
and a bare `npm run dev` still work. Production requires both and refuses to boot
without them.

## Provisioning

You do this part; the app cannot create accounts or hold your credentials.

### 1. Postgres (Supabase or Neon)

1. Create a project in Supabase or Neon.
2. Copy the **pooled** connection string (Supabase port `6543` with
   `?pgbouncer=true`, or Neon's "Pooled connection" host). Serverless functions
   are short-lived; the pooler keeps them from each grabbing a direct connection.
3. Put it in `.env.local` as `DATABASE_URL`.
4. Apply the schema:
   ```sh
   psql "$DATABASE_URL" -f db/schema.sql
   ```

### 2. Redis (Upstash)

1. Create a Redis database in the Upstash console.
2. From its **REST API** section copy the URL and token.
3. Put them in `.env.local` as `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.

### 3. Install drivers and run

```sh
npm install          # pulls pg and @upstash/redis (added to package.json)
npm run dev
```

## ID scheme

The Phase 1 code uses human-readable string ids (`C-0001`, `S-001`, `N-0342`).
To keep every route and UI component unchanged, the migration keeps those ids as
`TEXT` primary keys rather than the `BIGSERIAL` originally sketched for
`customers`, `standing_orders`, and `commissions`. If you prefer integer keys
later, that is a schema + route change, tracked as a follow-up.

## Migration status

Foundation is in place (`lib/db/pg.js`, `lib/db/redis.js`, `lib/db/backend.js`,
this guide, `.env.example`, drivers). The per-module cutover from in-memory maps
to these adapters is tracked in [`../plan.md`](../plan.md) section 5.
