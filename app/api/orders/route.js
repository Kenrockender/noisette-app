import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createOrder } from "@/lib/store";
import { createInvoice } from "@/lib/payments";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders
 * body: { items:[{productId,qty}], pickupDate, slotIndex, name, whatsapp, paymentMethod, giftWrap, giftContents }
 * Returns 201 { order } with a 15-minute stock and slot hold, or 409 with a typed error.
 * In production this is also where the Xendit/Midtrans invoice is created.
 */
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  // customerId comes from the session cookie and nowhere else. If it were read
  // off the body, anyone could post someone else's id and staple their order to
  // a stranger's account. Guests get null, which is a supported path.
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);

  const result = await createOrder({
    items: body?.items,
    pickupDate: body?.pickupDate,
    slotIndex: body?.slotIndex,
    name: body?.name,
    whatsapp: body?.whatsapp,
    paymentMethod: body?.paymentMethod,
    giftWrap: body?.giftWrap,
    giftContents: body?.giftContents,
    customerId: session?.customerId ?? null,
  });

  if (result.error) {
    const status = ["insufficient_stock", "slot_full", "hold_expired"].includes(result.error) ? 409 : 400;
    return NextResponse.json(result, { status });
  }

  // The provider invoice is created with the order, exactly as it will be with
  // Xendit/Midtrans. Its window is the stock hold's window; one clock, not two.
  const invoice = await createInvoice(result.order);

  return NextResponse.json(
    { order: result.order, invoice: { id: invoice.id, amount: invoice.amount, expiresAt: invoice.expiresAt } },
    { status: 201 }
  );
}
