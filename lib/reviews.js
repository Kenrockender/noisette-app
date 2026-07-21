import { getOrder, getCustomer, getCustomerOrders, getProducts } from "./store.js";

/**
 * Reviews.
 *
 * A review hangs off an order item, not off a product. That single decision is
 * the whole integrity model: to review a croissant you must point at the order
 * in which you bought it, that order must be yours, and it must have actually
 * been collected. Nobody reviews from the street, and one purchase is one
 * voice, not a megaphone.
 *
 * Nothing shows on the product page until staff publish it. Moderation is not
 * censorship of low ratings, it is the same hand-checking the bakery applies
 * to wholesale applications: a human reads it before the shop wears it.
 *
 * In production this is the `reviews` table in db/schema.sql, where
 * `order_item_id UNIQUE` enforces one-review-per-line at the database level.
 */

const MAX_BODY = 800;

// Same globalThis singleton the store uses, filled key by key so HMR on a
// running dev server picks up the new maps (see the note in store.js).
const g = globalThis;
const db = (g.__noisette ??= {});
db.reviews ??= new Map(); // reviewId -> review
db.revSeq ??= 0;

const forOrderItem = (orderId, productId) =>
  [...db.reviews.values()].find((r) => r.orderId === orderId && r.productId === productId);

/**
 * Create a review, pending until staff decide.
 *
 * `customerId` must come from the session, never the body. Guest orders have
 * no customerId and therefore cannot be reviewed until they are claimed by
 * signing in, which is the same proof-of-ownership the rest of the account
 * system rests on.
 */
export async function createReview({ customerId, orderId, productId, rating, body }) {
  const c = await getCustomer(customerId);
  if (!c) return { error: "not_found" };

  const order = await getOrder(orderId);
  if (!order) return { error: "not_found" };
  if (order.customerId !== customerId) return { error: "not_your_order" };
  if (order.status !== "collected") return { error: "not_collected" };
  if (!order.items.some((it) => it.productId === productId))
    return { error: "not_in_order" };

  const n = Math.floor(Number(rating));
  if (!Number.isFinite(n) || n < 1 || n > 5) return { error: "invalid_rating" };

  if (forOrderItem(orderId, productId)) return { error: "already_reviewed" };

  const review = {
    id: "R-" + String(++db.revSeq).padStart(4, "0"),
    orderId,
    productId,
    customerId,
    rating: n,
    body: String(body || "").trim().slice(0, MAX_BODY),
    status: "pending", // pending | published | rejected
    createdAt: Date.now(),
  };
  db.reviews.set(review.id, review);
  return { review };
}

/** First name only. A review signs a voice, not a phone number. */
async function authorName(customerId) {
  const c = await getCustomer(customerId);
  const first = (c?.name || "").trim().split(/\s+/)[0];
  return first || "Noisette customer";
}

/** What the product page shows: published reviews plus their arithmetic. */
export async function publishedReviews(productId) {
  const published = [...db.reviews.values()]
    .filter((r) => r.productId === productId && r.status === "published")
    .sort((a, b) => b.createdAt - a.createdAt);
  const list = [];
  for (const r of published) {
    list.push({
      id: r.id,
      rating: r.rating,
      body: r.body,
      author: await authorName(r.customerId),
      createdAt: r.createdAt,
    });
  }
  const count = list.length;
  const average = count
    ? Math.round((list.reduce((a, r) => a + r.rating, 0) / count) * 10) / 10
    : null;
  return { reviews: list, stats: { count, average } };
}

/** Rating stats for every product with at least one published review, for catalog cards. */
export function allProductStats() {
  const byProduct = new Map();
  for (const r of db.reviews.values()) {
    if (r.status !== "published") continue;
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
    byProduct.get(r.productId).push(r.rating);
  }
  const stats = {};
  for (const [productId, ratings] of byProduct) {
    const count = ratings.length;
    stats[productId] = {
      count,
      average: Math.round((ratings.reduce((a, b) => a + b, 0) / count) * 10) / 10,
    };
  }
  return stats;
}

/** This account's own reviews, every status, so the UI can say "in review". */
export function myReviews(customerId) {
  return [...db.reviews.values()]
    .filter((r) => r.customerId === customerId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Items this account could still review: collected orders, minus lines that
 * already have one. Drives the review buttons in the account sheet.
 */
export async function reviewableItems(customerId) {
  const out = [];
  for (const order of await getCustomerOrders(customerId)) {
    if (order.status !== "collected") continue;
    for (const it of order.items) {
      if (!forOrderItem(order.id, it.productId)) {
        out.push({ orderId: order.id, productId: it.productId, name: it.name });
      }
    }
  }
  return out;
}

/** The moderation queue, enriched so staff do not have to cross-reference ids. */
export async function listReviewsForModeration(status = "pending") {
  const products = getProducts();
  const queue = [...db.reviews.values()]
    .filter((r) => r.status === status)
    .sort((a, b) => a.createdAt - b.createdAt);
  const out = [];
  for (const r of queue) {
    out.push({
      ...r,
      author: await authorName(r.customerId),
      productName: products.find((p) => p.id === r.productId)?.name || r.productId,
    });
  }
  return out;
}

/**
 * Publish or reject. Pending only: a published review that needs to come down
 * is an incident, not a toggle, and deserves better than a silent flip.
 */
export function moderateReview(id, publish) {
  const r = db.reviews.get(id);
  if (!r) return { error: "not_found" };
  if (r.status !== "pending") return { error: "already_decided" };
  r.status = publish ? "published" : "rejected";
  r.decidedAt = Date.now();
  return { review: r };
}
