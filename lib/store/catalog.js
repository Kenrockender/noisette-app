/**
 * The static catalog and the pure helpers both store adapters share.
 *
 * Nothing here touches state: the product list is code-defined (the Postgres
 * `products` table is a seeded mirror of it, read the same way), and the date
 * maths is a function of the clock, not the database. Keeping it in one place
 * means the in-memory adapter and the Postgres adapter cannot drift on what a
 * croissant costs or which dates a template lands on.
 */

export const HOLD_TTL_MS = 15 * 60 * 1000; // pastries held while payment code is live
export const GIFT_WRAP_PRICE = 15000;

/**
 * The two houses. Noisette is one brand trading as two kitchens. La Boulangerie
 * bakes bread and viennoiserie to a daily allocation; La Patisserie makes cakes,
 * entremets and chocolates and also takes bespoke commissions.
 */
export const HOUSES = {
  boulangerie: {
    id: "boulangerie",
    name: "La Boulangerie",
    blurb: "Bread and viennoiserie, laminated and baked each morning.",
  },
  patisserie: {
    id: "patisserie",
    name: "La Patisserie",
    blurb: "Cakes, entremets and chocolates. Bespoke commissions by request.",
  },
};

export const products = [
  { id: "pistachio", name: "Pistachio Croissant", house: "boulangerie", category: "Viennoiserie", price: 38000, wholesalePrice: 26000, wholesaleMoq: 20,
    description: "Twenty-seven layers of laminated dough around a Bronte pistachio crème. The crust is rolled in toasted nibs.",
    allergens: "gluten, dairy, nuts", pairsWith: "piscok" },
  { id: "piscok", name: "Piscok Croissant", house: "boulangerie", category: "Viennoiserie", price: 32000, wholesalePrice: 21000, wholesaleMoq: 20,
    description: "Dark chocolate and banana folded into laminated dough. The one Malang actually asks for by name.",
    allergens: "gluten, dairy", pairsWith: "eggtart" },
  { id: "almond", name: "Almond Croissant", house: "boulangerie", category: "Viennoiserie", price: 30000, wholesalePrice: 20000, wholesaleMoq: 20,
    description: "Baked twice, with a frangipane centre and a heavy scatter of toasted Sicilian almonds on top.",
    allergens: "gluten, dairy, nuts", pairsWith: "pistachio" },
  { id: "dubai", name: "Dubai Chocolate Bar", house: "patisserie", category: "Signature Chocolates", price: 85000,
    description: "Kunafa and pistachio tahini crème inside a 54% dark couverture shell. We make forty a day and then stop.",
    allergens: "gluten, dairy, nuts, sesame", pairsWith: "pistachio" },
  { id: "bonbon", name: "Choc-Orange Bonbons x6", house: "patisserie", category: "Signature Chocolates", price: 72000,
    description: "Valencia orange ganache in hand-painted shells, finished with smoked sea salt.",
    allergens: "dairy, may contain nuts", pairsWith: "dubai" },
  { id: "eggtart", name: "Egg Tart Brûlée", house: "patisserie", category: "Entremets", price: 28000, wholesalePrice: 18000, wholesaleMoq: 24,
    description: "Custard in a thin pastry shell. We torch the top when you collect it, so it is still glassy when you bite it.",
    allergens: "gluten, dairy, egg", pairsWith: "piscok" },
  { id: "hazelnut", name: "Hazelnut Praline Entremet", house: "patisserie", category: "Entremets", price: 65000,
    description: "Six layers of gianduja mousse over feuilletine and hazelnut dacquoise. Noisette means hazelnut, so this one had to be right.",
    allergens: "gluten, dairy, egg, nuts", pairsWith: "bonbon" },
  { id: "mango", name: "Mango Sticky Tart", house: "patisserie", category: "Seasonal", price: 42000,
    description: "Harum manis mango on pandan coconut rice pudding, in a lime leaf sablé. Only while the season lasts.",
    allergens: "gluten, dairy", pairsWith: "eggtart" },
  { id: "giftbox6", name: "Signature Box of 6", house: "patisserie", category: "Gift Boxes", price: 210000,
    description: "Six of our signatures in a linen-covered box, tied with caramel ribbon. Pick the six at the counter.",
    allergens: "assorted, full card enclosed", pairsWith: "bonbon" },
];

/* Lookups by id go through a Map instead of a linear scan on every order line. */
export const productById = new Map(products.map((p) => [p.id, p]));

export const SLOT_TIMES = ["08:00-10:00", "10:00-12:00", "12:00-14:00", "14:00-16:00", "16:00-18:00"];

/**
 * A day's production, split at the source. Two separate pools: a cafe ordering
 * 200 croissants must not eat the 12 that walk-in scarcity is built on, and a
 * contracted standing order must not be eaten by walk-ins either.
 */
export const DEFAULT_RETAIL = {
  pistachio: 4, piscok: 12, almond: 9, dubai: 7, bonbon: 15,
  eggtart: 20, hazelnut: 6, mango: 0, giftbox6: 5,
};
export const DEFAULT_WHOLESALE = {
  pistachio: 60, piscok: 240, almond: 90, eggtart: 120,
};
export const DEFAULT_SLOT_CAPACITY = 8;

/** How far ahead B2B may commit. Cafes plan further out than walk-ins. */
export const WHOLESALE_HORIZON_DAYS = 28;
/** The walk-in date rail is five days; the counter's rail spans the wholesale horizon. */
export const RETAIL_HORIZON_DAYS = 5;
export const ADMIN_HORIZON_DAYS = WHOLESALE_HORIZON_DAYS;

/**
 * Kitchen lifecycle after money changes hands.
 *   awaiting_payment -> paid -> preparing -> ready -> collected  (\-> expired)
 */
export const FULFILLMENT_FLOW = { paid: "preparing", preparing: "ready", ready: "collected" };
export const FULFILLMENT_STAGES = ["paid", "preparing", "ready", "collected"];

export const isoDay = (d) => d.toISOString().slice(0, 10);

/** 0 = Sunday, matching Date.getUTCDay. */
export const weekdayOf = (date) => new Date(date + "T00:00:00Z").getUTCDay();

export function nextOpenDates(n = RETAIL_HORIZON_DAYS) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() + 1); // pre-order starts tomorrow
  while (out.length < n) {
    out.push(isoDay(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Dates inside the horizon that a standing-order template lands on. Pure: a
 * function of the template and the clock, identical for both backends.
 */
export function occurrencesOf(so, horizonDays = WHOLESALE_HORIZON_DAYS) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < horizonDays; i++) {
    const iso = isoDay(d);
    if (
      weekdayOf(iso) === so.weekday &&
      iso >= so.startsOn &&
      (!so.endsOn || iso <= so.endsOn) &&
      !(so.pausedUntil && iso <= so.pausedUntil)
    ) out.push(iso);
    d.setDate(d.getDate() + 1);
  }
  return out;
}
