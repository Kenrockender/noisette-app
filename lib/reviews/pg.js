import { query } from "../db/pg.js";

const toMs = (v) => (v == null ? null : new Date(v).getTime());
const MAX_BODY = 800;

export async function createReview({ customerId, orderId, productId, rating, body }) {
  const n = Math.floor(Number(rating));
  if (!Number.isFinite(n) || n < 1 || n > 5) return { error: "invalid_rating" };

  const cRes = await query(`SELECT id FROM customers WHERE id = $1`, [customerId]);
  if (cRes.rows.length === 0) return { error: "not_found" };

  const oRes = await query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (oRes.rows.length === 0) return { error: "not_found" };
  if (oRes.rows[0].customer_id !== customerId) return { error: "not_your_order" };
  if (oRes.rows[0].status !== "collected") return { error: "not_collected" };

  const oiRes = await query(
    `SELECT id FROM order_items WHERE order_id = $1 AND product_id = $2`,
    [orderId, productId]
  );
  if (oiRes.rows.length === 0) return { error: "not_in_order" };
  const orderItemId = oiRes.rows[0].id;

  try {
    const res = await query(
      `INSERT INTO reviews (order_item_id, customer_id, product_id, rating, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, order_item_id, customer_id, product_id, rating, body, status, created_at`,
      [orderItemId, customerId, productId, n, String(body || "").trim().slice(0, MAX_BODY)]
    );
    const row = res.rows[0];
    return {
      review: {
        id: "R-" + String(row.id).padStart(4, "0"),
        orderId,
        productId: row.product_id,
        customerId: row.customer_id,
        rating: row.rating,
        body: row.body,
        status: row.status,
        createdAt: toMs(row.created_at)
      }
    };
  } catch (err) {
    if (err.code === "23505") return { error: "already_reviewed" };
    throw err;
  }
}

export async function publishedReviews(productId) {
  const res = await query(
    `SELECT r.*, c.name as author_name 
     FROM reviews r 
     JOIN customers c ON c.id = r.customer_id 
     WHERE r.product_id = $1 AND r.status = 'published'
     ORDER BY r.created_at DESC`,
    [productId]
  );
  const list = res.rows.map((r) => ({
    id: "R-" + String(r.id).padStart(4, "0"),
    rating: r.rating,
    body: r.body,
    author: (r.author_name || "").trim().split(/\\s+/)[0] || "Noisette customer",
    createdAt: toMs(r.created_at)
  }));
  const count = list.length;
  const average = count
    ? Math.round((list.reduce((a, r) => a + r.rating, 0) / count) * 10) / 10
    : null;
  return { reviews: list, stats: { count, average } };
}

export async function allProductStats() {
  const res = await query(
    `SELECT product_id, AVG(rating)::numeric as avg_rating, COUNT(*) as count 
     FROM reviews 
     WHERE status = 'published' 
     GROUP BY product_id`
  );
  const stats = {};
  for (const row of res.rows) {
    stats[row.product_id] = {
      count: parseInt(row.count, 10),
      average: Math.round(parseFloat(row.avg_rating) * 10) / 10
    };
  }
  return stats;
}

export async function myReviews(customerId) {
  const res = await query(
    `SELECT r.*, oi.order_id 
     FROM reviews r
     JOIN order_items oi ON oi.id = r.order_item_id
     WHERE r.customer_id = $1
     ORDER BY r.created_at DESC`,
    [customerId]
  );
  return res.rows.map((r) => ({
    id: "R-" + String(r.id).padStart(4, "0"),
    orderId: r.order_id,
    productId: r.product_id,
    customerId: r.customer_id,
    rating: r.rating,
    body: r.body,
    status: r.status,
    createdAt: toMs(r.created_at)
  }));
}

export async function reviewableItems(customerId) {
  const res = await query(
    `SELECT oi.order_id, oi.product_id, p.name 
     FROM order_items oi 
     JOIN orders o ON o.id = oi.order_id 
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN reviews r ON r.order_item_id = oi.id 
     WHERE o.customer_id = $1 AND o.status = 'collected' AND r.id IS NULL
     ORDER BY oi.order_id DESC`,
    [customerId]
  );
  return res.rows.map((r) => ({
    orderId: r.order_id,
    productId: r.product_id,
    name: r.name
  }));
}

export async function listReviewsForModeration(status = "pending") {
  const res = await query(
    `SELECT r.*, c.name as author_name, p.name as product_name, oi.order_id
     FROM reviews r 
     JOIN customers c ON c.id = r.customer_id 
     JOIN products p ON p.id = r.product_id
     JOIN order_items oi ON oi.id = r.order_item_id
     WHERE r.status = $1
     ORDER BY r.created_at ASC`,
    [status]
  );
  return res.rows.map((r) => ({
    id: "R-" + String(r.id).padStart(4, "0"),
    orderId: r.order_id,
    productId: r.product_id,
    customerId: r.customer_id,
    rating: r.rating,
    body: r.body,
    status: r.status,
    createdAt: toMs(r.created_at),
    author: (r.author_name || "").trim().split(/\\s+/)[0] || "Noisette customer",
    productName: r.product_name
  }));
}

export async function moderateReview(id, publish) {
  if (!id.startsWith("R-")) return { error: "not_found" };
  const numericId = parseInt(id.slice(2), 10);
  
  const res = await query(
    `UPDATE reviews 
     SET status = $1, decided_at = now() 
     WHERE id = $2 AND status = 'pending'
     RETURNING *`,
    [publish ? 'published' : 'rejected', numericId]
  );
  
  if (res.rows.length === 0) {
    const chk = await query(`SELECT status FROM reviews WHERE id = $1`, [numericId]);
    if (chk.rows.length === 0) return { error: "not_found" };
    return { error: "already_decided" };
  }
  
  const row = res.rows[0];
  const oiRes = await query(`SELECT order_id FROM order_items WHERE id = $1`, [row.order_item_id]);

  return {
    review: {
      id: "R-" + String(row.id).padStart(4, "0"),
      orderId: oiRes.rows[0].order_id,
      productId: row.product_id,
      customerId: row.customer_id,
      rating: row.rating,
      body: row.body,
      status: row.status,
      createdAt: toMs(row.created_at),
      decidedAt: toMs(row.decided_at)
    }
  };
}
