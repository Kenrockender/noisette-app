import { listCommissions, getCommission, quoteCommission, advanceCommission, declineCommission, commissionWeeks, setWeekCapacity } from "@/lib/commissions";
import { simulateCommissionDeposit } from "@/lib/payments";
import { enqueueNotification } from "@/lib/notifications";
import { displayWhatsapp } from "@/lib/auth";
import { rp } from "@/lib/format";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** GET: the whole pipeline plus the next weeks' capacity. */
export async function GET() {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  return Response.json({
    commissions: listCommissions().map((c) => ({ ...c, whatsapp: displayWhatsapp(c.whatsapp) })),
    weeks: commissionWeeks(),
  });
}

/**
 * PATCH, one verb per body shape:
 *   { id, quote, deposit? }   enquiry -> quoted (and tells the customer)
 *   { id, advance: true }     one stage forward; deposit step books the week
 *   { id, decline: true }     enquiry/quoted only
 *   { week, maxCakes }        capacity for one week, floored at booked
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

  if (body?.week) {
    const res = setWeekCapacity(body.week, body.maxCakes);
    return res.error ? Response.json(res, { status: 409 }) : Response.json(res);
  }

  if (!body?.id) return Response.json({ error: "missing_fields" }, { status: 400 });

  let res;
  if (body.quote !== undefined) {
    res = quoteCommission(body.id, body.quote, body.deposit);
    if (!res.error) {
      enqueueNotification({
        to: res.commission.whatsapp,
        template: "commission_quoted",
        payload: {
          commissionId: res.commission.id,
          quote: rp(res.commission.quoteIdr),
          deposit: res.commission.depositIdr ? rp(res.commission.depositIdr) : null,
        },
      });
    }
  } else if (body.decline) {
    res = declineCommission(body.id);
  } else if (getCommission(body.id)?.status === "quoted") {
    // "Deposit received" for a quoted commission goes through the same signed
    // webhook door a customer's own "pay deposit" tap uses, so a staff-confirmed
    // deposit and a self-serve one leave the identical invoice trail. It also
    // enqueues commission_deposit_paid itself; the route must not repeat that.
    res = await simulateCommissionDeposit(body.id);
  } else {
    res = advanceCommission(body.id);
    // The one other moment worth telling the customer about, unrelated to money.
    if (!res.error && res.commission.status === "ready") {
      enqueueNotification({
        to: res.commission.whatsapp,
        template: "commission_ready",
        payload: { commissionId: res.commission.id },
      });
    }
  }

  if (res.error) {
    return Response.json(res, { status: res.error === "not_found" ? 404 : 409 });
  }
  return Response.json(res);
}
