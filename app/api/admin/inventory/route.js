import { setAllocation } from "@/lib/store";
import { requireStaff } from "@/lib/staff";
import { notifyAdminDay } from "@/lib/adminEvents";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/inventory  { date, productId, allocated, pool }
 *
 * `pool` is "retail" or "wholesale". They are separate numbers with separate
 * floors: retail cannot go below what is sold or held, wholesale cannot go below
 * what standing orders have promised.
 *
 * 409 on `below_committed` carries the floor and the pool, so the UI can say how
 * many are already spoken for instead of just refusing.
 */
export async function PATCH(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const { date, productId, allocated, pool } = body ?? {};
  if (!date || !productId) return Response.json({ error: "missing_fields" }, { status: 400 });
  if (pool && !["retail", "wholesale"].includes(pool))
    return Response.json({ error: "invalid_pool" }, { status: 400 });

  const res = await setAllocation(date, productId, allocated, pool || "retail");
  if (res.error) {
    const status = res.error === "below_committed" ? 409 : 400;
    return Response.json(res, { status });
  }
  notifyAdminDay(date);
  return Response.json(res);
}
