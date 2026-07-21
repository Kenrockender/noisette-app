import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "./auth.js";
import { getCustomer } from "./store.js";

/**
 * The signed-in customer, or null.
 *
 * One place, so no route invents its own idea of who is calling. Every wholesale
 * route needs both "are you signed in" and "are you actually wholesale", and
 * those two questions must never be answered from the request body.
 */
export async function currentCustomer() {
  const jar = await cookies(); // async since Next 15
  const s = await readSession(jar.get(SESSION_COOKIE)?.value);
  return s ? await getCustomer(s.customerId) : null;
}

/** 401 if not signed in, 403 if signed in but not approved for wholesale. */
export async function requireWholesale() {
  const c = await currentCustomer();
  if (!c) return { res: Response.json({ error: "not_signed_in" }, { status: 401 }) };
  if (c.type !== "wholesale")
    return { res: Response.json({ error: "not_wholesale" }, { status: 403 }) };
  return { customer: c };
}
