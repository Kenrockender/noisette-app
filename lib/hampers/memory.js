import { normalizeWhatsapp } from "../auth.js";

/**
 * Hampers custom orders.
 *
 * Requested by ci Ariel as its own flow, deliberately NOT bespoke's
 * enquiry -> quote -> deposit pipeline: a hampers order has no quote stage
 * and no weekly capacity, because ci Ariel recaps every request by hand and
 * only opens WhatsApp herself once, to chase payment. `paid` is the one flag
 * that needs, flipped from the counter once money lands.
 *
 * Mirrors `hampers_orders` in db/schema.sql.
 */

const MAX_CONTENTS = 2000;
const MAX_NOTES = 1000;
const MAX_RECIPIENTS = 20;
const MAX_ADDRESS = 300;
const MAX_CARD = 200;

const g = globalThis;
const db = (g.__noisette ??= {});
db.hampers ??= new Map(); // hamperId -> order
db.hamperSeq ??= 0;

const isoDay = (d) => d.toISOString().slice(0, 10);

/** One row per hamper being sent out: where it goes and what the card says.
 * A single request is often several hampers to several addresses (e.g. 5
 * hampers for 5 recipients), each with its own from/to — so this is a list,
 * not a single address field. Blank rows are dropped rather than kept as
 * placeholders. */
function sanitizeRecipients(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_RECIPIENTS)
    .map((r) => ({
      address: (r?.address || "").trim().slice(0, MAX_ADDRESS),
      cardFrom: (r?.cardFrom || "").trim().slice(0, MAX_CARD),
      cardTo: (r?.cardTo || "").trim().slice(0, MAX_CARD),
    }))
    .filter((r) => r.address || r.cardFrom || r.cardTo);
}

/** Anyone may request; guests included, same as bespoke. */
export function submitHamper({ customerId, name, whatsapp, contents, qty, neededOn, notes, recipients }) {
  const wa = normalizeWhatsapp(whatsapp);
  if (!wa) return { error: "invalid_number" };
  if (!name?.trim()) return { error: "missing_fields" };
  if (!contents?.trim()) return { error: "missing_fields" };
  if (!neededOn || !/^\d{4}-\d{2}-\d{2}$/.test(neededOn)) return { error: "invalid_date" };
  if (neededOn < isoDay(new Date())) return { error: "invalid_date" };

  const q = Math.floor(Number(qty));

  const order = {
    id: "H-" + String(++db.hamperSeq).padStart(4, "0"),
    customerId: customerId || null,
    name: name.trim(),
    whatsapp: wa,
    contents: contents.trim().slice(0, MAX_CONTENTS),
    qty: Number.isFinite(q) && q > 0 ? q : 1,
    neededOn,
    notes: notes?.trim() ? notes.trim().slice(0, MAX_NOTES) : null,
    recipients: sanitizeRecipients(recipients),
    paid: false,
    paidAt: null,
    sent: false,
    sentAt: null,
    createdAt: Date.now(),
  };
  db.hampers.set(order.id, order);
  return { order };
}

export function getHamper(id) {
  return db.hampers.get(id) || null;
}

/** Newest first, for the recap ci Ariel works from. */
export function listHampers() {
  return [...db.hampers.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** This number's own requests, newest first — same lookup key as
 * commissionsFor: by whatsapp, not customerId, so a request sent as a guest
 * is still there once that number signs in later. */
export function hampersFor(whatsapp) {
  const wa = normalizeWhatsapp(whatsapp);
  return [...db.hampers.values()]
    .filter((o) => o.whatsapp === wa)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Whether the money has landed, flipped from the counter. */
export function setHamperPaid(id, paid) {
  const o = db.hampers.get(id);
  if (!o) return { error: "not_found" };
  o.paid = Boolean(paid);
  o.paidAt = o.paid ? Date.now() : null;
  return { order: o };
}

/** Whether the hamper has actually gone out — independent of payment. */
export function setHamperSent(id, sent) {
  const o = db.hampers.get(id);
  if (!o) return { error: "not_found" };
  o.sent = Boolean(sent);
  o.sentAt = o.sent ? Date.now() : null;
  return { order: o };
}

/**
 * Correct any field after the fact. Ci Ariel reads the request on WhatsApp
 * before she does anything with it, so the form's answer is a first draft,
 * not a locked-in order: contents, qty, date, recipients and contact details
 * all routinely change once she actually talks to the customer.
 */
export function updateHamper(id, patch) {
  const o = db.hampers.get(id);
  if (!o) return { error: "not_found" };

  if (patch.name !== undefined) {
    if (!patch.name?.trim()) return { error: "missing_fields" };
  }
  if (patch.whatsapp !== undefined && !normalizeWhatsapp(patch.whatsapp)) {
    return { error: "invalid_number" };
  }
  if (patch.contents !== undefined && !patch.contents?.trim()) {
    return { error: "missing_fields" };
  }
  let qty;
  if (patch.qty !== undefined) {
    qty = Math.floor(Number(patch.qty));
    if (!Number.isFinite(qty) || qty <= 0) return { error: "invalid_qty" };
  }
  if (patch.neededOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.neededOn)) {
    return { error: "invalid_date" };
  }

  if (patch.name !== undefined) o.name = patch.name.trim();
  if (patch.whatsapp !== undefined) o.whatsapp = normalizeWhatsapp(patch.whatsapp);
  if (patch.contents !== undefined) o.contents = patch.contents.trim().slice(0, MAX_CONTENTS);
  if (qty !== undefined) o.qty = qty;
  if (patch.neededOn !== undefined) o.neededOn = patch.neededOn;
  if (patch.notes !== undefined) o.notes = patch.notes?.trim() ? patch.notes.trim().slice(0, MAX_NOTES) : null;
  if (patch.recipients !== undefined) o.recipients = sanitizeRecipients(patch.recipients);

  return { order: o };
}

/** Removes a mistaken or duplicate request. Ci Ariel's call, not automatic:
 * this flow never blocks a resubmission, since two genuine requests can
 * legitimately share a name and a date. */
export function deleteHamper(id) {
  if (!db.hampers.delete(id)) return { error: "not_found" };
  return { ok: true };
}
