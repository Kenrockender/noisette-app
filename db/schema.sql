-- Noisette Patissier, Phase 1 schema (PostgreSQL / Supabase / Neon)
-- Source of truth per PRD section 7. Redis carries the hot counters; these tables
-- carry the durable record, with CHECK constraints as the last line of
-- defence against overselling.

-- Noisette trades as two kitchens under one brand. La Boulangerie bakes bread
-- and viennoiserie, La Patisserie makes cakes, entremets and chocolates and
-- takes bespoke commissions.
CREATE TYPE house AS ENUM ('boulangerie', 'patisserie');

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  house         house NOT NULL,
  category      TEXT NOT NULL,
  price_idr     INTEGER NOT NULL CHECK (price_idr >= 0),
  -- Wholesale price is null for anything not sold B2B. Retail never reads it.
  wholesale_price_idr INTEGER CHECK (wholesale_price_idr >= 0),
  wholesale_moq INTEGER CHECK (wholesale_moq > 0),
  description   TEXT,
  allergens     TEXT,
  pairs_with    TEXT REFERENCES products(id),
  image_url     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A day's production, split at the source.
--
-- retail_allocated and wholesale_allocated are separate pools on purpose. A cafe
-- ordering 200 croissants must not be able to eat the 12 that retail scarcity is
-- built on, and retail must not be able to eat a contracted standing order. The
-- CHECK constraints bind each side to its own pool, so neither can borrow from
-- the other even if the application logic is wrong.
CREATE TABLE daily_inventory (
  id                   BIGSERIAL PRIMARY KEY,
  product_id           TEXT NOT NULL REFERENCES products(id),
  available_date       DATE NOT NULL,
  retail_allocated     INTEGER NOT NULL DEFAULT 0 CHECK (retail_allocated >= 0),
  retail_sold          INTEGER NOT NULL DEFAULT 0 CHECK (retail_sold >= 0),
  retail_held          INTEGER NOT NULL DEFAULT 0 CHECK (retail_held >= 0),
  wholesale_allocated  INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_allocated >= 0),
  wholesale_committed  INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_committed >= 0),
  UNIQUE (product_id, available_date),
  CHECK (retail_sold + retail_held <= retail_allocated),        -- zero retail overselling
  CHECK (wholesale_committed <= wholesale_allocated)            -- standing orders stay honoured
);

-- Total the kitchen actually has to bake that morning.
CREATE VIEW daily_production AS
  SELECT product_id, available_date,
         retail_allocated + wholesale_allocated AS to_bake
  FROM daily_inventory;

CREATE TABLE fulfillment_slots (
  id             BIGSERIAL PRIMARY KEY,
  slot_date      DATE NOT NULL,
  starts_at      TIME NOT NULL,
  ends_at        TIME NOT NULL,
  max_capacity   INTEGER NOT NULL CHECK (max_capacity > 0),
  booked_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (slot_date, starts_at),
  CHECK (booked_count >= 0 AND booked_count <= max_capacity)
);

CREATE TYPE customer_type AS ENUM ('retail', 'wholesale');

CREATE TABLE customers (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  -- Normalized to 62xxxxxxxxxx. This is the identity, so it is unique: two rows
  -- for one number would mean two people owning the same account.
  whatsapp     TEXT NOT NULL UNIQUE,
  email        TEXT,
  type         customer_type NOT NULL DEFAULT 'retail',
  -- B2B only. Null for retail customers.
  business_name  TEXT,
  billing_address TEXT,
  npwp           TEXT,                  -- Indonesian tax id, needed to invoice
  credit_terms_days INTEGER CHECK (credit_terms_days >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type = 'retail' OR business_name IS NOT NULL)
);
CREATE INDEX idx_customers_whatsapp ON customers (whatsapp);
CREATE INDEX idx_customers_type ON customers (type);

-- Sign-in is a six digit code over WhatsApp. There is no password to leak.
-- Store only a hash: a readable code in the database is a readable code in a
-- backup, and anyone holding it can become that customer.
CREATE TABLE auth_codes (
  id           BIGSERIAL PRIMARY KEY,
  whatsapp     TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_codes_whatsapp ON auth_codes (whatsapp, created_at DESC);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,        -- hash, never the raw token
  customer_id  BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_customer ON sessions (customer_id);

CREATE TYPE order_status AS ENUM
  ('awaiting_payment', 'paid', 'preparing', 'ready', 'collected', 'expired', 'cancelled');

-- Human-readable order numbers (N-0342, ...). orders.id is TEXT and supplied by
-- the application; this sequence is what the Postgres adapter draws the number
-- from, continuing the Phase 1 in-memory counter that started at 341.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 342;

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,             -- e.g. N-0342
  -- Null for guests. Guest checkout stays first class, so this is nullable on
  -- purpose and always will be.
  customer_id      BIGINT REFERENCES customers(id),
  -- Kept even for account orders: it is what lets a later sign-in claim guest
  -- orders placed on the same number.
  whatsapp         TEXT NOT NULL,
  contact_name     TEXT NOT NULL,
  channel          customer_type NOT NULL DEFAULT 'retail',  -- which pool it draws from
  status           order_status NOT NULL DEFAULT 'awaiting_payment',
  pickup_date      DATE NOT NULL,
  slot_id          BIGINT REFERENCES fulfillment_slots(id),  -- null for wholesale delivery
  gift_wrap        BOOLEAN NOT NULL DEFAULT FALSE,
  total_idr        INTEGER NOT NULL CHECK (total_idr >= 0),
  payment_method   TEXT,
  payment_ref      TEXT,                          -- Xendit/Midtrans invoice id
  hold_expires_at  TIMESTAMPTZ,                   -- 15-minute payment window
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A counter sale rung up on the spot: paid and handed over in the same
  -- motion, so it skips the slot and the awaiting_payment/hold dance entirely.
  is_walkin        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Retail collects in a slot, unless it was a walk-in. Wholesale is delivered
  -- and has none.
  CHECK (channel = 'wholesale' OR slot_id IS NOT NULL OR is_walkin)
);
CREATE INDEX idx_orders_pickup ON orders (pickup_date, status);
CREATE INDEX idx_orders_customer ON orders (customer_id, created_at DESC);
-- Powers claiming guest orders at sign-in.
CREATE INDEX idx_orders_claimable ON orders (whatsapp) WHERE customer_id IS NULL;

CREATE TABLE order_items (
  id          BIGSERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_price  INTEGER NOT NULL CHECK (unit_price >= 0)
);

-- Audit log for all critical inventory movements (PRD section 7)
CREATE TABLE inventory_transactions (
  id          BIGSERIAL PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  order_id    TEXT REFERENCES orders(id),
  date        DATE NOT NULL,
  delta       INTEGER NOT NULL,                   -- +allocation / -sale / +release
  reason      TEXT NOT NULL,                      -- 'allocation','hold','sale','hold_release','cancel_release','adjustment'
  pool        TEXT NOT NULL DEFAULT 'retail',     -- which pool moved: 'retail' | 'wholesale'
  actor       TEXT,                               -- staff user or 'system'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Phase 2, modelled but not yet built. Written down now so the shape is agreed
-- before code depends on the wrong one.
-- ===========================================================================

-- A standing order IS a subscription. "200 croissants every Tuesday" and
-- "a box of six every Friday" are the same machine with a different customer
-- type and a different invoice, so they share one table rather than two.
CREATE TABLE standing_orders (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel       customer_type NOT NULL,
  weekday       SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_on     DATE NOT NULL,
  ends_on       DATE,                             -- null means until cancelled
  paused_until  DATE,
  -- A paused-but-not-cancelled template. lib/store toggles this rather than
  -- deleting, so a subscription can be suspended and resumed without losing its
  -- history; an inactive template reserves no stock.
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE standing_order_items (
  id                BIGSERIAL PRIMARY KEY,
  standing_order_id BIGINT NOT NULL REFERENCES standing_orders(id) ON DELETE CASCADE,
  product_id        TEXT NOT NULL REFERENCES products(id),
  qty               INTEGER NOT NULL CHECK (qty > 0)
);

-- Reviews. Only from customers who actually bought and collected the thing,
-- which is why this hangs off order_items rather than products.
--
-- Moderation is three states, not a boolean. `lib/reviews.js` already runs
-- pending -> published | rejected: a rejected review is a decision the counter
-- made and can see in its history, which a boolean `published` erases. A
-- decided_at records when the moderator ruled, so the history is orderable.
CREATE TYPE review_status AS ENUM ('pending', 'published', 'rejected');

CREATE TABLE reviews (
  id            BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  customer_id   BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id),
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          TEXT,
  photo_url     TEXT,
  status        review_status NOT NULL DEFAULT 'pending',  -- staff moderate before it shows
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_product ON reviews (product_id) WHERE status = 'published';
CREATE INDEX idx_reviews_moderation ON reviews (status, created_at);

-- Outbound WhatsApp, queued rather than sent inline. A failed send must never
-- fail an order that has already taken the customer's money.
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  order_id    TEXT REFERENCES orders(id) ON DELETE CASCADE,
  whatsapp    TEXT NOT NULL,
  template    TEXT NOT NULL,                      -- 'order_paid','ready_for_pickup','review_request'
  payload     JSONB,
  status      TEXT NOT NULL DEFAULT 'queued',     -- queued | sent | failed
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  send_after  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_pending ON notifications (send_after) WHERE status = 'queued';

-- Bespoke cake commissions.
--
-- Deliberately NOT in daily_inventory. A commission has no allocation to
-- decrement: it is a conversation, a quote, a deposit and a date. Forcing it
-- into the per-day stock model is what would break the whole thing.
CREATE TYPE commission_status AS ENUM
  ('enquiry', 'quoted', 'deposit_paid', 'in_production', 'ready', 'collected', 'declined');

CREATE TABLE commissions (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    BIGINT REFERENCES customers(id),
  whatsapp       TEXT NOT NULL,
  -- The enquirer's contact name. Guests have no customers row to read it
  -- from (customer_id is nullable, same as orders), so it is captured here
  -- directly, exactly as lib/commissions.js's in-memory adapter does.
  name           TEXT NOT NULL DEFAULT '',
  status         commission_status NOT NULL DEFAULT 'enquiry',
  needed_on      DATE NOT NULL,
  servings       INTEGER CHECK (servings > 0),
  brief          TEXT NOT NULL,
  reference_urls TEXT[],
  quote_idr      INTEGER CHECK (quote_idr >= 0),
  deposit_idr    INTEGER CHECK (deposit_idr >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (deposit_idr IS NULL OR quote_idr IS NULL OR deposit_idr <= quote_idr)
);
CREATE INDEX idx_commissions_needed ON commissions (needed_on, status);

-- Kitchen capacity for bespoke work is counted in cakes per week, not units
-- per day. This is the constraint that stops the patisserie accepting six
-- wedding cakes for the same Saturday.
CREATE TABLE commission_capacity (
  week_starting  DATE PRIMARY KEY,
  max_cakes      INTEGER NOT NULL CHECK (max_cakes >= 0),
  booked_cakes   INTEGER NOT NULL DEFAULT 0,
  CHECK (booked_cakes <= max_cakes)
);

-- ===========================================================================
-- Phase 2.5. Tables the code grew into after the first Phase 2 pass. Written
-- down here so schema.sql stops trailing lib/*.js.
-- ===========================================================================

-- Per-occurrence overrides for a standing order's derived deliveries.
--
-- A delivery is DERIVED from its template and never materialized, so the only
-- durable facts are the two that cannot be derived: "this Tuesday was skipped"
-- and "this Tuesday has been packed / handed to the driver". Mirrors the two
-- Maps in lib/deliveries.js (deliverySkips, deliveryStages). A skip does NOT
-- free the wholesale pool for that date: the allocation stays the account's.
CREATE TYPE delivery_stage AS ENUM ('pending', 'packed', 'delivered');

CREATE TABLE delivery_overrides (
  id                BIGSERIAL PRIMARY KEY,
  standing_order_id BIGINT NOT NULL REFERENCES standing_orders(id) ON DELETE CASCADE,
  delivery_date     DATE NOT NULL,
  skipped           BOOLEAN NOT NULL DEFAULT FALSE,
  stage             delivery_stage NOT NULL DEFAULT 'pending',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (standing_order_id, delivery_date),
  -- A skipped occurrence is never in the delivery run, so it has no stage.
  CHECK (NOT skipped OR stage = 'pending')
);
CREATE INDEX idx_delivery_overrides_date ON delivery_overrides (delivery_date);

-- The six picks for a "Signature Box of 6". The box is its own SKU with its own
-- allocation (giftbox6 in daily_inventory); these rows only record which six
-- signatures the customer chose, for the counter to assemble. They do not
-- decrement the individual SKUs, exactly as "pick the six at the counter" reads.
CREATE TABLE order_gift_contents (
  id            BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id),
  qty           INTEGER NOT NULL CHECK (qty > 0)
);

-- Wholesale onboarding. A retail customer applies to become a B2B account; a
-- member of staff approves or rejects. On approval the decision is copied onto
-- the customer row (type -> 'wholesale', business_name / billing_address / npwp),
-- so this table is the application history and the customer row is the live
-- state. One live application per customer, hence the UNIQUE. Mirrors the
-- `application` object lib/store hangs off a customer in the in-memory backend.
CREATE TYPE wholesale_application_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE wholesale_applications (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    BIGINT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  business_name  TEXT NOT NULL,
  address        TEXT NOT NULL,
  npwp           TEXT,
  status         wholesale_application_status NOT NULL DEFAULT 'pending',
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);
CREATE INDEX idx_wholesale_applications_status ON wholesale_applications (status, submitted_at);

-- Hampers custom orders. Requested by ci Ariel as its own flow, deliberately
-- NOT the bespoke enquiry -> quote -> deposit pipeline: a hampers order has no
-- quote stage and no weekly capacity, because ci Ariel recaps every request
-- by hand and only opens WhatsApp herself once, to chase payment. `paid` and
-- `sent` are the two flags that pipeline needs, each flipped independently
-- from the counter: money landing and the hamper actually going out are two
-- separate events, not one status. Mirrors `commissions` in shape
-- (guest-first, one form, one contact), not in status flow.
--
-- `budget_idr` is unused by the app since 2026-07-27 (dropped from the form
-- when ci Ariel asked for per-recipient address + card instead) but kept
-- rather than dropped, to avoid a destructive column drop on a live table.
--
-- `recipients` is a JSONB array of {address, cardFrom, cardTo}, one entry per
-- hamper being sent out — a single request is often several hampers to
-- several addresses (e.g. 5 hampers for 5 recipients), each with its own
-- card, so this is a list rather than flat columns. Sanitized shape only
-- (see lib/hampers/*.js); no relational table since nothing ever queries a
-- recipient on its own.
CREATE TABLE hampers_orders (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   BIGINT REFERENCES customers(id),
  whatsapp      TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  contents      TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty > 0),
  needed_on     DATE NOT NULL,
  budget_idr    INTEGER CHECK (budget_idr >= 0),
  notes         TEXT,
  recipients    JSONB NOT NULL DEFAULT '[]'::jsonb,
  paid          BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at       TIMESTAMPTZ,
  sent          BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hampers_needed ON hampers_orders (needed_on);
CREATE INDEX idx_hampers_paid ON hampers_orders (paid, created_at);

-- Staff sessions for the counter PIN (lib/staff.js). One shared tablet today,
-- so a session is a token and a shift-length expiry, no per-person identity yet.
-- Store only the hash, same reasoning as auth_codes and customer sessions.
CREATE TABLE staff_sessions (
  token_hash  TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoices, one row per billable document. Retail QRIS orders reference their
-- provider invoice via orders.payment_ref; this table is the durable ledger the
-- payment seam (lib/payments.js) mints from, and it also carries the two Phase
-- 2.5 additions: a bespoke deposit charge, and a wholesale monthly statement.
CREATE TYPE invoice_kind AS ENUM ('order', 'commission_deposit', 'wholesale_month');
CREATE TYPE invoice_status AS ENUM ('pending', 'paid', 'refunded', 'expired', 'void');

CREATE TABLE invoices (
  id             TEXT PRIMARY KEY,               -- e.g. INV-00042 / WINV-202607-3
  kind           invoice_kind NOT NULL,
  order_id       TEXT REFERENCES orders(id),
  commission_id  BIGINT REFERENCES commissions(id),
  customer_id    BIGINT REFERENCES customers(id),
  amount_idr     INTEGER NOT NULL CHECK (amount_idr >= 0),
  status         invoice_status NOT NULL DEFAULT 'pending',
  provider_ref   TEXT,                            -- Xendit/Midtrans id
  expires_at     TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  refunded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one subject per invoice.
  CHECK (num_nonnulls(order_id, commission_id) <= 1)
);
CREATE INDEX idx_invoices_order ON invoices (order_id);
CREATE INDEX idx_invoices_commission ON invoices (commission_id);

-- orders.status already carries 'cancelled'; a refund is recorded on the
-- invoice above (status = 'refunded', refunded_at set), so the order and its
-- money stay in one place each.

-- ===========================================================================
-- Plan.md #5 cutover additions: two small pieces the pg adapters need that had
-- no table yet. Written down here rather than left implicit in code.
-- ===========================================================================

-- Human-readable invoice numbers (INV-00042, DINV-00007), continuing the
-- Phase 1 in-memory counter which shared one sequence between order invoices
-- and bespoke deposit invoices. Same doctrine as order_number_seq above.
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- The day-before reminder sweep (lib/reminders.js) must enqueue each reminder
-- at most once, the same guarantee the in-memory Set gives it. A durable table
-- is required here (not a derived query) because "was this reminder already
-- sent" is not recoverable from the notifications row once it exists — two
-- different reminders can share a template with different payloads on
-- different days. One row per (kind, subject, date) reservation; the INSERT's
-- ON CONFLICT DO NOTHING is the atomic compare-and-set.
CREATE TABLE reminder_log (
  reminder_key TEXT PRIMARY KEY,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
