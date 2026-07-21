import { listWholesaleApplications, decideWholesaleApplication, listStandingOrders, getCustomer } from "@/lib/store";
import { displayWhatsapp } from "@/lib/auth";
import { enqueueNotification } from "@/lib/notifications";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** GET: pending applications and every live standing order. */
export async function GET() {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const applications = (await listWholesaleApplications("pending")).map((a) => ({
    ...a,
    whatsapp: displayWhatsapp(a.whatsapp),
  }));
  const standing = await listStandingOrders(null, "wholesale");
  const standingOrders = [];
  for (const s of standing) {
    const c = await getCustomer(s.customerId);
    standingOrders.push({
      ...s,
      weekdayName: WEEKDAYS[s.weekday],
      // Staff read tickets by business, not by customer id.
      businessName: c?.businessName || c?.name || s.customerId,
    });
  }
  return Response.json({ applications, standingOrders });
}

/** PATCH: approve or reject. { customerId, approve } */
export async function PATCH(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const { customerId, approve } = body ?? {};
  if (!customerId) return Response.json({ error: "missing_fields" }, { status: 400 });

  const res = await decideWholesaleApplication(customerId, !!approve);
  if (res.error) {
    return Response.json(res, { status: res.error === "not_found" ? 404 : 409 });
  }

  // The decision has been made either way; telling the applicant is queued
  // work, not part of making it.
  enqueueNotification({
    to: res.customer.whatsapp,
    template: approve ? "wholesale_approved" : "wholesale_rejected",
    payload: { businessName: res.customer.application.businessName },
  });

  return Response.json({ ok: true, type: res.customer.type });
}
