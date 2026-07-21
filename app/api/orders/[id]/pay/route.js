import { NextResponse } from "next/server";
import { simulateProviderPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/pay — the demo "tap the QR" button.
 *
 * This no longer marks anything paid itself. It plays the role of the payment
 * provider: build the callback payload, sign it, and push it through the same
 * verified door as /api/payments/webhook. In production this route is deleted
 * and the provider POSTs the real thing.
 */
export async function POST(_req, { params }) {
  const result = await simulateProviderPayment((await params).id);
  if (result.error) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ order: result.order });
}
