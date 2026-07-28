import { query } from "../db/pg.js";
import { normalizeWhatsapp } from "../auth.js";

const formatId = (id) => "H-" + String(id).padStart(4, "0");
const parseId = (id) => parseInt(String(id).replace("H-", ""), 10);
const toMs = (v) => (v == null ? null : new Date(v).getTime());
const isoDay = (d) => {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};

const MAX_RECIPIENTS = 20;
const MAX_ADDRESS = 300;
const MAX_CARD = 200;

/** See lib/hampers/memory.js for why this is a list, not a single address. */
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

const mapRow = (r) => {
  if (!r) return null;
  return {
    id: formatId(r.id),
    customerId: r.customer_id != null ? String(r.customer_id) : null,
    name: r.name || "",
    whatsapp: r.whatsapp,
    contents: r.contents,
    qty: r.qty,
    neededOn: isoDay(r.needed_on),
    notes: r.notes,
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
    paid: r.paid,
    paidAt: toMs(r.paid_at),
    createdAt: toMs(r.created_at),
  };
};

export async function submitHamper({ customerId, name, whatsapp, contents, qty, neededOn, notes, recipients }) {
  const wa = normalizeWhatsapp(whatsapp);
  if (!wa) return { error: "invalid_number" };
  if (!name?.trim()) return { error: "missing_fields" };
  if (!contents?.trim()) return { error: "missing_fields" };
  if (!neededOn || !/^\d{4}-\d{2}-\d{2}$/.test(neededOn)) return { error: "invalid_date" };
  if (neededOn < isoDay(new Date())) return { error: "invalid_date" };

  const q = Math.floor(Number(qty));
  const validQty = Number.isFinite(q) && q > 0 ? q : 1;
  const validNotes = notes?.trim() ? notes.trim().slice(0, 1000) : null;
  const validRecipients = sanitizeRecipients(recipients);

  const res = await query(
    `
    INSERT INTO hampers_orders (customer_id, whatsapp, name, contents, qty, needed_on, notes, recipients)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `,
    [
      customerId || null,
      wa,
      name.trim(),
      contents.trim().slice(0, 2000),
      validQty,
      neededOn,
      validNotes,
      JSON.stringify(validRecipients),
    ]
  );

  return { order: mapRow(res.rows[0]) };
}

export async function getHamper(id) {
  const res = await query("SELECT * FROM hampers_orders WHERE id = $1", [parseId(id)]);
  return res.rows.length > 0 ? mapRow(res.rows[0]) : null;
}

export async function listHampers() {
  const res = await query("SELECT * FROM hampers_orders ORDER BY created_at DESC");
  return res.rows.map(mapRow);
}

export async function setHamperPaid(id, paid) {
  const dbId = parseId(id);
  const res = await query(
    `
    UPDATE hampers_orders
    SET paid = $1, paid_at = CASE WHEN $1 THEN now() ELSE NULL END
    WHERE id = $2
    RETURNING *
  `,
    [Boolean(paid), dbId]
  );
  if (res.rows.length === 0) return { error: "not_found" };
  return { order: mapRow(res.rows[0]) };
}

/** Correct any field after the fact; see lib/hampers/memory.js for why. */
export async function updateHamper(id, patch) {
  const dbId = parseId(id);
  const sets = [];
  const vals = [];
  let i = 1;

  if (patch.name !== undefined) {
    if (!patch.name?.trim()) return { error: "missing_fields" };
    sets.push(`name = $${i++}`);
    vals.push(patch.name.trim());
  }
  if (patch.whatsapp !== undefined) {
    const wa = normalizeWhatsapp(patch.whatsapp);
    if (!wa) return { error: "invalid_number" };
    sets.push(`whatsapp = $${i++}`);
    vals.push(wa);
  }
  if (patch.contents !== undefined) {
    if (!patch.contents?.trim()) return { error: "missing_fields" };
    sets.push(`contents = $${i++}`);
    vals.push(patch.contents.trim().slice(0, 2000));
  }
  if (patch.qty !== undefined) {
    const q = Math.floor(Number(patch.qty));
    if (!Number.isFinite(q) || q <= 0) return { error: "invalid_qty" };
    sets.push(`qty = $${i++}`);
    vals.push(q);
  }
  if (patch.neededOn !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.neededOn)) return { error: "invalid_date" };
    sets.push(`needed_on = $${i++}`);
    vals.push(patch.neededOn);
  }
  if (patch.notes !== undefined) {
    const n = patch.notes?.trim() ? patch.notes.trim().slice(0, 1000) : null;
    sets.push(`notes = $${i++}`);
    vals.push(n);
  }
  if (patch.recipients !== undefined) {
    sets.push(`recipients = $${i++}`);
    vals.push(JSON.stringify(sanitizeRecipients(patch.recipients)));
  }

  if (sets.length === 0) return { error: "missing_fields" };

  vals.push(dbId);
  const res = await query(`UPDATE hampers_orders SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
  if (res.rows.length === 0) return { error: "not_found" };
  return { order: mapRow(res.rows[0]) };
}

/** Removes a mistaken or duplicate request; see lib/hampers/memory.js for why
 * this is a manual call rather than automatic dedup at submission time. */
export async function deleteHamper(id) {
  const res = await query("DELETE FROM hampers_orders WHERE id = $1", [parseId(id)]);
  if (res.rowCount === 0) return { error: "not_found" };
  return { ok: true };
}
