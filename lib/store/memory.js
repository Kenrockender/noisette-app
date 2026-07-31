/**
 * In-memory data store. The Phase 1 stand-in, kept as a first-class backend so
 * `node --test` and a bare checkout run with no infrastructure (plan.md #5).
 *
 * The Postgres adapter in ./pg.js mirrors this function for function; the
 * dispatcher in ../store.js picks between them by environment. Logic here is
 * unchanged from the original single-file store; only the static catalog moved
 * out to ./catalog.js so both adapters share it.
 */

import { normalizeWhatsapp } from "../auth.js";
import {
  HOLD_TTL_MS, GIFT_WRAP_PRICE, products, productById, SLOT_TIMES,
  DEFAULT_RETAIL, DEFAULT_WHOLESALE, DEFAULT_SLOT_CAPACITY,
  ADMIN_HORIZON_DAYS, FULFILLMENT_FLOW, FULFILLMENT_STAGES,
  isoDay, nextOpenDates, adminOpenDates, occurrencesOf,
} from "./catalog.js";

// ---- state (module-scoped singleton; survives HMR via globalThis) ----
/*
 * Filled in key by key rather than all at once, so adding a new map does not get
 * skipped on an already-running dev server (that cost real debugging time once).
 */
const g = globalThis;
const db = (g.__noisette ??= {});
db.dailyInventory ??= new Map(); // `${date}:${productId}` -> counters
db.slots ??= new Map();          // `${date}:${slotIndex}`  -> { maxCapacity, bookedCount }
db.orders ??= new Map();         // orderId -> order
db.customers ??= new Map();      // customerId -> customer
db.byWhatsapp ??= new Map();     // normalized whatsapp -> customerId
db.standingOrders ??= new Map(); // standingOrderId -> standing order
db.seq ??= 341;
db.custSeq ??= 0;
db.stSeq ??= 0;
db.inventoryLog ??= [];          // append-only audit of every stock movement
db.invLogSeq ??= 0;

/** Append-only inventory audit (PRD section 7, inventory_transactions). */
function logInventory({ date, productId, delta, reason, orderId = null, actor = "system", pool = "retail" }) {
  db.inventoryLog.push({
    id: "IX-" + String(++db.invLogSeq).padStart(5, "0"),
    date, productId, pool, delta, reason, orderId, actor, at: Date.now(),
  });
}

export function listInventoryLog(date, limit = 200) {
  return db.inventoryLog
    .filter((r) => (date ? r.date === date : true))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

function ensureDate(date) {
  for (const p of products) {
    const key = `${date}:${p.id}`;
    if (!db.dailyInventory.has(key)) {
      db.dailyInventory.set(key, {
        retailAllocated: DEFAULT_RETAIL[p.id] ?? 0,
        retailSold: 0,
        retailHeld: 0,
        wholesaleAllocated: DEFAULT_WHOLESALE[p.id] ?? 0,
      });
    }
  }
  SLOT_TIMES.forEach((_, i) => {
    const key = `${date}:${i}`;
    if (!db.slots.has(key)) db.slots.set(key, { maxCapacity: DEFAULT_SLOT_CAPACITY, bookedCount: 0 });
  });
}

/** Retail availability. Reads the retail pool and nothing else, by design. */
function retailFree(date, productId) {
  const inv = db.dailyInventory.get(`${date}:${productId}`);
  if (!inv) return 0;
  return Math.max(
    0,
    inv.retailAllocated - inv.retailSold - inv.retailHeld - subscriptionCommitted(date, productId)
  );
}

export function expireHolds() {
  const now = Date.now();
  for (const order of db.orders.values()) {
    if (order.status === "awaiting_payment" && now > order.holdExpiresAt) {
      order.status = "expired";
      for (const it of order.items) {
        const inv = db.dailyInventory.get(`${order.pickupDate}:${it.productId}`);
        if (inv) inv.retailHeld = Math.max(0, inv.retailHeld - it.qty);
        logInventory({ date: order.pickupDate, productId: it.productId, delta: it.qty, reason: "hold_release", orderId: order.id });
      }
      const slot = db.slots.get(`${order.pickupDate}:${order.slotIndex}`);
      if (slot) slot.bookedCount = Math.max(0, slot.bookedCount - 1);
    }
  }
}

export function getProducts() {
  return products;
}

export function getAvailability(date) {
  expireHolds();
  const dates = nextOpenDates();
  if (!date) date = dates[0];
  if (!dates.includes(date)) return { error: "date_not_open", dates };
  ensureDate(date);

  const stock = {};
  for (const p of products) stock[p.id] = retailFree(date, p.id);
  const slots = SLOT_TIMES.map((time, i) => {
    const s = db.slots.get(`${date}:${i}`);
    return { index: i, time, remaining: Math.max(0, s.maxCapacity - s.bookedCount) };
  });
  return { date, dates, stock, slots, giftWrapPrice: GIFT_WRAP_PRICE };
}

export function createOrder({ items, pickupDate, slotIndex, name, whatsapp, paymentMethod, giftWrap, giftContents, customerId }) {
  expireHolds();
  if (!Array.isArray(items) || items.length === 0) return { error: "empty_bag" };
  if (!name?.trim() || !whatsapp?.trim()) return { error: "missing_contact" };
  const dates = nextOpenDates();
  if (!dates.includes(pickupDate)) return { error: "date_not_open" };
  ensureDate(pickupDate);

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
      const q = Math.floor(Number(gc.qty));
      if (!gp) return { error: "invalid_gift_pick", productId: gc.productId };
      if (!Number.isFinite(q) || q <= 0) return { error: "invalid_gift_pick", productId: gc.productId };
      picks.push({ productId: gp.id, name: gp.name, qty: q });
      count += q;
    }
    if (count !== need) return { error: "gift_box_incomplete", need, got: count };
    giftPicks = picks;
  }

  const slot = db.slots.get(`${pickupDate}:${slotIndex}`);
  if (!slot) return { error: "invalid_slot" };
  if (slot.bookedCount >= slot.maxCapacity) return { error: "slot_full" };

  const reserved = [];
  function rollback() { for (const r of reserved) r.inv.retailHeld -= r.qty; }
  for (const it of items) {
    const p = productById.get(it.productId);
    const inv = db.dailyInventory.get(`${pickupDate}:${it.productId}`);
    const qty = Math.floor(it.qty);
    if (!p || !inv || qty <= 0) { rollback(); return { error: "invalid_item", productId: it.productId }; }
    const available = retailFree(pickupDate, it.productId);
    if (qty > available) { rollback(); return { error: "insufficient_stock", productId: it.productId, available }; }
    inv.retailHeld += qty;
    reserved.push({ inv, qty });
  }

  slot.bookedCount += 1;

  const orderItems = items.map((it) => {
    const p = productById.get(it.productId);
    return { productId: p.id, name: p.name, qty: Math.floor(it.qty), unitPrice: p.price };
  });
  let total = orderItems.reduce((a, it) => a + it.unitPrice * it.qty, 0);
  if (giftWrap) total += GIFT_WRAP_PRICE;

  const id = "N-" + String(++db.seq).padStart(4, "0");
  const order = {
    id, status: "awaiting_payment",
    items: orderItems, giftWrap: !!giftWrap, giftContents: giftPicks, total,
    pickupDate, slotIndex, slotTime: SLOT_TIMES[slotIndex],
    customer: { name: name.trim(), whatsapp: whatsapp.trim() },
    customerId: customerId || null,
    whatsappKey: normalizeWhatsapp(whatsapp),
    paymentMethod: paymentMethod || "QRIS",
    createdAt: Date.now(),
    holdExpiresAt: Date.now() + HOLD_TTL_MS,
  };
  db.orders.set(id, order);
  for (const it of orderItems) {
    logInventory({ date: pickupDate, productId: it.productId, delta: -it.qty, reason: "hold", orderId: id });
  }
  if (customerId) touchCustomer(customerId, { name: name.trim() });
  return { order };
}

/**
 * A sale rung up at the counter: paid and handed over in the same motion, so
 * unlike createOrder it skips the slot, the hold, and awaiting_payment
 * entirely and lands straight on 'collected'. Still draws from the same
 * retail pool as pre-orders, so it still needs to check and move stock.
 */
export function createWalkinSale({ items, pickupDate, name, actor = "staff" }) {
  if (!Array.isArray(items) || items.length === 0) return { error: "empty_bag" };
  ensureDate(pickupDate);

  const orderItems = [];
  for (const it of items) {
    const p = productById.get(it.productId);
    const qty = Math.floor(Number(it.qty));
    if (!p || !Number.isFinite(qty) || qty <= 0) return { error: "invalid_item", productId: it.productId };
    const available = retailFree(pickupDate, it.productId);
    if (qty > available) return { error: "insufficient_stock", productId: it.productId, available };
    orderItems.push({ productId: p.id, name: p.name, qty, unitPrice: p.price });
  }

  for (const it of orderItems) {
    db.dailyInventory.get(`${pickupDate}:${it.productId}`).retailSold += it.qty;
  }

  const total = orderItems.reduce((a, it) => a + it.unitPrice * it.qty, 0);
  const id = "N-" + String(++db.seq).padStart(4, "0");
  const order = {
    id, status: "collected",
    items: orderItems, giftWrap: false, giftContents: null, total,
    pickupDate, slotIndex: null, slotTime: null, isWalkin: true,
    customer: { name: (name || "").trim() || "Pelanggan toko", whatsapp: "" },
    customerId: null,
    whatsappKey: "",
    paymentMethod: "Tunai",
    createdAt: Date.now(),
    holdExpiresAt: null,
    paidAt: Date.now(),
  };
  db.orders.set(id, order);
  for (const it of orderItems) {
    logInventory({ date: pickupDate, productId: it.productId, delta: -it.qty, reason: "walkin_sale", orderId: id, actor });
  }
  return { order };
}

/* ===================== customers ===================== */

export function upsertCustomer(whatsappKey, { name } = {}) {
  let id = db.byWhatsapp.get(whatsappKey);
  if (!id) {
    id = "C-" + String(++db.custSeq).padStart(4, "0");
    db.customers.set(id, {
      id, whatsapp: whatsappKey, name: name || "", type: "retail", createdAt: Date.now(),
    });
    db.byWhatsapp.set(whatsappKey, id);
  } else if (name) {
    touchCustomer(id, { name });
  }
  return db.customers.get(id);
}

function touchCustomer(id, patch) {
  const c = db.customers.get(id);
  if (!c) return null;
  if (patch.name && !c.name) c.name = patch.name;
  return c;
}

export function getCustomer(id) {
  return db.customers.get(id) || null;
}

export function claimGuestOrders(customerId) {
  const c = db.customers.get(customerId);
  if (!c) return { claimed: 0 };
  let claimed = 0;
  for (const o of db.orders.values()) {
    if (!o.customerId && o.whatsappKey === c.whatsapp) {
      o.customerId = customerId;
      claimed += 1;
      if (!c.name && o.customer?.name) c.name = o.customer.name;
    }
  }
  return { claimed };
}

export function getCustomerOrders(customerId) {
  expireHolds();
  return [...db.orders.values()]
    .filter((o) => o.customerId === customerId && o.status !== "expired" && o.status !== "awaiting_payment")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function markPaid(orderId) {
  expireHolds();
  const order = db.orders.get(orderId);
  if (!order) return { error: "not_found" };
  if (order.status === "paid") return { order };
  if (order.status !== "awaiting_payment") return { error: "hold_expired" };

  for (const it of order.items) {
    const inv = db.dailyInventory.get(`${order.pickupDate}:${it.productId}`);
    inv.retailHeld = Math.max(0, inv.retailHeld - it.qty);
    inv.retailSold += it.qty;
    logInventory({ date: order.pickupDate, productId: it.productId, delta: -it.qty, reason: "sale", orderId: order.id });
  }
  order.status = "paid";
  order.paidAt = Date.now();
  return { order };
}

export function getOrder(orderId) {
  expireHolds();
  return db.orders.get(orderId) || null;
}

export function cancelOrder(orderId, { actor = "customer" } = {}) {
  expireHolds();
  const order = db.orders.get(orderId);
  if (!order) return { error: "not_found" };
  if (order.status === "cancelled") return { order };
  // A walk-in is rung up already "collected" (paid and handed over in the same
  // motion), so it never passes through paid/preparing/ready. Staff still need
  // to void a mistap, same trading day only, same as every other cancel here.
  const cancellable =
    ["paid", "preparing", "ready"].includes(order.status) ||
    (order.isWalkin && order.status === "collected");
  if (!cancellable) return { error: "not_cancellable", status: order.status };
  if (order.pickupDate < isoDay(new Date())) return { error: "too_late" };

  for (const it of order.items) {
    const inv = db.dailyInventory.get(`${order.pickupDate}:${it.productId}`);
    if (inv) inv.retailSold = Math.max(0, inv.retailSold - it.qty);
    logInventory({ date: order.pickupDate, productId: it.productId, delta: it.qty, reason: "cancel_release", orderId: order.id, actor });
  }
  const slot = db.slots.get(`${order.pickupDate}:${order.slotIndex}`);
  if (slot) slot.bookedCount = Math.max(0, slot.bookedCount - 1);
  order.status = "cancelled";
  order.cancelledAt = Date.now();
  return { order };
}

/* ===================== wholesale / standing orders ===================== */

function committedOn(date, productId, channel, exceptId) {
  let n = 0;
  for (const so of db.standingOrders.values()) {
    if (!so.active || so.id === exceptId) continue;
    if ((so.channel ?? "wholesale") !== channel) continue;
    if (!occurrencesOf(so).includes(date)) continue;
    for (const it of so.items) if (it.productId === productId) n += it.qty;
  }
  return n;
}

export function wholesaleCommitted(date, productId, exceptId = null) {
  return committedOn(date, productId, "wholesale", exceptId);
}

export function subscriptionCommitted(date, productId, exceptId = null) {
  return committedOn(date, productId, "retail", exceptId);
}

/** Both pools' commitments for one date, in a single pass over the templates. */
function committedMapsOn(date) {
  const wholesale = new Map();
  const retail = new Map();
  for (const so of db.standingOrders.values()) {
    if (!so.active) continue;
    if (!occurrencesOf(so).includes(date)) continue;
    const m = (so.channel ?? "wholesale") === "wholesale" ? wholesale : retail;
    for (const it of so.items) m.set(it.productId, (m.get(it.productId) || 0) + it.qty);
  }
  return { wholesale, retail };
}

export function wholesaleFree(date, productId) {
  ensureDate(date);
  const inv = db.dailyInventory.get(`${date}:${productId}`);
  if (!inv) return 0;
  return Math.max(0, inv.wholesaleAllocated - wholesaleCommitted(date, productId));
}

export function saveStandingOrder({ id, customerId, weekday, items, startsOn, endsOn, channel = "wholesale" }) {
  const c = db.customers.get(customerId);
  if (!c) return { error: "not_found" };
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
    id: id || null, customerId, channel, weekday, items: clean,
    startsOn: startsOn || nextOpenDates(1)[0], endsOn: endsOn || null,
    pausedUntil: null, active: true,
  };

  for (const date of occurrencesOf(draft)) {
    ensureDate(date);
    for (const it of clean) {
      const inv = db.dailyInventory.get(`${date}:${it.productId}`);
      if (channel === "wholesale") {
        const already = wholesaleCommitted(date, it.productId, draft.id);
        if (already + it.qty > inv.wholesaleAllocated) {
          return { error: "wholesale_capacity", date, productId: it.productId, name: it.name, requested: it.qty, free: Math.max(0, inv.wholesaleAllocated - already) };
        }
      } else {
        const already = subscriptionCommitted(date, it.productId, draft.id);
        const free = inv.retailAllocated - inv.retailSold - inv.retailHeld - already;
        if (it.qty > free) {
          return { error: "retail_capacity", date, productId: it.productId, name: it.name, requested: it.qty, free: Math.max(0, free) };
        }
      }
    }
  }

  const soId = draft.id || "S-" + String(++db.stSeq).padStart(3, "0");
  const existing = db.standingOrders.get(soId);
  // Ownership check: replacing an id you do not own is indistinguishable from
  // replacing an id that does not exist. Same shape as deleteStandingOrder.
  if (existing && existing.customerId !== customerId) return { error: "not_found" };
  const so = { ...draft, id: soId, createdAt: existing?.createdAt ?? Date.now() };
  db.standingOrders.set(soId, so);
  return { standingOrder: so };
}

export function listStandingOrders(customerId, channel) {
  return [...db.standingOrders.values()]
    .filter((s) => (customerId ? s.customerId === customerId : true))
    .filter((s) => (channel ? (s.channel ?? "wholesale") === channel : true))
    .sort((a, b) => a.weekday - b.weekday || a.createdAt - b.createdAt);
}

export function setStandingOrderActive(id, active) {
  const so = db.standingOrders.get(id);
  if (!so) return { error: "not_found" };
  so.active = !!active;
  return { standingOrder: so };
}

export function deleteStandingOrder(id, customerId) {
  const so = db.standingOrders.get(id);
  if (!so) return { error: "not_found" };
  if (customerId && so.customerId !== customerId) return { error: "not_found" };
  db.standingOrders.delete(id);
  return { ok: true };
}

function scheduleFor(customerId, channel, weeks) {
  const out = [];
  for (const so of listStandingOrders(customerId, channel)) {
    if (!so.active) continue;
    for (const date of occurrencesOf(so, weeks * 7)) {
      out.push({
        date, standingOrderId: so.id, customerId: so.customerId, items: so.items,
        total: so.items.reduce((a, it) => a + it.unitPrice * it.qty, 0),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function wholesaleSchedule(customerId, weeks = 4) {
  return scheduleFor(customerId, "wholesale", weeks);
}

export function subscriptionSchedule(customerId, weeks = 4) {
  return scheduleFor(customerId, "retail", weeks);
}

export function subscriptionsOn(date) {
  return scheduleFor(undefined, "retail", 5)
    .filter((s) => s.date === date)
    .map((s) => ({ ...s, name: db.customers.get(s.customerId)?.name || "Subscriber" }));
}

/* ===================== wholesale applications ===================== */

export function applyForWholesale(customerId, { businessName, address, npwp }) {
  const c = db.customers.get(customerId);
  if (!c) return { error: "not_found" };
  if (c.type === "wholesale") return { error: "already_wholesale" };
  if (!businessName?.trim() || !address?.trim()) return { error: "missing_fields" };
  if (c.application?.status === "pending") return { error: "already_pending" };

  c.application = {
    businessName: businessName.trim(), address: address.trim(), npwp: npwp?.trim() || "",
    status: "pending", submittedAt: Date.now(),
  };
  return { application: c.application };
}

export function listWholesaleApplications(status = "pending") {
  return [...db.customers.values()]
    .filter((c) => c.application?.status === status)
    .map((c) => ({ customerId: c.id, name: c.name, whatsapp: c.whatsapp, ...c.application }))
    .sort((a, b) => a.submittedAt - b.submittedAt);
}

export function decideWholesaleApplication(customerId, approve) {
  const c = db.customers.get(customerId);
  if (!c?.application) return { error: "not_found" };
  if (c.application.status !== "pending") return { error: "already_decided" };

  c.application.status = approve ? "approved" : "rejected";
  c.application.decidedAt = Date.now();
  if (approve) {
    c.type = "wholesale";
    c.businessName = c.application.businessName;
    c.address = c.application.address;
    c.npwp = c.application.npwp;
  }
  return { customer: c };
}

export function updateWholesaleProfile(customerId, { businessName, address, npwp } = {}) {
  const c = db.customers.get(customerId);
  if (!c) return { error: "not_found" };
  if (c.type !== "wholesale") return { error: "not_wholesale" };

  if (businessName !== undefined) {
    if (!String(businessName).trim()) return { error: "missing_fields" };
    c.businessName = String(businessName).trim();
  }
  if (address !== undefined) {
    if (!String(address).trim()) return { error: "missing_fields" };
    c.address = String(address).trim();
  }
  if (npwp !== undefined) c.npwp = String(npwp || "").trim();

  return { customer: { id: c.id, businessName: c.businessName, address: c.address, npwp: c.npwp || "" } };
}

/* ===================== back of house ===================== */

export function listOrders(date) {
  expireHolds();
  return [...db.orders.values()]
    .filter((o) => (date ? o.pickupDate === date : true) && o.status !== "awaiting_payment" && o.status !== "expired")
    .sort((a, b) => a.slotIndex - b.slotIndex || a.createdAt - b.createdAt);
}

export function advanceOrder(orderId, to) {
  const order = db.orders.get(orderId);
  if (!order) return { error: "not_found" };
  if (!FULFILLMENT_STAGES.includes(order.status)) return { error: "not_fulfillable" };

  const next = to || FULFILLMENT_FLOW[order.status];
  if (!next) return { error: "already_collected" };
  if (!FULFILLMENT_STAGES.includes(next)) return { error: "invalid_stage" };
  if (FULFILLMENT_STAGES.indexOf(next) <= FULFILLMENT_STAGES.indexOf(order.status))
    return { error: "cannot_go_backwards" };

  order.status = next;
  order.stageAt = { ...(order.stageAt || {}), [next]: Date.now() };
  return { order };
}

export function setAllocation(date, productId, total, pool = "retail", actor = "staff") {
  ensureDate(date);
  const inv = db.dailyInventory.get(`${date}:${productId}`);
  if (!inv) return { error: "invalid_item" };
  const n = Math.floor(Number(total));
  if (!Number.isFinite(n) || n < 0) return { error: "invalid_amount" };

  if (pool === "wholesale") {
    const committed = wholesaleCommitted(date, productId);
    if (n < committed) return { error: "below_committed", committed, pool };
    const prev = inv.wholesaleAllocated;
    inv.wholesaleAllocated = n;
    logInventory({ date, productId, delta: n - prev, reason: "allocation", actor, pool: "wholesale" });
  } else {
    const committed = inv.retailSold + inv.retailHeld + subscriptionCommitted(date, productId);
    if (n < committed) return { error: "below_committed", committed, pool };
    const prev = inv.retailAllocated;
    inv.retailAllocated = n;
    logInventory({ date, productId, delta: n - prev, reason: "allocation", actor, pool: "retail" });
  }
  return { ok: true, inventory: { ...inv } };
}

export function setSlotCapacity(date, slotIndex, max) {
  ensureDate(date);
  const slot = db.slots.get(`${date}:${slotIndex}`);
  if (!slot) return { error: "invalid_slot" };
  const n = Math.floor(Number(max));
  if (!Number.isFinite(n) || n < 0) return { error: "invalid_amount" };
  if (n < slot.bookedCount) return { error: "below_booked", booked: slot.bookedCount };
  slot.maxCapacity = n;
  return { ok: true, slot: { ...slot } };
}

export function getAdminDay(date) {
  expireHolds();
  const dates = adminOpenDates(ADMIN_HORIZON_DAYS);
  if (!date) date = dates[0];
  ensureDate(date);

  const committed = committedMapsOn(date);
  const inventory = products.map((p) => {
    const inv = db.dailyInventory.get(`${date}:${p.id}`);
    const wsCommitted = committed.wholesale.get(p.id) || 0;
    const subCommitted = committed.retail.get(p.id) || 0;
    return {
      productId: p.id, name: p.name, house: p.house, category: p.category, price: p.price,
      retailAllocated: inv.retailAllocated, retailSold: inv.retailSold, retailHeld: inv.retailHeld,
      retailSubscribed: subCommitted,
      retailAvailable: Math.max(0, inv.retailAllocated - inv.retailSold - inv.retailHeld - subCommitted),
      wholesaleAllocated: inv.wholesaleAllocated, wholesaleCommitted: wsCommitted,
      wholesaleFree: Math.max(0, inv.wholesaleAllocated - wsCommitted),
      soldWholesale: p.wholesalePrice != null,
      toBake: inv.retailAllocated + inv.wholesaleAllocated,
    };
  });

  const slots = SLOT_TIMES.map((time, i) => {
    const s = db.slots.get(`${date}:${i}`);
    return { index: i, time, maxCapacity: s.maxCapacity, bookedCount: s.bookedCount };
  });

  const orders = listOrders(date);
  const subscriptionPickups = subscriptionsOn(date);
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
    inventoryLog: listInventoryLog(date),
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
