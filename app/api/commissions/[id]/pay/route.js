import { currentCustomer } from "@/lib/session";
import { getCommission } from "@/lib/commissions";
import { simulateCommissionDeposit } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/commissions/:id/pay — the customer's own "pay deposit" tap.
 *
 * Plays the role of the payment provider exactly like /api/orders/:id/pay
 * does for retail: build the callback payload, sign it, and push it through
 * the same verified webhook door as a staff-confirmed deposit. A commission
 * has no QRIS hold to protect, so there is no session-free guest path here —
 * only the account that owns the commission may tap its own deposit.
 */
export async function POST(_req, { params }) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const commission = getCommission((await params).id);
  if (!commission) return Response.json({ error: "not_found" }, { status: 404 });
  if (commission.whatsapp !== c.whatsapp) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await simulateCommissionDeposit((await params).id);
  if (result.error) {
    const status = result.error === "not_found" ? 404 : 409;
    return Response.json(result, { status });
  }
  return Response.json({ commission: result.commission });
}
