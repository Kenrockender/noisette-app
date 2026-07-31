import { setSlotCapacity } from "@/lib/store";
import { requireStaff } from "@/lib/staff";
import { notifyAdminDay } from "@/lib/adminEvents";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/slots  { date, slotIndex, maxCapacity } */
export async function PATCH(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const { date, slotIndex, maxCapacity } = body ?? {};
  if (!date || slotIndex === undefined || slotIndex === null)
    return Response.json({ error: "missing_fields" }, { status: 400 });

  const res = await setSlotCapacity(date, slotIndex, maxCapacity);
  if (res.error) {
    const status = res.error === "below_booked" ? 409 : 400;
    return Response.json(res, { status });
  }
  notifyAdminDay(date);
  return Response.json(res);
}
