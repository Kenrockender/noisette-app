import { getAdminDay } from "@/lib/store";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** GET /api/admin/day?date=YYYY-MM-DD returns inventory, slots, orders and totals. */
export async function GET(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const date = new URL(request.url).searchParams.get("date");
  return Response.json(await getAdminDay(date || undefined));
}
