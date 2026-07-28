import { currentCustomer } from "@/lib/session";
import { submitHamper } from "@/lib/hampers";
import { enqueueNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * POST { name, whatsapp, contents, qty, neededOn, notes, recipients }
 *
 * `recipients` is an array of { address, cardFrom, cardTo }, one per hamper
 * being sent out — a request is often several hampers to several addresses.
 *
 * Open to guests, like the bespoke enquiry: a hampers request must not
 * require an account. Admin recaps the request and follows up on WhatsApp
 * for contents and payment, so this route only records it.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const customer = await currentCustomer();
  const res = await submitHamper({
    customerId: customer?.id ?? null,
    name: body?.name,
    whatsapp: body?.whatsapp,
    contents: body?.contents,
    qty: body?.qty,
    neededOn: body?.neededOn,
    notes: body?.notes,
    recipients: body?.recipients,
  });

  if (res.error) return Response.json(res, { status: 400 });

  enqueueNotification({
    to: res.order.whatsapp,
    template: "hampers_received",
    payload: { hamperId: res.order.id, neededOn: res.order.neededOn },
  });

  return Response.json({ order: res.order }, { status: 201 });
}
