import { listHampers, setHamperPaid, updateHamper, deleteHamper } from "@/lib/hampers";
import { displayWhatsapp } from "@/lib/auth";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** GET: every hampers request, newest first — the recap ci Ariel works from. */
export async function GET() {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const orders = await listHampers();
  return Response.json({
    orders: orders.map((o) => ({ ...o, whatsapp: displayWhatsapp(o.whatsapp) })),
  });
}

/**
 * PATCH, one verb per body shape:
 *   { id, paid }   flip the one status flag this flow has
 *   { id, edit }   correct any of the request's own fields
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
  if (!body?.id) return Response.json({ error: "missing_fields" }, { status: 400 });

  const res = body.edit ? await updateHamper(body.id, body.edit) : await setHamperPaid(body.id, body.paid);
  if (res.error) return Response.json(res, { status: res.error === "not_found" ? 404 : 409 });
  return Response.json(res);
}

/** DELETE ?id=H-0001: clears a mistaken or duplicate request. Staff call, not automatic. */
export async function DELETE(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_fields" }, { status: 400 });

  const res = await deleteHamper(id);
  if (res.error) return Response.json(res, { status: 404 });
  return Response.json(res);
}
