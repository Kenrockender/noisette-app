/**
 * Postgres store adapter (plan.md #5).
 *
 * Mirrors ./memory.js function for function, against db/schema.sql. The
 * dispatcher in ../store.js picks between the two by environment, so every
 * export here matches the name and the return shape of its in-memory twin —
 * the routes and UI cannot tell which backend answered.
 *
 * Three rules this file keeps, so the two backends never disagree:
 *
 *   1. The pure maths is shared, never re-derived. Prices, slot times, the open
 *      date rail and the dates a standing-order template lands on all come from
 *      ./catalog.js, identical to memory. This file only owns durable state.
 *
 *   2. Commitments are derived, not stored. Retail-subscription and wholesale
 *      commitments are computed from the standing_orders templates exactly as
 *      memory computes them (occurrencesOf), rather than trusting a counter
 *      column. daily_inventory.wholesale_committed is left at its default; the
 *      CHECK constraints on the retail pool are the real backstop.
 *
 *   3. Every money- or stock-moving write runs in one transaction with the rows
 *      it touches locked FOR UPDATE, so a five-line order reserves all five or
 *      none even under concurrent checkout. The schema CHECK constraints
 *      (retail_sold + retail_held <= retail_allocated) are the last line of
 *      defence if the application logic is ever wrong.
 *
 * Timestamps cross the boundary as epoch-millisecond numbers, matching memory's
 * Date.now() fields, so downstream formatting is backend-agnostic. DATE columns
 * cross as 'YYYY-MM-DD' strings for the same reason.
 */

import { query, transaction } from "../db/pg.js";
import { normalizeWhatsapp } from "../auth.js";
import {
  HOLD_TTL_MS, GIFT_WRAP_PRICE, products, productById, SLOT_TIMES,
  DEFAULT_RETAIL, DEFAULT_WHOLESALE, DEFAULT_SLOT_CAPACITY,
  ADMIN_HORIZON_DAYS, FULFILLMENT_FLOW, FULFILLMENT_STAGES,
  isoDay, nextOpenDates, adminOpenDates, occurrencesOf,
} from "./catalog.js";

/* ===================== helpers ===================== */

/**
 * Thrown to abort a transaction and roll back its writes while still returning a
 * clean error to the caller. `transaction` only rolls back on a throw, so a
 * partially-applied write (an order that held three of five lines before the
 * fourth failed) must throw, not return, or the good lines would commit.
 */
class AbortTx {
  constructor(result) { this.result = result; }
}

/** "08:00-10:00" -> { start: "08:00", end: "10:00" }. */
const SLOT_BOUNDS = SLOT_TIMES.map((t) => {
  const [start, end] = t.split("-");
  return { start, end };
});
/** starts_at (HH:MM) -> slot index, to rebuild slotIndex from a slot_id row. */
const SLOT_INDEX_BY_START = new Map(SLOT_BOUNDS.map((b, i) => [b.start, i]));

/** Map an "HH:MM:SS" or "HH:MM" TIME back to its slot index. */
function slotIndexFromTime(time) {
  const hhmm = String(time).slice(0, 5);
  return SLOT_INDEX_BY_START.has(hhmm) ? SLOT_INDEX_BY_START.get(hhmm) : null;
}

const toMs = (v) => (v == null ? null : (v instanceof Date ? v.getTime() : new Date(v).getTime()));
const num = (v) => (v == null ? 0 : Number(v));

/** A query runner: the pool for standalone reads, or a locked client in a txn. */
const run = (client) => (client ? (t, p) => client.query(t, p) : (t, p) => query(t, p));

/**
 * Seed a date's inventory and slot rows if they are not there yet. The same
 * lazy fill memory does in ensureDate, so the two agree on defaults. Idempotent
 * via ON CONFLICT.
 */
async function ensureDate(q, date) {
  // One bulk statement per table instead of one row at a time: 17 individual
  // INSERTs (12 products + 5 slots) meant 17 round trips to the pooler, even
  // running "in parallel", they still queue behind the pool's connection cap.
  // unnest() turns each table's seed into a single round trip.
  await Promise.all([
    q(
      `INSERT INTO daily_inventory (product_id, available_date, retail_allocated, wholesale_allocated)
       SELECT * FROM unnest($1::text[], $2::date[], $3::int[], $4::int[])
       ON CONFLICT (product_id, available_date) DO NOTHING`,
      [
        products.map((p) => p.id),
        products.map(() => date),
        products.map((p) => DEFAULT_RETAIL[p.id] ?? 0),
        products.map((p) => DEFAULT_WHOLESALE[p.id] ?? 0),
      ]
    ),
    q(
      `INSERT INTO fulfillment_slots (slot_date, starts_at, ends_at, max_capacity)
       SELECT * FROM unnest($1::date[], $2::time[], $3::time[], $4::int[])
       ON CONFLICT (slot_date, starts_at) DO NOTHING`,
      [
        SLOT_BOUNDS.map(() => date),
        SLOT_BOUNDS.map((b) => b.start),
        SLOT_BOUNDS.map((b) => b.end),
        SLOT_BOUNDS.map(() => DEFAULT_SLOT_CAPACITY),
      ]
    ),
  ]);
}

/**
 * Load every standing-order template with its items, shaped for occurrencesOf.
 * Prices are derived from the catalog by channel, exactly like memory builds
 * them at save time — standing_order_items stores only the quantity.
 */
async function loadStandingOrders(q) {
  const { rows } = await q(
    `SELECT s.id, s.customer_id, s.channel, s.weekday,
            to_char(s.starts_on, 'YYYY-MM-DD')   AS starts_on,
            to_char(s.ends_on, 'YYYY-MM-DD')     AS ends_on,
            to_char(s.paused_until, 'YYYY-MM-DD') AS paused_until,
            s.active,
            (EXTRACT(EPOCH FROM s.created_at) * 1000)::bigint AS created_ms
       FROM standing_orders s`
  );
  const { rows: itemRows } = await q(
    `SELECT standing_order_id, product_id, qty FROM standing_order_items`
  );
  const itemsBy = new Map();
  for (const it of itemRows) {
    const list = itemsBy.get(String(it.standing_order_id)) || [];
    list.push(it);
    itemsBy.set(String(it.standing_order_id), list);
  }
  return rows.map((r) => {
    const channel = r.channel;
    const items = (itemsBy.get(String(r.id)) || []).map((it) => {
      const p = productById.get(it.product_id);
      return {
        productId: it.product_id,
        name: p?.name ?? it.product_id,
        qty: Number(it.qty),
        unitPrice: channel === "wholesale" ? (p?.wholesalePrice ?? 0) : (p?.price ?? 0),
      };
    });
    return {
      id: String(r.id),
      customerId: String(r.customer_id),
      channel,
      weekday: Number(r.weekday),
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      pausedUntil: r.paused_until,
      active: r.active,
      createdAt: Number(r.created_ms),
      items,
    };
  });
}

/** committedOn, over pre-loaded templates. Same body as memory's private one. */
function committedOn(sos, date, productId, channel, exceptId) {
  let n = 0;
  for (const so of sos) {
    if (!so.active || so.id === exceptId) continue;
    if ((so.channel ?? "wholesale") !== channel) continue;
    if (!occurrencesOf(so).includes(date)) continue;
    for (const it of so.items) if (it.productId === productId) n += it.qty;
  }
  return n;
}

async function logInventory(q, { date, productId, delta, reason, orderId = null, actor = "system", pool = "retail" }) {
  await q(
    `INSERT INTO inventory_transactions (product_id, order_id, date, delta, reason, pool, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [productId, orderId, date, delta, reason, pool, actor]
  );
}

/* ===================== inventory audit ===================== */

export async function listInventoryLog(date, limit = 200) {
  const { rows } = await query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, product_id, pool, delta, reason,
            order_id, actor, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS at_ms
       FROM inventory_transactions
      ${date ? "WHERE date = $1" : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT ${date ? "$2" : "$1"}`,
    date ? [date, limit] : [limit]
  );
  return rows.map((r) => ({
    id: "IX-" + String(r.id).padStart(5, "0"),
    date: r.date,
    productId: r.product_id,
    pool: r.pool,
    delta: Number(r.delta),
    reason: r.reason,
    orderId: r.order_id,
    actor: r.actor,
    at: Number(r.at_ms),
  }));
}

/**
 * Expire every hold whose payment window has passed: release its held units and
 * its slot, and log the release. One transaction, rows locked, so it is safe to
 * run at the head of every read the way memory does.
 */
export async function expireHolds() {
  await transaction(async (client) => {
    const q = (t, p) => client.query(t, p);
    const { rows: due } = await q(
      `SELECT id, to_char(pickup_date, 'YYYY-MM-DD') AS pickup_date, slot_id
         FROM orders
        WHERE status = 'awaiting_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at < now()
        FOR UPDATE`
    );
    for (const o of due) {
      const { rows: items } = await q(
        `SELECT product_id, qty FROM order_items WHERE order_id = $1`, [o.id]
      );
      for (const it of items) {
        await q(
          `UPDATE daily_inventory
              SET retail_held = GREATEST(0, retail_held - $1)
            WHERE product_id = $2 AND available_date = $3`,
          [it.qty, it.product_id, o.pickup_date]
        );
        await logInventory(q, { date: o.pickup_date, productId: it.product_id, delta: it.qty, reason: "hold_release", orderId: o.id });
      }
      if (o.slot_id != null) {
        await q(`UPDATE fulfillment_slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = $1`, [o.slot_id]);
      }
      await q(`UPDATE orders SET status = 'expired' WHERE id = $1`, [o.id]);
    }
  });
}

/* ===================== availability ===================== */

export function getProducts() {
  return products;
}

async function retailFreeMap(q, date, sos) {
  const { rows } = await q(
    `SELECT product_id, retail_allocated, retail_sold, retail_held
       FROM daily_inventory WHERE available_date = $1`, [date]
  );
  const inv = new Map(rows.map((r) => [r.product_id, r]));
  const free = {};
  for (const p of products) {
    const r = inv.get(p.id);
    if (!r) { free[p.id] = 0; continue; }
    const sub = committedOn(sos, date, p.id, "retail", null);
    free[p.id] = Math.max(0, num(r.retail_allocated) - num(r.retail_sold) - num(r.retail_held) - sub);
  }
  return free;
}

export async function getAvailability(date) {
  await expireHolds();
  const dates = nextOpenDates();
  if (!date) date = dates[0];
  if (!dates.includes(date)) return { error: "date_not_open", dates };
  await ensureDate((t, p) => query(t, p), date);

  const sos = await loadStandingOrders((t, p) => query(t, p));
  const stock = await retailFreeMap((t, p) => query(t, p), date, sos);

  const { rows: slotRows } = await query(
    `SELECT to_char(starts_at, 'HH24:MI') AS starts_at, max_capacity, booked_count
       FROM fulfillment_slots WHERE slot_date = $1`, [date]
  );
  const byStart = new Map(slotRows.map((s) => [s.starts_at, s]));
  const slots = SLOT_TIMES.map((time, i) => {
    const s = byStart.get(SLOT_BOUNDS[i].start);
    const remaining = s ? Math.max(0, num(s.max_capacity) - num(s.booked_count)) : DEFAULT_SLOT_CAPACITY;
    return { index: i, time, remaining };
  });

  return { date, dates, stock, slots, giftWrapPrice: GIFT_WRAP_PRICE };
}

/* ===================== orders ===================== */

/** Assemble the memory-shaped order object from its rows. */
async function hydrateOrder(q, id) {
  const { rows } = await q(
    `SELECT o.id, o.status, o.customer_id, o.whatsapp, o.contact_name, o.gift_wrap, o.is_walkin,
            o.total_idr, o.payment_method, o.payment_ref,
            to_char(o.pickup_date, 'YYYY-MM-DD') AS pickup_date, o.slot_id,
            to_char(s.starts_at, 'HH24:MI') AS slot_start,
            (EXTRACT(EPOCH FROM o.created_at) * 1000)::bigint AS created_ms,
            (EXTRACT(EPOCH FROM o.hold_expires_at) * 1000)::bigint AS hold_ms,
            (EXTRACT(EPOCH FROM o.paid_at) * 1000)::bigint AS paid_ms
       FROM orders o LEFT JOIN fulfillment_slots s ON s.id = o.slot_id
      WHERE o.id = $1`, [id]
  );
  if (!rows.length) return null;
  const o = rows[0];
  const { rows: items } = await q(
    `SELECT product_id, qty, unit_price FROM order_items WHERE order_id = $1 ORDER BY id`, [id]
  );
  const { rows: gifts } = await q(
    `SELECT g.product_id, g.qty
       FROM order_gift_contents g JOIN order_items i ON i.id = g.order_item_id
      WHERE i.order_id = $1 ORDER BY g.id`, [id]
  );
  const slotIndex = o.slot_start != null ? slotIndexFromTime(o.slot_start) : null;
  return {
    id: o.id,
    status: o.status,
    items: items.map((it) => ({
      productId: it.product_id,
      name: productById.get(it.product_id)?.name ?? it.product_id,
      qty: Number(it.qty),
      unitPrice: Number(it.unit_price),
    })),
    giftWrap: o.gift_wrap,
    giftContents: gifts.length
      ? gifts.map((g) => ({ productId: g.product_id, name: productById.get(g.product_id)?.name ?? g.product_id, qty: Number(g.qty) }))
      : null,
    total: Number(o.total_idr),
    pickupDate: o.pickup_date,
    slotIndex,
    slotTime: slotIndex != null ? SLOT_TIMES[slotIndex] : null,
    isWalkin: o.is_walkin,
    customer: { name: o.contact_name, whatsapp: o.whatsapp },
    customerId: o.customer_id != null ? String(o.customer_id) : null,
    whatsappKey: o.whatsapp,
    paymentMethod: o.payment_method || "QRIS",
    paymentRef: o.payment_ref || undefined,
    createdAt: Number(o.created_ms),
    holdExpiresAt: o.hold_ms != null ? Number(o.hold_ms) : null,
    paidAt: o.paid_ms != null ? Number(o.paid_ms) : undefined,
  };
}

export async function createOrder({ items, pickupDate, slotIndex, name, whatsapp, paymentMethod, giftWrap, giftContents, customerId }) {
  await expireHolds();
  if (!Array.isArray(items) || items.length === 0) return { error: "empty_bag" };
  if (!name?.trim() || !whatsapp?.trim()) return { error: "missing_contact" };
  const dates = nextOpenDates();
  if (!dates.includes(pickupDate)) return { error: "date_not_open" };

  // Gift-box validation is pure and identical to memory; do it before the txn.
  const boxQty = items
    .filter((it) => it.productId === "giftbox6")
    .reduce((a, it) => a + Math.floor(Number(it.qty) || 0), 0);
  let giftPicks = null;
  if (boxQty > 0 && Array.isArray(giftContents) && giftContents.length) {
    const need = 6 * boxQty;
    const picks = [];
    let count = 0;
    for (const gc of giftContents) {
      const cand = productById.get(gc.productId);
      const gp = cand?.house === "patisserie" ? cand : null;
      const qn = Math.floor(Number(gc.qty));
      if (!gp) return { error: "invalid_gift_pick", productId: gc.productId };
      if (!Number.isFinite(qn) || qn <= 0) return { error: "invalid_gift_pick", productId: gc.productId };
      picks.push({ productId: gp.id, name: gp.name, qty: qn });
      count += qn;
    }
    if (count !== need) return { error: "gift_box_incomplete", need, got: count };
    giftPicks = picks;
  }

  try {
    return await transaction(async (client) => {
      const q = (t, p) => client.query(t, p);
      await ensureDate(q, pickupDate);

      const slotStart = SLOT_BOUNDS[slotIndex]?.start;
      if (slotStart == null) throw new AbortTx({ error: "invalid_slot" });
      const { rows: slotRows } = await q(
        `SELECT id, max_capacity, booked_count FROM fulfillment_slots
          WHERE slot_date = $1 AND starts_at = $2 FOR UPDATE`,
        [pickupDate, slotStart]
      );
      if (!slotRows.length) throw new AbortTx({ error: "invalid_slot" });
      const slot = slotRows[0];
      if (num(slot.booked_count) >= num(slot.max_capacity)) throw new AbortTx({ error: "slot_full" });

      const sos = await loadStandingOrders(q);

      // Reserve each line, locking its inventory row. A bad line aborts the whole
      // transaction (throws), so the good lines are never left half-held.
      const orderItems = [];
      for (const it of items) {
        const p = productById.get(it.productId);
        const qty = Math.floor(Number(it.qty));
        if (!p || !Number.isFinite(qty) || qty <= 0) throw new AbortTx({ error: "invalid_item", productId: it.productId });
        const { rows: invRows } = await q(
          `SELECT retail_allocated, retail_sold, retail_held FROM daily_inventory
            WHERE product_id = $1 AND available_date = $2 FOR UPDATE`,
          [it.productId, pickupDate]
        );
        if (!invRows.length) throw new AbortTx({ error: "invalid_item", productId: it.productId });
        const inv = invRows[0];
        const sub = committedOn(sos, pickupDate, it.productId, "retail", null);
        const available = Math.max(0, num(inv.retail_allocated) - num(inv.retail_sold) - num(inv.retail_held) - sub);
        if (qty > available) throw new AbortTx({ error: "insufficient_stock", productId: it.productId, available });
        await q(
          `UPDATE daily_inventory SET retail_held = retail_held + $1
            WHERE product_id = $2 AND available_date = $3`,
          [qty, it.productId, pickupDate]
        );
        orderItems.push({ productId: p.id, name: p.name, qty, unitPrice: p.price });
      }

      await q(`UPDATE fulfillment_slots SET booked_count = booked_count + 1 WHERE id = $1`, [slot.id]);

      let total = orderItems.reduce((a, it) => a + it.unitPrice * it.qty, 0);
      if (giftWrap) total += GIFT_WRAP_PRICE;

      const { rows: idRows } = await q(
        `SELECT 'N-' || lpad(nextval('order_number_seq')::text, 4, '0') AS id`
      );
      const id = idRows[0].id;
      const wa = whatsapp.trim();
      const waKey = normalizeWhatsapp(whatsapp);

      await q(
        `INSERT INTO orders (id, customer_id, whatsapp, contact_name, channel, status,
                             pickup_date, slot_id, gift_wrap, total_idr, payment_method, hold_expires_at)
         VALUES ($1, $2, $3, $4, 'retail', 'awaiting_payment', $5, $6, $7, $8, $9, $10)`,
        [id, customerId || null, waKey, name.trim(), pickupDate, slot.id, !!giftWrap, total,
         paymentMethod || "QRIS", new Date(Date.now() + HOLD_TTL_MS)]
      );

      for (const it of orderItems) {
        const { rows: oiRows } = await q(
          `INSERT INTO order_items (order_id, product_id, qty, unit_price)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [id, it.productId, it.qty, it.unitPrice]
        );
        await logInventory(q, { date: pickupDate, productId: it.productId, delta: -it.qty, reason: "hold", orderId: id });
        if (giftPicks && it.productId === "giftbox6") {
          for (const gp of giftPicks) {
            await q(
              `INSERT INTO order_gift_contents (order_item_id, product_id, qty) VALUES ($1, $2, $3)`,
              [oiRows[0].id, gp.productId, gp.qty]
            );
          }
        }
      }

      if (customerId) await touchCustomer(q, customerId, { name: name.trim() });

      return { order: await hydrateOrder(q, id) };
    });
  } catch (err) {
    if (err instanceof AbortTx) return err.result;
    // A CHECK-constraint violation means a concurrent writer beat us to the
    // stock; surface it as the same insufficient_stock the pre-check returns.
    if (err?.code === "23514") return { error: "insufficient_stock" };
    throw err;
  }
}

/**
 * A sale rung up at the counter: paid and handed over in the same motion, so
 * unlike createOrder it skips the slot, the hold, and awaiting_payment
 * entirely and lands straight on 'collected'. Still draws from the same
 * retail pool as pre-orders, so it still needs to check and move stock.
 */
export async function createWalkinSale({ items, pickupDate, name, actor = "staff" }) {
  if (!Array.isArray(items) || items.length === 0) return { error: "empty_bag" };

  try {
    return await transaction(async (client) => {
      const q = (t, p) => client.query(t, p);
      await ensureDate(q, pickupDate);
      const sos = await loadStandingOrders(q);

      const orderItems = [];
      for (const it of items) {
        const p = productById.get(it.productId);
        const qty = Math.floor(Number(it.qty));
        if (!p || !Number.isFinite(qty) || qty <= 0) throw new AbortTx({ error: "invalid_item", productId: it.productId });
        const { rows: invRows } = await q(
          `SELECT retail_allocated, retail_sold, retail_held FROM daily_inventory
            WHERE product_id = $1 AND available_date = $2 FOR UPDATE`,
          [it.productId, pickupDate]
        );
        if (!invRows.length) throw new AbortTx({ error: "invalid_item", productId: it.productId });
        const inv = invRows[0];
        const sub = committedOn(sos, pickupDate, it.productId, "retail", null);
        const available = Math.max(0, num(inv.retail_allocated) - num(inv.retail_sold) - num(inv.retail_held) - sub);
        if (qty > available) throw new AbortTx({ error: "insufficient_stock", productId: it.productId, available });
        await q(
          `UPDATE daily_inventory SET retail_sold = retail_sold + $1
            WHERE product_id = $2 AND available_date = $3`,
          [qty, it.productId, pickupDate]
        );
        orderItems.push({ productId: p.id, name: p.name, qty, unitPrice: p.price });
      }

      const total = orderItems.reduce((a, it) => a + it.unitPrice * it.qty, 0);

      const { rows: idRows } = await q(`SELECT 'N-' || lpad(nextval('order_number_seq')::text, 4, '0') AS id`);
      const id = idRows[0].id;

      await q(
        `INSERT INTO orders (id, whatsapp, contact_name, channel, status,
                             pickup_date, slot_id, total_idr, payment_method, is_walkin, paid_at)
         VALUES ($1, '', $2, 'retail', 'collected', $3, NULL, $4, 'Tunai', TRUE, now())`,
        [id, (name || "").trim() || "Pelanggan toko", pickupDate, total]
      );

      for (const it of orderItems) {
        await q(
          `INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ($1, $2, $3, $4)`,
          [id, it.productId, it.qty, it.unitPrice]
        );
        await logInventory(q, { date: pickupDate, productId: it.productId, delta: -it.qty, reason: "walkin_sale", orderId: id, actor });
      }

      return { order: await hydrateOrder(q, id) };
    });
  } catch (err) {
    if (err instanceof AbortTx) return err.result;
    if (err?.code === "23514") return { error: "insufficient_stock" };
    throw err;
  }
}

/**
 * `existingClient` lets a caller that already holds an open transaction (e.g.
 * lib/payments/pg.js's handlePaymentCallback) run this as part of that SAME
 * transaction, instead of markPaid opening its own on a second pooled
 * connection. Two independent transactions cannot be atomic with each other —
 * if the caller's later write failed, this one would already have committed
 * on its own connection, leaving the sale recorded but its invoice unpaid.
 * Standalone callers (nothing passed) keep the old behaviour unchanged.
 */
export async function markPaid(orderId, existingClient) {
  await expireHolds();
  const run = async (client) => {
    const q = (t, p) => client.query(t, p);
    const { rows } = await q(
      `SELECT id, status, to_char(pickup_date, 'YYYY-MM-DD') AS pickup_date
         FROM orders WHERE id = $1 FOR UPDATE`, [orderId]
    );
    if (!rows.length) return { error: "not_found" };
    const o = rows[0];
    if (o.status === "paid") return { order: await hydrateOrder(q, orderId) };
    if (o.status !== "awaiting_payment") return { error: "hold_expired" };

    const { rows: items } = await q(`SELECT product_id, qty FROM order_items WHERE order_id = $1`, [orderId]);
    for (const it of items) {
      await q(
        `UPDATE daily_inventory
            SET retail_held = GREATEST(0, retail_held - $1), retail_sold = retail_sold + $1
          WHERE product_id = $2 AND available_date = $3`,
        [it.qty, it.product_id, o.pickup_date]
      );
      await logInventory(q, { date: o.pickup_date, productId: it.product_id, delta: -it.qty, reason: "sale", orderId });
    }
    await q(`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1`, [orderId]);
    return { order: await hydrateOrder(q, orderId) };
  };
  return existingClient ? run(existingClient) : transaction(run);
}

export async function getOrder(orderId) {
  await expireHolds();
  return hydrateOrder((t, p) => query(t, p), orderId);
}

/**
 * `client` in the options bag lets a caller already inside its own
 * transaction (e.g. lib/payments/pg.js's cancelAndRefundOrder) run this on
 * that SAME connection instead of cancelOrder opening a second one — same
 * reasoning as markPaid's `existingClient`. Without it, the stock/slot
 * release here could commit on its own even if the refund step right after
 * it failed, leaving an order cancelled with an invoice still marked paid.
 */
export async function cancelOrder(orderId, { actor = "customer", client: existingClient } = {}) {
  await expireHolds();
  const run = async (client) => {
    const q = (t, p) => client.query(t, p);
    const { rows } = await q(
      `SELECT id, status, slot_id, is_walkin, to_char(pickup_date, 'YYYY-MM-DD') AS pickup_date
         FROM orders WHERE id = $1 FOR UPDATE`, [orderId]
    );
    if (!rows.length) return { error: "not_found" };
    const o = rows[0];
    if (o.status === "cancelled") return { order: await hydrateOrder(q, orderId) };
    // Mirrors lib/store/memory.js: a walk-in is created already "collected", so
    // it needs its own way back to cancelled that paid/preparing/ready orders
    // reach through the normal fulfillment stages.
    const cancellable = ["paid", "preparing", "ready"].includes(o.status) || (o.is_walkin && o.status === "collected");
    if (!cancellable) return { error: "not_cancellable", status: o.status };
    if (o.pickup_date < isoDay(new Date())) return { error: "too_late" };

    const { rows: items } = await q(`SELECT product_id, qty FROM order_items WHERE order_id = $1`, [orderId]);
    for (const it of items) {
      await q(
        `UPDATE daily_inventory SET retail_sold = GREATEST(0, retail_sold - $1)
          WHERE product_id = $2 AND available_date = $3`,
        [it.qty, it.product_id, o.pickup_date]
      );
      await logInventory(q, { date: o.pickup_date, productId: it.product_id, delta: it.qty, reason: "cancel_release", orderId, actor });
    }
    if (o.slot_id != null) {
      await q(`UPDATE fulfillment_slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = $1`, [o.slot_id]);
    }
    await q(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [orderId]);
    return { order: await hydrateOrder(q, orderId) };
  };
  return existingClient ? run(existingClient) : transaction(run);
}

/* ===================== customers ===================== */

function customerShape(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    whatsapp: r.whatsapp,
    name: r.name || "",
    type: r.type,
    businessName: r.business_name || undefined,
    address: r.billing_address || undefined,
    npwp: r.npwp || undefined,
    createdAt: r.created_ms != null ? Number(r.created_ms) : undefined,
  };
}

const CUSTOMER_COLS = `id, whatsapp, name, type, business_name, billing_address, npwp,
  (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms`;

async function touchCustomer(q, id, patch) {
  if (patch?.name) {
    await q(`UPDATE customers SET name = $1 WHERE id = $2 AND (name = '' OR name IS NULL)`, [patch.name, id]);
  }
}

export async function upsertCustomer(whatsappKey, { name } = {}) {
  const { rows } = await query(
    `INSERT INTO customers (whatsapp, name) VALUES ($1, $2)
     ON CONFLICT (whatsapp) DO UPDATE
       SET name = CASE WHEN customers.name = '' OR customers.name IS NULL
                       THEN COALESCE(EXCLUDED.name, customers.name) ELSE customers.name END
     RETURNING ${CUSTOMER_COLS}`,
    [whatsappKey, name || ""]
  );
  return customerShape(rows[0]);
}

export async function getCustomer(id) {
  const { rows } = await query(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = $1`, [id]);
  return customerShape(rows[0]);
}

export async function claimGuestOrders(customerId) {
  return transaction(async (client) => {
    const q = (t, p) => client.query(t, p);
    const { rows: cRows } = await q(`SELECT id, whatsapp, name FROM customers WHERE id = $1`, [customerId]);
    if (!cRows.length) return { claimed: 0 };
    const c = cRows[0];
    const { rows: claimRows } = await q(
      `UPDATE orders SET customer_id = $1
        WHERE customer_id IS NULL AND whatsapp = $2
        RETURNING contact_name`,
      [customerId, c.whatsapp]
    );
    if ((!c.name || c.name === "") && claimRows.length && claimRows[0].contact_name) {
      await q(`UPDATE customers SET name = $1 WHERE id = $2 AND (name = '' OR name IS NULL)`, [claimRows[0].contact_name, customerId]);
    }
    return { claimed: claimRows.length };
  });
}

export async function getCustomerOrders(customerId) {
  await expireHolds();
  const { rows } = await query(
    `SELECT id FROM orders
      WHERE customer_id = $1 AND status NOT IN ('expired', 'awaiting_payment')
      ORDER BY created_at DESC`, [customerId]
  );
  const q = (t, p) => query(t, p);
  return Promise.all(rows.map((r) => hydrateOrder(q, r.id)));
}

/* ===================== commitments (derived) ===================== */

export async function wholesaleCommitted(date, productId, exceptId = null) {
  const sos = await loadStandingOrders((t, p) => query(t, p));
  return committedOn(sos, date, productId, "wholesale", exceptId);
}

export async function subscriptionCommitted(date, productId, exceptId = null) {
  const sos = await loadStandingOrders((t, p) => query(t, p));
  return committedOn(sos, date, productId, "retail", exceptId);
}

export async function wholesaleFree(date, productId) {
  await ensureDate((t, p) => query(t, p), date);
  const { rows } = await query(
    `SELECT wholesale_allocated FROM daily_inventory WHERE product_id = $1 AND available_date = $2`,
    [productId, date]
  );
  if (!rows.length) return 0;
  const committed = await wholesaleCommitted(date, productId);
  return Math.max(0, num(rows[0].wholesale_allocated) - committed);
}

/* ===================== standing orders ===================== */

export async function saveStandingOrder({ id, customerId, weekday, items, startsOn, endsOn, channel = "wholesale" }) {
  const { rows: cRows } = await query(`SELECT id, type FROM customers WHERE id = $1`, [customerId]);
  if (!cRows.length) return { error: "not_found" };
  const c = cRows[0];
  if (!["wholesale", "retail"].includes(channel)) return { error: "invalid_channel" };
  if (channel === "wholesale" && c.type !== "wholesale") return { error: "not_wholesale" };
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: "invalid_weekday" };
  if (!Array.isArray(items) || items.length === 0) return { error: "empty_order" };

  const clean = [];
  for (const it of items) {
    const p = productById.get(it.productId);
    const qty = Math.floor(Number(it.qty));
    if (!p) return { error: "invalid_item", productId: it.productId };
    if (!Number.isFinite(qty) || qty <= 0) return { error: "invalid_qty", productId: p.id };
    if (channel === "wholesale") {
      if (!p.wholesalePrice) return { error: "not_sold_wholesale", productId: p.id, name: p.name };
      if (qty < p.wholesaleMoq) return { error: "below_moq", productId: p.id, name: p.name, moq: p.wholesaleMoq };
      clean.push({ productId: p.id, name: p.name, qty, unitPrice: p.wholesalePrice });
    } else {
      clean.push({ productId: p.id, name: p.name, qty, unitPrice: p.price });
    }
  }

  const draft = {
    id: id ? String(id) : null, customerId: String(customerId), channel, weekday, items: clean,
    startsOn: startsOn || nextOpenDates(1)[0], endsOn: endsOn || null,
    pausedUntil: null, active: true,
  };

  return transaction(async (client) => {
    const q = (t, p) => client.query(t, p);

    // Ownership: replacing an id you do not own is indistinguishable from
    // replacing one that does not exist. Same shape as deleteStandingOrder.
    if (draft.id) {
      const { rows: exRows } = await q(`SELECT customer_id FROM standing_orders WHERE id = $1 FOR UPDATE`, [draft.id]);
      if (!exRows.length || String(exRows[0].customer_id) !== String(customerId)) return { error: "not_found" };
    }

    const sos = await loadStandingOrders(q);
    for (const date of occurrencesOf(draft)) {
      await ensureDate(q, date);
      const { rows: invRows } = await q(
        `SELECT product_id, retail_allocated, retail_sold, retail_held, wholesale_allocated
           FROM daily_inventory WHERE product_id = ANY($1) AND available_date = $2`,
        [clean.map((it) => it.productId), date]
      );
      const invBy = new Map(invRows.map((r) => [r.product_id, r]));
      for (const it of clean) {
        const inv = invBy.get(it.productId) || {};
        if (channel === "wholesale") {
          const already = committedOn(sos, date, it.productId, "wholesale", draft.id);
          if (already + it.qty > num(inv.wholesale_allocated)) {
            return { error: "wholesale_capacity", date, productId: it.productId, name: it.name, requested: it.qty, free: Math.max(0, num(inv.wholesale_allocated) - already) };
          }
        } else {
          const already = committedOn(sos, date, it.productId, "retail", draft.id);
          const free = num(inv.retail_allocated) - num(inv.retail_sold) - num(inv.retail_held) - already;
          if (it.qty > free) {
            return { error: "retail_capacity", date, productId: it.productId, name: it.name, requested: it.qty, free: Math.max(0, free) };
          }
        }
      }
    }

    let soId = draft.id;
    if (soId) {
      await q(
        `UPDATE standing_orders SET channel = $2, weekday = $3, starts_on = $4, ends_on = $5, active = TRUE
          WHERE id = $1`,
        [soId, channel, weekday, draft.startsOn, draft.endsOn]
      );
      await q(`DELETE FROM standing_order_items WHERE standing_order_id = $1`, [soId]);
    } else {
      const { rows: insRows } = await q(
        `INSERT INTO standing_orders (customer_id, channel, weekday, starts_on, ends_on, active)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
        [customerId, channel, weekday, draft.startsOn, draft.endsOn]
      );
      soId = String(insRows[0].id);
    }
    for (const it of clean) {
      await q(`INSERT INTO standing_order_items (standing_order_id, product_id, qty) VALUES ($1, $2, $3)`, [soId, it.productId, it.qty]);
    }
    return { standingOrder: await hydrateStandingOrder(q, soId) };
  });
}

async function hydrateStandingOrder(q, id) {
  const { rows } = await q(
    `SELECT id, customer_id, channel, weekday,
            to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
            to_char(paused_until, 'YYYY-MM-DD') AS paused_until,
            active, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms
       FROM standing_orders WHERE id = $1`, [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const { rows: itemRows } = await q(`SELECT product_id, qty FROM standing_order_items WHERE standing_order_id = $1 ORDER BY id`, [id]);
  const items = itemRows.map((it) => {
    const p = productById.get(it.product_id);
    return {
      productId: it.product_id,
      name: p?.name ?? it.product_id,
      qty: Number(it.qty),
      unitPrice: r.channel === "wholesale" ? (p?.wholesalePrice ?? 0) : (p?.price ?? 0),
    };
  });
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    channel: r.channel,
    weekday: Number(r.weekday),
    items,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    pausedUntil: r.paused_until,
    active: r.active,
    createdAt: Number(r.created_ms),
  };
}

export async function listStandingOrders(customerId, channel) {
  const sos = await loadStandingOrders((t, p) => query(t, p));
  return sos
    .filter((s) => (customerId ? s.customerId === String(customerId) : true))
    .filter((s) => (channel ? (s.channel ?? "wholesale") === channel : true))
    .sort((a, b) => a.weekday - b.weekday || a.createdAt - b.createdAt);
}

export async function setStandingOrderActive(id, active) {
  const { rows } = await query(`UPDATE standing_orders SET active = $2 WHERE id = $1 RETURNING id`, [id, !!active]);
  if (!rows.length) return { error: "not_found" };
  return { standingOrder: await hydrateStandingOrder((t, p) => query(t, p), id) };
}

export async function deleteStandingOrder(id, customerId) {
  const { rows } = await query(`SELECT customer_id FROM standing_orders WHERE id = $1`, [id]);
  if (!rows.length) return { error: "not_found" };
  if (customerId && String(rows[0].customer_id) !== String(customerId)) return { error: "not_found" };
  await query(`DELETE FROM standing_orders WHERE id = $1`, [id]);
  return { ok: true };
}

async function scheduleFor(customerId, channel, weeks) {
  const sos = (await listStandingOrders(customerId, channel)).filter((s) => s.active);
  const out = [];
  for (const so of sos) {
    for (const date of occurrencesOf(so, weeks * 7)) {
      out.push({
        date, standingOrderId: so.id, customerId: so.customerId, items: so.items,
        total: so.items.reduce((a, it) => a + it.unitPrice * it.qty, 0),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function wholesaleSchedule(customerId, weeks = 4) {
  return scheduleFor(customerId, "wholesale", weeks);
}

export async function subscriptionSchedule(customerId, weeks = 4) {
  return scheduleFor(customerId, "retail", weeks);
}

export async function subscriptionsOn(date) {
  const rows = (await scheduleFor(undefined, "retail", 5)).filter((s) => s.date === date);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((s) => s.customerId))];
  const { rows: cRows } = await query(`SELECT id, name FROM customers WHERE id = ANY($1)`, [ids]);
  const nameBy = new Map(cRows.map((c) => [String(c.id), c.name]));
  return rows.map((s) => ({ ...s, name: nameBy.get(s.customerId) || "Subscriber" }));
}

/* ===================== wholesale applications ===================== */

export async function applyForWholesale(customerId, { businessName, address, npwp }) {
  const { rows: cRows } = await query(`SELECT id, type FROM customers WHERE id = $1`, [customerId]);
  if (!cRows.length) return { error: "not_found" };
  if (cRows[0].type === "wholesale") return { error: "already_wholesale" };
  if (!businessName?.trim() || !address?.trim()) return { error: "missing_fields" };

  const { rows: exRows } = await query(`SELECT status FROM wholesale_applications WHERE customer_id = $1`, [customerId]);
  if (exRows.length && exRows[0].status === "pending") return { error: "already_pending" };

  const { rows } = await query(
    `INSERT INTO wholesale_applications (customer_id, business_name, address, npwp, status, submitted_at)
     VALUES ($1, $2, $3, $4, 'pending', now())
     ON CONFLICT (customer_id) DO UPDATE
       SET business_name = EXCLUDED.business_name, address = EXCLUDED.address, npwp = EXCLUDED.npwp,
           status = 'pending', submitted_at = now(), decided_at = NULL
     RETURNING business_name, address, npwp, status,
               (EXTRACT(EPOCH FROM submitted_at) * 1000)::bigint AS submitted_ms`,
    [customerId, businessName.trim(), address.trim(), npwp?.trim() || ""]
  );
  const a = rows[0];
  return { application: { businessName: a.business_name, address: a.address, npwp: a.npwp || "", status: a.status, submittedAt: Number(a.submitted_ms) } };
}

export async function listWholesaleApplications(status = "pending") {
  const { rows } = await query(
    `SELECT a.customer_id, c.name, c.whatsapp, a.business_name, a.address, a.npwp, a.status,
            (EXTRACT(EPOCH FROM a.submitted_at) * 1000)::bigint AS submitted_ms
       FROM wholesale_applications a JOIN customers c ON c.id = a.customer_id
      WHERE a.status = $1
      ORDER BY a.submitted_at ASC`, [status]
  );
  return rows.map((r) => ({
    customerId: String(r.customer_id), name: r.name, whatsapp: r.whatsapp,
    businessName: r.business_name, address: r.address, npwp: r.npwp || "",
    status: r.status, submittedAt: Number(r.submitted_ms),
  }));
}

export async function decideWholesaleApplication(customerId, approve) {
  return transaction(async (client) => {
    const q = (t, p) => client.query(t, p);
    const { rows } = await q(
      `SELECT business_name, address, npwp, status FROM wholesale_applications WHERE customer_id = $1 FOR UPDATE`,
      [customerId]
    );
    if (!rows.length) return { error: "not_found" };
    if (rows[0].status !== "pending") return { error: "already_decided" };
    const app = rows[0];
    await q(
      `UPDATE wholesale_applications SET status = $2, decided_at = now() WHERE customer_id = $1`,
      [customerId, approve ? "approved" : "rejected"]
    );
    if (approve) {
      await q(
        `UPDATE customers SET type = 'wholesale', business_name = $2, billing_address = $3, npwp = $4 WHERE id = $1`,
        [customerId, app.business_name, app.address, app.npwp || ""]
      );
    }
    const { rows: cRows } = await q(`SELECT ${CUSTOMER_COLS} FROM customers WHERE id = $1`, [customerId]);
    return { customer: customerShape(cRows[0]) };
  });
}

export async function updateWholesaleProfile(customerId, { businessName, address, npwp } = {}) {
  const { rows: cRows } = await query(`SELECT type FROM customers WHERE id = $1`, [customerId]);
  if (!cRows.length) return { error: "not_found" };
  if (cRows[0].type !== "wholesale") return { error: "not_wholesale" };

  const sets = [];
  const vals = [customerId];
  if (businessName !== undefined) {
    if (!String(businessName).trim()) return { error: "missing_fields" };
    vals.push(String(businessName).trim()); sets.push(`business_name = $${vals.length}`);
  }
  if (address !== undefined) {
    if (!String(address).trim()) return { error: "missing_fields" };
    vals.push(String(address).trim()); sets.push(`billing_address = $${vals.length}`);
  }
  if (npwp !== undefined) {
    vals.push(String(npwp || "").trim()); sets.push(`npwp = $${vals.length}`);
  }
  if (sets.length) await query(`UPDATE customers SET ${sets.join(", ")} WHERE id = $1`, vals);

  const { rows } = await query(`SELECT id, business_name, billing_address, npwp FROM customers WHERE id = $1`, [customerId]);
  const r = rows[0];
  return { customer: { id: String(r.id), businessName: r.business_name, address: r.billing_address, npwp: r.npwp || "" } };
}

/* ===================== back of house ===================== */

export async function listOrders(date) {
  await expireHolds();
  const { rows } = await query(
    `SELECT o.id, to_char(s.starts_at, 'HH24:MI') AS slot_start
       FROM orders o LEFT JOIN fulfillment_slots s ON s.id = o.slot_id
      WHERE ${date ? "o.pickup_date = $1 AND" : ""} o.status NOT IN ('awaiting_payment', 'expired')
      ORDER BY s.starts_at NULLS FIRST, o.created_at`,
    date ? [date] : []
  );
  const q = (t, p) => query(t, p);
  return Promise.all(rows.map((r) => hydrateOrder(q, r.id)));
}

export async function advanceOrder(orderId, to) {
  return transaction(async (client) => {
    const q = (t, p) => client.query(t, p);
    const { rows } = await q(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!rows.length) return { error: "not_found" };
    const status = rows[0].status;
    if (!FULFILLMENT_STAGES.includes(status)) return { error: "not_fulfillable" };
    const next = to || FULFILLMENT_FLOW[status];
    if (!next) return { error: "already_collected" };
    if (!FULFILLMENT_STAGES.includes(next)) return { error: "invalid_stage" };
    if (FULFILLMENT_STAGES.indexOf(next) <= FULFILLMENT_STAGES.indexOf(status)) return { error: "cannot_go_backwards" };
    await q(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, next]);
    return { order: await hydrateOrder(q, orderId) };
  });
}

export async function setAllocation(date, productId, total, pool = "retail", actor = "staff") {
  if (!productById.get(productId)) return { error: "invalid_item" };
  const n = Math.floor(Number(total));
  if (!Number.isFinite(n) || n < 0) return { error: "invalid_amount" };

  return transaction(async (client) => {
    const q = (t, p) => client.query(t, p);
    await ensureDate(q, date);
    const { rows } = await q(
      `SELECT retail_allocated, retail_sold, retail_held, wholesale_allocated
         FROM daily_inventory WHERE product_id = $1 AND available_date = $2 FOR UPDATE`,
      [productId, date]
    );
    if (!rows.length) return { error: "invalid_item" };
    const inv = rows[0];
    const sos = await loadStandingOrders(q);

    if (pool === "wholesale") {
      const committed = committedOn(sos, date, productId, "wholesale", null);
      if (n < committed) return { error: "below_committed", committed, pool };
      const prev = num(inv.wholesale_allocated);
      await q(`UPDATE daily_inventory SET wholesale_allocated = $1 WHERE product_id = $2 AND available_date = $3`, [n, productId, date]);
      await logInventory(q, { date, productId, delta: n - prev, reason: "allocation", actor, pool: "wholesale" });
    } else {
      const sub = committedOn(sos, date, productId, "retail", null);
      const committed = num(inv.retail_sold) + num(inv.retail_held) + sub;
      if (n < committed) return { error: "below_committed", committed, pool };
      const prev = num(inv.retail_allocated);
      await q(`UPDATE daily_inventory SET retail_allocated = $1 WHERE product_id = $2 AND available_date = $3`, [n, productId, date]);
      await logInventory(q, { date, productId, delta: n - prev, reason: "allocation", actor, pool: "retail" });
    }
    const { rows: after } = await q(
      `SELECT retail_allocated, retail_sold, retail_held, wholesale_allocated
         FROM daily_inventory WHERE product_id = $1 AND available_date = $2`, [productId, date]
    );
    return { ok: true, inventory: after[0] };
  });
}

export async function setSlotCapacity(date, slotIndex, max) {
  const start = SLOT_BOUNDS[slotIndex]?.start;
  if (start == null) return { error: "invalid_slot" };
  const n = Math.floor(Number(max));
  if (!Number.isFinite(n) || n < 0) return { error: "invalid_amount" };

  return transaction(async (client) => {
    const q = (t, p) => client.query(t, p);
    await ensureDate(q, date);
    const { rows } = await q(
      `SELECT id, max_capacity, booked_count FROM fulfillment_slots
        WHERE slot_date = $1 AND starts_at = $2 FOR UPDATE`, [date, start]
    );
    if (!rows.length) return { error: "invalid_slot" };
    const slot = rows[0];
    if (n < num(slot.booked_count)) return { error: "below_booked", booked: num(slot.booked_count) };
    await q(`UPDATE fulfillment_slots SET max_capacity = $1 WHERE id = $2`, [n, slot.id]);
    return { ok: true, slot: { maxCapacity: n, bookedCount: num(slot.booked_count) } };
  });
}

export async function getAdminDay(date) {
  await expireHolds();
  const dates = adminOpenDates(ADMIN_HORIZON_DAYS);
  if (!date) date = dates[0];
  const q = (t, p) => query(t, p);
  await ensureDate(q, date);

  // These six reads don't depend on one another, only on ensureDate above, so
  // they go out together instead of one round trip at a time.
  const [sos, { rows: invRows }, { rows: slotRows }, orders, subscriptionPickups, inventoryLog] =
    await Promise.all([
      loadStandingOrders(q),
      query(
        `SELECT product_id, retail_allocated, retail_sold, retail_held, wholesale_allocated
           FROM daily_inventory WHERE available_date = $1`, [date]
      ),
      query(
        `SELECT to_char(starts_at, 'HH24:MI') AS starts_at, max_capacity, booked_count
           FROM fulfillment_slots WHERE slot_date = $1`, [date]
      ),
      listOrders(date),
      subscriptionsOn(date),
      listInventoryLog(date),
    ]);
  const invBy = new Map(invRows.map((r) => [r.product_id, r]));

  const inventory = products.map((p) => {
    const inv = invBy.get(p.id) || { retail_allocated: 0, retail_sold: 0, retail_held: 0, wholesale_allocated: 0 };
    const wsCommitted = committedOn(sos, date, p.id, "wholesale", null);
    const subCommitted = committedOn(sos, date, p.id, "retail", null);
    const ra = num(inv.retail_allocated), rs = num(inv.retail_sold), rh = num(inv.retail_held), wa = num(inv.wholesale_allocated);
    return {
      productId: p.id, name: p.name, house: p.house, category: p.category, price: p.price,
      retailAllocated: ra, retailSold: rs, retailHeld: rh,
      retailSubscribed: subCommitted,
      retailAvailable: Math.max(0, ra - rs - rh - subCommitted),
      wholesaleAllocated: wa, wholesaleCommitted: wsCommitted,
      wholesaleFree: Math.max(0, wa - wsCommitted),
      soldWholesale: p.wholesalePrice != null,
      toBake: ra + wa,
    };
  });

  const slotBy = new Map(slotRows.map((s) => [s.starts_at, s]));
  const slots = SLOT_TIMES.map((time, i) => {
    const s = slotBy.get(SLOT_BOUNDS[i].start);
    return { index: i, time, maxCapacity: s ? num(s.max_capacity) : DEFAULT_SLOT_CAPACITY, bookedCount: s ? num(s.booked_count) : 0 };
  });

  const live = orders.filter((o) => o.status !== "cancelled");
  const revenue = live.reduce((a, o) => a + o.total, 0);
  const unitsSold = inventory.reduce((a, r) => a + r.retailSold, 0);
  const allocated = inventory.reduce((a, r) => a + r.retailAllocated, 0);
  const wholesaleUnits = inventory.reduce((a, r) => a + r.wholesaleCommitted, 0);
  const wholesaleRevenue = inventory.reduce((a, r) => {
    const p = productById.get(r.productId);
    return a + (p?.wholesalePrice || 0) * r.wholesaleCommitted;
  }, 0);

  return {
    date, dates, inventory, slots, orders, subscriptionPickups,
    inventoryLog,
    totals: {
      orders: orders.length, revenue, unitsSold, allocated,
      unsold: Math.max(0, allocated - unitsSold),
      sellThrough: allocated ? Math.round((unitsSold / allocated) * 100) : 0,
      awaitingCollection: live.filter((o) => o.status !== "collected").length,
      wholesaleUnits, wholesaleRevenue,
      toBake: inventory.reduce((a, r) => a + r.toBake, 0),
    },
  };
}
