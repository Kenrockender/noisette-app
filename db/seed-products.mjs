/**
 * Seeds the `products` table from the code-defined catalog (lib/store/catalog.js).
 *
 * The catalog is the source of truth for what a croissant costs; this script
 * just mirrors it into Postgres so the `daily_inventory.product_id` foreign key
 * has something to point at. Upserts on `id`, so it is safe to re-run after the
 * catalog changes. `pairs_with` is self-referential, so rows land in two passes:
 * insert with it null, then fill it in once every id exists.
 *
 * Usage: node --env-file=.env.local db/seed-products.mjs
 */
import { Client } from "pg";
import { products } from "../lib/store/catalog.js";
import { sslFor } from "../lib/db/pg.js";

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
});

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  await client.connect();
  try {
    for (const p of products) {
      await client.query(
        `INSERT INTO products (id, name, house, category, price_idr, wholesale_price_idr, wholesale_moq, description, allergens)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, house = EXCLUDED.house, category = EXCLUDED.category,
           price_idr = EXCLUDED.price_idr, wholesale_price_idr = EXCLUDED.wholesale_price_idr,
           wholesale_moq = EXCLUDED.wholesale_moq, description = EXCLUDED.description,
           allergens = EXCLUDED.allergens`,
        [p.id, p.name, p.house, p.category, p.price, p.wholesalePrice ?? null, p.wholesaleMoq ?? null, p.description, p.allergens]
      );
    }
    for (const p of products) {
      await client.query(`UPDATE products SET pairs_with = $2 WHERE id = $1`, [p.id, p.pairsWith ?? null]);
    }
    console.log(`Seeded ${products.length} products.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
