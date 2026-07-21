# Noisette Patissier, Phase 2.5 roadmap

**Status: all 15 items shipped.** Three (5 reminders, 11 admin date range, most
of 12 schema catch-up) were already done when this pass started — the "backend
state" column below was stale by the time anyone read it again, which is its
own lesson: re-check a roadmap's own claims against the code before trusting
its sequencing. The remaining twelve were implemented in the order below,
each with tests where the change touched money or stock, and verified live in
the browser. See `README.md` for the current API surface and what is
implemented; the analysis below is left as the record of how the plan was
built, not as an outstanding task list.

A prioritized plan for the 15 candidate features, each checked against the code
in `noisette-app/` rather than the wishlist alone. The headline finding: most of
the highest-value items are cheap, because the backend already exists and only
the UI is missing. The expensive items (refunds, full localisation) are also the
least urgent. That shape lets you ship visible wins fast and defer the hard money
and i18n work until it is actually needed.

## How things were scored

**Effort** is S (a few hours), M (a day or two), L (several days, or blocked on a
third party). **Impact** weighs customer-visible value, revenue, and risk of
data or trust loss. **State** records what already exists, because in this
codebase the gap between "feels missing" and "is missing" is often just a
component.

The single most useful fact for planning: the data layer (`lib/*.js`) is far
ahead of both the UI (`components/*.js`) and the schema (`db/schema.sql`). Six of
the fifteen items are UI-only work over functions that already return the right
data.

## The tiers at a glance

| # | Feature | Effort | Impact | Backend state |
|---|---|---|---|---|
| 15 | Permanent test suite | M | High (leverage) | Ad-hoc only |
| 12 | schema.sql catch-up | M | High (foundation) | Drifted behind code |
| 10 | Add-to-calendar button | S | Medium | Button is a no-op |
| 6 | Ratings on cards & site | S | Medium | `publishedReviews` returns stats |
| 7 | Review moderation history | S | Medium | `listReviewsForModeration(status)` takes the arg already |
| 1 | Bespoke customer tracking | S–M | High | `commissionsFor()` + `?mine=1` done, no UI |
| 13 | Inventory audit log | M | Medium | Table modelled, never written |
| 11 | Admin date range | S–M | Medium | Hard-coded `nextOpenDates(5)` |
| 4 | Wholesale profile edit | M | Medium | Address locked at application |
| 3 | Subscription edit & cancel | M | Medium | PATCH only toggles `active` |
| 9 | Gift-box picker | M | Medium | "Pick six at the counter" placeholder |
| 5 | Notification reminders | M | High | Outbox works, templates missing |
| 2 | Bespoke deposit via payment seam | M | High | Payment seam exists, not wired to commissions |
| 14 | Bahasa consistency | L | Medium | Copy is mixed, no i18n scaffold |
| 8 | Retail cancel & refund | L | Medium | `cancelled` status exists, no path |

---

## Tier 0 — Foundations (do these first)

These do not ship a feature by themselves, but they make every later item
cheaper and safer. Both are cheap now and expensive to retrofit.

### 15. Permanent test suite

Your tests live outside the repo, so nothing protects the anti-oversell logic
that the whole business rests on. The good news is the domain logic is pure
functions in `lib/` (`createOrder`, `expireHolds`, `markPaid`, `advanceCommission`,
`saveStandingOrder`) with no framework entanglement, which makes them unusually
testable. Add `node --test` (zero dependencies, already in Node 18+), wire an
`npm test` script, and port your existing ad-hoc cases. Prioritise the
concurrency guard (two shoppers, one last croissant), hold expiry, and the
capacity refusals. Do this first so every item below ships against a green bar.

### 12. schema.sql catch-up

`db/schema.sql` still calls itself the source of truth, but the code has moved
past it: `reviews.published` is a boolean while `lib/reviews.js` runs a three-state
`pending | published | rejected`; there is no table for delivery skips/stages,
derived invoices, staff sessions, or subscription edits. Because the store is
in-memory this breaks nothing at runtime, which is exactly why it will rot
quietly until the Postgres migration, where it becomes a painful archaeology
job. Reconcile it now while the shapes are fresh: convert the review column to a
status enum, add `delivery_overrides` (skip + stage per occurrence), a
`staff_sessions` table, and decide whether invoices stay derived or become rows.
Pairs naturally with item 13.

---

## Tier 1 — Quick wins (high value per hour, mostly UI)

Each of these is small because the data layer already does the work. Ship them
as a batch; they are the most visible improvement for the least code.

### 10. Add-to-calendar button

The button at `OrderApp.js:651` renders and does nothing. Generate an `.ics`
blob from the order's pickup date and slot, plus a Google Calendar template URL
as a fallback. No backend, no dependency, an hour of work. Best first commit to
prove the test harness.

### 6. Ratings on catalog cards & the website

`publishedReviews()` already returns `{ count, average }`, and the product page
renders stars from it (`OrderApp.js:446`). The average simply is not surfaced on
the catalog cards or the site showcase. Thread the stats into the card component
and the `/` showcase. Small, and it lifts conversion where buyers actually
decide.

### 7. Review moderation history

`listReviewsForModeration(status)` already accepts a status argument, but the
counter only ever asks for `pending`, so published and rejected reviews vanish
from staff view. Add a two- or three-tab switch (Pending / Published / Rejected)
in the Reviews tab of `AdminDash.js`. Almost entirely front-end.

### 1. Bespoke customer tracking

Flagged as customers going blind after sending a brief — the sharpest UX gap on
the list, and the backend is done. `commissionsFor(whatsapp)` and the
`/api/commissions?mine=1` route already return status. What is missing is a
"my cakes" section in `AccountSheet.js` showing the pipeline stage
(enquiry → quoted → deposit → production → ready). S–M, high value.

---

## Tier 2 — Real product gaps (medium effort)

Genuine missing capability, but bounded and mostly independent. Sequence by
whichever pain is loudest for the shop.

### 13. Inventory audit log

`inventory_transactions` is modelled but never written. Add append-only writes at
each mutation in `lib/store.js` (allocation, hold, sale, release, adjustment)
with an actor. Best done alongside item 12 so schema and writer land together.
Medium; unlocks "why is the count wrong" answers staff currently cannot get.

### 11. Admin date range

`nextOpenDates(5)` is hard-coded, so the counter's rail shows five days while
wholesale deliveries are scheduled 28 days out — runs outside the window are
invisible. Parameterise the horizon and give admin a longer rail (or a
date picker). S–M; the care is in not letting the retail catalog rail grow to 28
by accident, since they share the helper.

### 4. Wholesale profile edit

Delivery address is captured once at application and then locked. Add a PATCH to
the wholesale profile and an edit form in `WholesalePortal.js`. Medium; watch
that an address change does not silently rewrite historical delivery records.

### 3. Subscription edit & cancel

`PATCH /api/account/subscriptions` only flips `active` (pause/resume). Customers
cannot change quantity or weekday, or stop permanently via `endsOn`. The store
function `saveStandingOrder` already supports replace semantics and `endsOn`, so
this is wiring the route and the account-sheet UI to it, keeping the
all-or-nothing capacity check on any quantity increase. Medium.

### 9. Gift-box picker

"Pick the six at the counter" is an honest placeholder, not a feature. Building
the picker means letting the customer choose six items at order time and carrying
those selections on the order. Medium, and worth a short brainstorm on whether
the six draw down stock individually (they should, to stay consistent with the
anti-oversell model) — that decision is the real work, not the UI.

### 5. Notification reminders

The outbox (`lib/notifications.js`) works and drains, but only reactive templates
exist (paid, ready, wholesale decision, commission received/quoted). The
reminders on your list — pickup H-1, "bespoke ready", "delivery tomorrow" — have
no templates and nothing enqueues them on a schedule. Add the templates, then a
scheduled sweep that enqueues day-before reminders. Medium; high value for
no-show reduction. In this environment the sweep can be a scheduled task; in
production it is the BullMQ worker the README already anticipates.

---

## Tier 3 — Larger or dependent (schedule deliberately)

### 2. Bespoke deposit via payment seam

Today staff mark "deposit received" by hand. The payment seam (`lib/payments.js`,
signed webhook) is built for retail orders and is reusable, but a deposit is a
partial charge against a commission, not a full-price order, so it needs its own
invoice path and a `commission_deposit_paid` template. Medium, and it reads best
after item 5 (templates) and item 1 (tracking) so the customer sees the deposit
request and its result. Booking capacity already keys off `deposit_paid`, so the
state machine is ready for it.

### 8. Retail cancel & refund

The `cancelled` status exists in the schema, but there is no path to reach it
after payment, and no refund. This is the largest item: it is money moving
backwards, it depends on the real payment provider (refunds are a provider API,
not something the demo seam can fake honestly), and it needs rules about how late
a cancel frees the stock hold back into the pool. Defer until Xendit/Midtrans is
actually wired in; scoping it earlier risks building a refund flow against a
provider you have not chosen.

### 14. Bahasa consistency

Copy is mixed English/Indonesian with no i18n layer. Doing this properly is a
string-extraction pass across every component plus a consistent Bahasa
translation, which is broad rather than deep — lots of surface, low per-string
difficulty. It touches almost every file, so it is best done as one dedicated
sweep once the feature set has stopped moving, otherwise you re-translate churn.
Large by volume. Consider a lightweight message catalog now (even without a
library) so new copy lands in one place going forward.

---

## Recommended sequence

1. **Foundations:** 15 (tests), then 12 (schema) — de-risk everything after.
2. **Quick-win batch:** 10, 6, 7, 1 — visible progress in days, all over
   existing backends.
3. **Gap batch:** 13 + 11 together, then 4, 3, 9 as shop pain dictates.
4. **Reminders & deposits:** 5, then 2 (2 leans on 5's templates).
5. **Deferred:** 8 (wait for the real payment provider), 14 (one sweep after the
   feature set settles).

## One caveat on the whole list

Everything here runs on the in-memory store, which the README is candid about:
"everything here dies with the process." None of these fifteen features is
production-real until the Postgres/Redis migration lands. If a real launch is
close, that migration outranks every product item on this page — so it is worth
deciding launch timing before committing to this order. If the goal is to keep
proving the product in the demo, this sequence stands as written.
