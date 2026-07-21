import { currentCustomer } from "@/lib/session";
import { getProducts, updateWholesaleProfile } from "@/lib/store";
import { displayWhatsapp } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/wholesale/me
 *
 * Everything the portal needs to decide which of its three states to show:
 * signed out, retail (apply), or approved wholesale.
 *
 * The price list is only attached for approved accounts. Wholesale pricing is
 * commercially sensitive and should not be readable by anyone who happens to
 * find the URL.
 */
export async function GET() {
  const c = await currentCustomer();
  if (!c) return Response.json({ state: "anonymous" });

  const base = {
    customer: {
      id: c.id,
      name: c.name,
      whatsapp: displayWhatsapp(c.whatsapp),
      type: c.type,
      businessName: c.businessName || null,
      address: c.address || null,
      npwp: c.npwp || null,
    },
  };

  if (c.type !== "wholesale") {
    return Response.json({
      ...base,
      state: "retail",
      application: c.application ?? null,
    });
  }

  const priceList = getProducts()
    .filter((p) => p.wholesalePrice != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      house: p.house,
      category: p.category,
      retailPrice: p.price,
      wholesalePrice: p.wholesalePrice,
      moq: p.wholesaleMoq,
    }));

  return Response.json({ ...base, state: "wholesale", priceList });
}

/**
 * PATCH /api/wholesale/me  { businessName?, address?, npwp? }
 *
 * The address was locked at application; this is the edit path a cafe needs
 * when it moves. Only approved wholesale accounts can call it, and only the
 * fields passed are touched.
 */
export async function PATCH(request) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });
  if (c.type !== "wholesale") return Response.json({ error: "not_wholesale" }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const res = await updateWholesaleProfile(c.id, {
    businessName: body?.businessName,
    address: body?.address,
    npwp: body?.npwp,
  });

  if (res.error) {
    return Response.json(res, { status: res.error === "not_found" ? 404 : 400 });
  }
  return Response.json(res);
}
