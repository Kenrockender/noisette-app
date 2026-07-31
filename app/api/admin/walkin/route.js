import { createWalkinSale } from "@/lib/store";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/walkin  { date, items: [{ productId, qty }], name? }
 *
 * A sale rung up at the counter: paid and handed over in the same motion, no
 * WhatsApp or slot needed. Still draws from the same retail pool as
 * pre-orders, so it can still 409 on insufficient_stock.
 */
export async function POST(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const { date, items, name } = body ?? {};
  if (!date || !Array.isArray(items) || items.length === 0)
    return Response.json({ error: "missing_fields" }, { status: 400 });

  const res = await createWalkinSale({ items, pickupDate: date, name, actor: "staff" });
  if (res.error) {
    const status = res.error === "insufficient_stock" ? 409 : 400;
    return Response.json(res, { status });
  }
  return Response.json(res);
}
