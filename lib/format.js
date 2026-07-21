export const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
export const k = (n) => n / 1000 + "k";

const at = (iso) => new Date(iso + "T00:00:00");

/** "Sabtu 18 Jul" */
export const dayLabel = (iso) =>
  at(iso)
    .toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" })
    .replace(",", "");

/** "SAB", for the date rail in the app. */
export const dayShort = (iso) =>
  at(iso).toLocaleDateString("id-ID", { weekday: "short" }).toUpperCase();

const STORE_ADDRESS = "Jl. Bondowoso No.8, Malang";

/** Pickup slots are WIB (UTC+7); parse "HH:MM-HH:MM" against the pickup date. */
function slotBounds(pickupDate, slotTime) {
  const [startHM, endHM] = slotTime.split("-");
  return {
    start: new Date(`${pickupDate}T${startHM}:00+07:00`),
    end: new Date(`${pickupDate}T${endHM}:00+07:00`),
  };
}

const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

/** An .ics file for the pickup window, for calendar apps that open files directly. */
export function pickupIcs(order) {
  const { start, end } = slotBounds(order.pickupDate, order.slotTime);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Noisette Patissier//Pickup//EN",
    "BEGIN:VEVENT",
    `UID:${order.id}@noisette-patissier`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    "SUMMARY:Pickup at Noisette Patissier",
    `DESCRIPTION:Order ${order.id}\\, show your pickup code at the counter.`,
    `LOCATION:${STORE_ADDRESS}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** A Google Calendar template link, as a fallback for anyone who can't open an .ics. */
export function googleCalendarUrl(order) {
  const { start, end } = slotBounds(order.pickupDate, order.slotTime);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Pickup at Noisette Patissier",
    dates: `${icsStamp(start)}/${icsStamp(end)}`,
    details: `Order ${order.id}, show your pickup code at the counter.`,
    location: STORE_ADDRESS,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
