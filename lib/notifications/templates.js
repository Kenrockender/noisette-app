/**
 * Notification message texts, shared by both backends (plan.md #5).
 *
 * Kept separate from the store so neither adapter has to duplicate copy. A
 * template that does not exist is a programming error and refuses loudly at
 * enqueue time, not at send time three retries later.
 */

export const MAX_ATTEMPTS = 5;

export const TEMPLATES = {
  order_paid: (p) =>
    `Noisette: order ${p.orderId} confirmed for ${p.pickupDate}, ${p.slotTime}. ` +
    `Show code ${p.orderId} at the counter, Jl. Bondowoso No.8.`,
  order_ready: (p) =>
    `Noisette: order ${p.orderId} is ready. See you at Jl. Bondowoso No.8.`,
  order_cancelled: (p) =>
    `Noisette: order ${p.orderId} is cancelled` +
    `${p.refunded ? " and your payment has been refunded" : ""}. ` +
    `Sorry to miss you — order again any time.`,
  wholesale_approved: (p) =>
    `Noisette: wholesale account approved for ${p.businessName}. ` +
    `Trade prices and standing orders are at /wholesale.`,
  wholesale_rejected: (p) =>
    `Noisette: we could not approve the wholesale application for ${p.businessName}. ` +
    `Reply here if you would like to talk it through.`,
  commission_received: (p) =>
    `Noisette: we received your bespoke enquiry ${p.commissionId} for ${p.neededOn}. ` +
    `The patissier reads every brief personally; expect a quote within two days.`,
  commission_quoted: (p) =>
    `Noisette: your bespoke commission ${p.commissionId} is quoted at ${p.quote}` +
    `${p.deposit ? `, deposit ${p.deposit} to book the week` : ""}. Reply here to confirm.`,
  commission_deposit_paid: (p) =>
    `Noisette: deposit received for bespoke commission ${p.commissionId}. ` +
    `Your week is booked and the patissier is on it. Collection ${p.neededOn}.`,
  commission_ready: (p) =>
    `Noisette: your bespoke cake ${p.commissionId} is ready. ` +
    `Collect it at Jl. Bondowoso No.8. See you soon.`,
  hampers_received: (p) =>
    `Noisette: we received your hampers request ${p.hamperId} for ${p.neededOn}. ` +
    `We read every request personally and reply here to confirm contents and payment.`,
  // Sent the day before, so a pickup does not quietly lapse into a no-show.
  pickup_reminder: (p) =>
    `Noisette: reminder — order ${p.orderId} is for pickup tomorrow ${p.pickupDate}, ` +
    `${p.slotTime}. Show code ${p.orderId} at Jl. Bondowoso No.8.`,
  subscription_reminder: (p) =>
    `Noisette: your standing box is ready for pickup tomorrow ${p.pickupDate}. ` +
    `See you at Jl. Bondowoso No.8.`,
  delivery_reminder: (p) =>
    `Noisette: your wholesale delivery lands tomorrow ${p.date}${p.items ? ` (${p.items})` : ""}. ` +
    `We will call on arrival.`,
};

/** The WhatsApp Business API call goes here. Fails closed until it exists. */
export async function deliverWhatsapp(whatsapp, text) {
  if (process.env.NODE_ENV === "production")
    return { delivered: false, reason: "whatsapp_not_configured" };
  console.log(`[wa -> ${whatsapp}] ${text} (dev only, not sent)`);
  return { delivered: true };
}
