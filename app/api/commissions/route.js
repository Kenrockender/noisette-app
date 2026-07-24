import { currentCustomer } from "@/lib/session";
import { submitCommission, commissionsFor } from "@/lib/commissions";
import { enqueueNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** GET ?mine=1: this number's commissions, session required. */
export async function GET(request) {
  const url = new URL(request.url);
  if (!url.searchParams.get("mine"))
    return Response.json({ error: "missing_params" }, { status: 400 });

  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });
  return Response.json({ commissions: await commissionsFor(c.whatsapp) });
}

/**
 * POST { name, whatsapp, neededOn, servings, brief }
 *
 * Open to guests, like checkout: a wedding cake enquiry must not require an
 * account. If someone IS signed in, the commission is attached to them.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const customer = await currentCustomer();
  const res = await submitCommission({
    customerId: customer?.id ?? null,
    name: body?.name,
    whatsapp: body?.whatsapp,
    neededOn: body?.neededOn,
    servings: body?.servings,
    brief: body?.brief,
  });

  if (res.error) {
    return Response.json(res, { status: res.error === "too_soon" ? 409 : 400 });
  }

  enqueueNotification({
    to: res.commission.whatsapp,
    template: "commission_received",
    payload: { commissionId: res.commission.id, neededOn: res.commission.neededOn },
  });

  return Response.json({ commission: res.commission }, { status: 201 });
}
