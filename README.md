# Noisette Patissier, web platform (Phase 1 MVP)

Pre-order platform for the Jl. Bondowoso storefront. Built from PRD v2.2 and the
La Vitrine wireframes.

## Two houses

Noisette is one brand trading as two kitchens.

**La Boulangerie** bakes bread and viennoiserie to a daily allocation. That model
is the spine of this whole codebase: a number per SKU per day, counted down to
zero, never oversold.

**La Patisserie** makes cakes, entremets and chocolates. Its stock items use the
same allocation model. Its bespoke commissions do not, and that matters:

> A custom cake has no allocation to decrement. It is a brief, a quote, a
> deposit and a date, two weeks out. Its capacity is measured in cakes per week,
> not units per day. Forcing it into `daily_inventory` would break the model
> rather than extend it. `commissions` and `commission_capacity` in
> `db/schema.sql` are the shape it should take. Nothing is built yet.

`house` is the top filter in the ordering app, above category, because which
kitchen you are buying from is a bigger question than which shelf.

## Three products, one repo

This is the thing to understand before changing anything here.

**The website (`/`)** introduces the bakery to someone who has never been: what
we make, why the numbers are small, where we are, when we are open. Wide
editorial layout, serif display type, French section names, no checkout. Every
CTA hands the visitor to the app.

**The app (`/order`)** assumes you already know all of that. No hero, no story,
no address block. It is a tool: pick a day, pick pastries, pick a window, pay,
get a code. Narrow, dense, sticky chrome, plain sentence-case copy.

**The counter (`/admin`)** counts what the other two did. Daily allocations,
slot capacity, and the fulfillment hub. Tabular, tablet-sized, no serif and no
photography anywhere in it. The fulfillment buttons are oversized because staff
hit them with flour on their hands.

They share brand tokens and a few primitives in `app/globals.css`. They share no
layout. The `.site-`, `.app-` and `.admin-` prefixes keep the lines visible. If a
`.site-` rule starts being useful inside the app, that usually means the bakery
is being introduced twice.

The date rail at the top of the catalog is the app's one structural opinion.
Stock is allocated per day, so "4 left" means nothing until you know which day.
Picking the day first makes the number on every card true for the order you are
actually placing.

## Run it

Requires Node.js 18+.

```bash
cd noisette-app
npm install
npm run dev
```

The QRIS screen is a simulation. Tap the code to pay.

```bash
npm test
```

## What is implemented

Catalog with a pickup-date rail and category filters, per-date scarcity tags,
rating stats on both the catalog cards and the site showcase, product page with
pairs-with navigation, bag sheet with gift-box wrap and a picker for the
Signature Box's six, pickup slots with live capacity, guest checkout (name and
WhatsApp), payment method selection, a 15-minute stock hold with countdown, a
confirmation pass with order number and pickup code, an add-to-calendar button
(.ics and a Google Calendar link), and a customer-facing cancel with refund.

The anti-oversell logic from PRD section 6 is real. `POST /api/orders` reserves
stock and slot capacity atomically and all-or-nothing, holds expire after 15
minutes and are released, and paying converts holds to sales. Two shoppers cannot
buy the same last croissant.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/products` | GET | Product catalog |
| `/api/availability?date=YYYY-MM-DD` | GET | Per-date stock and slot capacity |
| `/api/orders` | POST | Create order and 15-min hold (409 on `insufficient_stock` / `slot_full`); optional `giftContents` picks the six for a Signature Box |
| `/api/orders/:id` | GET / DELETE | Order status; customer's own cancel and refund (401 unless signed in and it's yours, 409 `too_late` / `not_cancellable`) |
| `/api/orders/:id/pay` | POST | Payment confirmation (webhook stand-in) |
| `/api/admin/day?date=YYYY-MM-DD` | GET | Inventory, slots, orders, totals and the inventory audit log for one trading day |
| `/api/admin/inventory` | PATCH | Re-allocate a SKU (409 `below_committed`) |
| `/api/admin/slots` | PATCH | Set window capacity (409 `below_booked`) |
| `/api/admin/orders/:id` | PATCH / DELETE | Advance fulfillment stage (409 `cannot_go_backwards`); staff cancel and refund |
| `/api/auth/otp` | POST | Send a sign-in code (429 `rate_limited`) |
| `/api/auth/session` | POST / GET / DELETE | Sign in, who am I, sign out |
| `/api/account/orders` | GET | Order history, scoped to the session |
| `/api/wholesale/me` | GET / PATCH | Portal state: anonymous, retail, or wholesale (prices only after approval); edit business name, delivery address, NPWP |
| `/api/wholesale/apply` | POST | Apply for a wholesale account (409 `already_pending`) |
| `/api/wholesale/standing` | GET / POST / PATCH | Standing orders and schedule; create/replace; pause/resume (409 `wholesale_capacity` / `below_moq`) |
| `/api/admin/wholesale` | GET / PATCH | Pending applications and all standing orders; approve or reject |
| `/api/reviews?product=id` | GET | Published reviews and stats, public |
| `/api/reviews?mine=1` | GET | My reviews and what I could still review (session) |
| `/api/reviews?all=1` | GET | Rating stats for every product, public (catalog cards and the site showcase) |
| `/api/reviews` | POST | Review a collected order line (403 `not_your_order`, 409 `not_collected` / `already_reviewed`) |
| `/api/admin/reviews?status=` | GET / PATCH | Moderation queue, defaults to `pending` (also `published` / `rejected`); publish or reject |
| `/api/admin/notifications` | GET / PATCH | Outbox (GET also runs the worker once); requeue a failed send |
| `/api/payments/webhook` | POST | Provider callback, HMAC-verified (401 `bad_signature`) |
| `/api/staff/session` | POST / GET / DELETE | Staff PIN sign-in for the counter (429 `rate_limited`) |
| `/api/wholesale/deliveries` | GET / POST | Deliveries with skip/stage state and derived invoices; skip one occurrence (409 `too_late`) |
| `/api/admin/deliveries` | GET / PATCH | The day's delivery run; pending → packed → delivered |
| `/api/commissions` | POST / GET | Bespoke enquiry, guests welcome (409 `too_soon`); `?mine=1` for status |
| `/api/commissions/:id/pay` | POST | The customer's own "pay deposit" tap, through the signed payment seam (409 `week_full` / `no_deposit`) |
| `/api/admin/commissions` | GET / PATCH | Pipeline and week capacity; quote, advance (deposit goes through the same signed door), decline |
| `/api/account/subscriptions` | GET / POST / PATCH / DELETE | Weekly retail subscriptions (409 `retail_capacity`); create, edit qty/weekday, pause/resume, end for good |

## Accounts (Phase 2)

Sign-in is a six digit code over WhatsApp. The number is the identity: every
customer already gives it at checkout to receive the pickup code, so there is no
password to forget and nothing extra to ask for.

**Guest checkout is untouched.** Nobody is made to sign in to buy a croissant.
An account is an upgrade, never a toll gate.

The nice part is claiming. Orders keep the number they were placed with, so
signing in later with that number pulls every past guest order into the new
account. The "save this order to an account" button on the confirmation screen
works precisely because of this, and it used to be a button that did nothing.

Read before you deploy:

- **The code is not sent anywhere yet.** `deliverOtp` in `lib/auth.js` is a stub.
  In development the code comes back in the API response so the flow is
  testable. In production that would hand anyone an account for any number they
  can type, so `issueOtp` refuses to return it and sign-in cannot complete until
  the WhatsApp Business API is wired in. That is deliberate. Failing closed beats
  shipping an open door.
- Codes are single use, expire in five minutes, allow five wrong guesses before
  burning, and are rate limited to five per number per fifteen minutes.
- `customerId` on an order is read from the session cookie only, never from the
  request body. Trusting the body would let anyone staple their order to a
  stranger's account.
- Codes and session tokens are in memory here. In production they belong in Redis
  and Postgres respectively, and `db/schema.sql` stores only hashes of both.

Both admin write routes refuse to promise what is already gone: allocation
cannot drop below sold plus held, and capacity cannot drop below booked. The
fulfillment stage only moves forwards.

## Security

`/admin` is behind a staff PIN (`lib/staff.js`): a shared PIN for the tablet by
the pass, held in an httpOnly cookie for a twelve-hour shift, rate limited to
ten tries per fifteen minutes. Every `/api/admin/*` route runs `requireStaff()`
first; the page never sees data before the cookie does.

Fail-closed, like everything else here: in production the PIN comes from the
`STAFF_PIN` environment variable and there is no default, so an unconfigured
deployment cannot be signed into at all. In development the PIN is `080808`
and the sign-in screen says so, the same way the OTP screen shows its demo
code.

## Photography

`public/photos/` holds Unsplash placeholders, imported statically through
`lib/photos.js` so Next reads their real dimensions and generates blur
placeholders. They are the right shape and the wrong pastry. See
`public/photos/CREDITS.md`. To swap in real work, drop a file at the same path.

## From demo to production

Data lives in an in-memory store (`lib/store.js`). Its function interface,
`getAvailability`, `createOrder`, `markPaid` and `expireHolds`, is the contract
to keep. To go live:

1. **PostgreSQL.** Apply `db/schema.sql` on Supabase or Neon and replace the Maps
   in `lib/store.js` with queries. The `CHECK (sold_count + held_count <=
   total_allocated)` constraint is the database-level oversell guard.
2. **Redis.** Move the hot counters (stock holds, slot bookings) to Redis with
   `DECRBY`, keeping Postgres as source of truth via async write-back (BullMQ).
3. **Payments.** The seam is already in place (`lib/payments.js`): an invoice
   per order, and `/api/payments/webhook` verifying an HMAC signature before
   anything is marked paid. Going live means replacing `createInvoice` with the
   real Xendit/Midtrans API call, matching their signature scheme, setting
   `PAYMENT_WEBHOOK_SECRET`, and deleting `simulateProviderPayment` along with
   the `/api/orders/:id/pay` route that plays provider in the demo.
4. **WhatsApp.** The queue is already in place (`lib/notifications.js`); wire
   the WhatsApp Business API into `deliverWhatsapp` and move `drainQueue` from
   "runs when staff open the outbox" to a real worker (BullMQ).
5. **Hosting.** Vercel and Cloudflare per PRD section 6. The website can be ISR;
   availability stays dynamic.
6. **Staff auth.** Already in place (PIN, see Security). Set `STAFF_PIN`, and
   consider per-person accounts if the team outgrows one shared tablet.

The counter polls `/api/admin/day` every 15 seconds while the fulfillment tab is
open. That is fine against an in-memory store and wasteful against Postgres.
Move it to SSE or websockets when the real database goes in.

## The wholesale portal (Phase 2)

`/wholesale` is the fourth surface: a planning tool for cafes, restaurants and
hotels. It borrows the app's chrome and the counter's tables, because its user
is somewhere between the two. No photography anywhere in it; a buyer ordering
240 croissants a week has already tasted one.

**Nobody self-serves into trade pricing.** A retail account applies with a
business name and delivery address, staff read the application on the counter's
Wholesale tab, staff decide. Approval flips `type` on the customer, and `type`
is what unlocks the price list, the standing-order routes and the wholesale
pool. `/api/wholesale/me` refuses to attach prices to anyone else, so the
portal has nowhere to show what it never receives.

**The pools stay separate.** `daily_inventory` carries `retailAllocated` and
`wholesaleAllocated` side by side. Retail checkout reads its own pool and never
the other; standing orders are validated against the wholesale pool alone. A
cafe ordering 200 croissants cannot eat the 12 that walk-in scarcity depends
on, and walk-ins cannot eat a contracted standing order. The kitchen bakes the
sum, which the counter shows as the Bake column.

**A standing order is a template, not a pile of rows.** "240 piscok every
Tuesday" is stored once; the commitment on any given date is derived from the
active templates at read time, so it cannot drift when a template is edited or
paused. Saving one validates every delivery in the next four weeks against the
pool and refuses the whole thing if any date breaks, naming the date, the
product and the number free, because "we cannot do that" is useless to someone
planning a cafe.

Wholesale runs on invoices, not QRIS holds. `lib/deliveries.js` derives each
delivery from its template (never materialized, so it cannot drift) and stores
only what cannot be derived: skips and fulfillment stages. A cafe can skip one
occurrence up to two days out — the allocation stays theirs, so un-skipping
can never be refused for capacity that was already promised to them. The
counter's Fulfillment tab carries the day's delivery run (to pack → packed →
delivered), and the portal shows one derived invoice per calendar month,
skipped days never billed. Generating the invoice PDF and recording payment
against credit terms is the remaining production work.

## Subscriptions (Phase 2)

"A box of six every Friday" is the same machine as "200 croissants every
Tuesday": one `standing_orders` store, `channel: "retail"`, retail prices, no
MOQ, paid at pickup. A subscription commits units from the retail pool on
every date it lands, checked all-or-nothing at creation exactly like the
wholesale side, so a walk-in can never buy a subscriber's Friday box and a
subscription can never promise units the case does not have. The
"Repeat weekly" button on a collected order in the account sheet is the whole
sign-up flow, and the counter's Fulfillment tab lists the day's subscription
pickups.

## Bespoke commissions (Phase 2)

`lib/commissions.js` is the two-houses note made real: a commission is a
brief, a quote, a deposit and a date, two weeks out minimum, and it never
touches `daily_inventory`. Capacity is cakes per week, booked at DEPOSIT, not
at enquiry — the patissier can quote ten briefs for one week knowing only
three deposits fit, and the fourth is refused with the week named. Enquiries
arrive from `/bespoke` (guests welcome, like checkout), the pipeline lives on
the counter's Bespoke tab (quote → deposit → production → ready → collected,
decline only before money), and the received/quoted moments are queued to the
outbox.

## Reviews (Phase 2)

A review hangs off an order item, not a product. That one decision is the whole
integrity model: to review a croissant you point at the collected order you
bought it in, that order must be yours (guest orders must be claimed first),
and one line is one voice. Submission lands `pending`; nothing reaches the
product page until staff read it on the counter's Reviews tab and publish it.
The published list renders under the add-to-bag row with first-name authors
and a caramel-star average. In production, `order_item_id UNIQUE` in
`db/schema.sql` enforces one-review-per-line at the database level.

## The outbox (Phase 2)

Outbound WhatsApp is queued in `lib/notifications.js`, never sent inline: the
payment webhook, the "ready" button and the wholesale decision each enqueue a
row and move on, so a WhatsApp outage cannot fail an order that has already
taken money. Delivery fails closed exactly like the OTP sender: until the
WhatsApp Business API is wired into `deliverWhatsapp`, production sends do not
happen and rows wait, visibly, in the counter's Outbox tab, which doubles as
the demo's worker (opening it drains the queue once) and carries a retry
button for failures.

## The payment seam (Phase 2)

`lib/payments.js` is shaped like Xendit/Midtrans without being either yet. An
invoice is minted with the order (idempotently, so a retried create cannot
bill twice), and payment is confirmed ONLY by a callback whose HMAC-SHA256
signature over the raw body verifies, through `/api/payments/webhook`. Even
the demo "tap the QR" button plays provider: it signs the payload and pushes
it through the same door, so the verification path runs on every payment
rather than first running in production. Verification fails closed: in
production a missing `PAYMENT_WEBHOOK_SECRET` rejects every callback. Replays
are acknowledged without double effects, and an amount mismatch leaves the
order unpaid for a human.

## Phase 2, what is left

Done: accounts, the house split, guest order claiming, the wholesale portal
with split pools, standing orders and a self-serve profile edit, per-delivery
skips and the delivery run, derived monthly invoices, retail subscriptions on
the same standing-order machine with qty/weekday edit and a permanent end,
bespoke commissions with weekly capacity and a deposit that runs through the
same signed payment seam as retail, the gift-box picker, retail cancel with
refund, reviews with moderation and a pending/published/rejected history, an
inventory audit log visible on the counter, the notification outbox, the
signed payment webhook, and staff PIN auth on the counter. `test/` has a
`node --test` suite covering the anti-oversell, subscription and payment
logic; run it with `npm test`.

What remains is mostly production infrastructure rather than product:

1. **PostgreSQL and Redis** replacing the in-memory store (see "From demo to
   production" above). Everything here dies with the process.
2. **The WhatsApp Business API** into `deliverWhatsapp` and `deliverOtp`, and
   a real worker for the queue. Both fail closed until then.
3. **Xendit/Midtrans** behind `lib/payments.js`, keeping the webhook door.
4. **Invoice documents and credit terms.** The numbers exist; the PDF and the
   "paid on net-30" bookkeeping do not.
5. **SSE or websockets** for the counter, which still polls every 15 seconds.
