/**
 * The Noisette cafe menu: pastry, slice cake, minuman and the chewy cookie.
 *
 * This is the CAFE channel, which the shop runs separately from whole cakes and
 * hampers. The two are different ordering doors, on different WhatsApp numbers:
 *
 *   Kue & hampers  -> +62 812 5057 1356  (see site-cakes.js / bespoke)
 *   Cafe & chewy   -> +62 895 4228 31717 (this file)
 *
 * Kept out of lib/store/catalog.js on purpose, for the same reason whole cakes
 * are: that catalog runs a per-day allocation model for a fictional demo line.
 * A cafe latte or a walk-in pastry has no daily stock counter to decrement here.
 *
 * PRICES ARE TENTATIVE. Sourced from the shop's GoFood listing on 2026-07-23,
 * where prices are often marked up above the counter price. They are staged here
 * so ci Ariel's confirmed pricing is a one-file edit, not a re-transcription.
 * Until then, surface them as "Tanya harga" rather than as fact. Flip
 * PRICES_CONFIRMED to true once the real counter prices land.
 *
 * Prices are IDR.
 */

export const CAFE_WHATSAPP = "62895422831717";
export const PRICES_CONFIRMED = false;

/** Pastry, baked for the counter and GoFood. */
export const PASTRIES = [
  { id: "french-butter", name: "French Butter", price: 28500 },
  { id: "crookie", name: "Crookie", price: 45500, note: "Croissant dan cookies." },
  { id: "almond-croissant", name: "Almond Croissant", price: 43000 },
  { id: "chocolat", name: "Chocolat", price: 32500 },
  { id: "piscok", name: "Piscok", price: 34000, note: "Pisang, coklat dan keju." },
  { id: "garlic-cheese-salt-bread", name: "Garlic Cheese Salt Bread", price: 19500,
    note: "Salt bread dengan isian keju dan signature sauce." },
  { id: "nutella-strawberry-danish", name: "Nutella Strawberry Danish", price: 32500 },
  { id: "dubai-chocolate", name: "Dubai Chocolate", price: 49500 },
  { id: "carbonara-danish", name: "Carbonara Danish", price: 36500,
    note: "Isi smoked beef dan jamur kancing dengan rasa saus carbonara." },
  { id: "salt-bread-original", name: "Salt Bread Original", price: 15500 },
  { id: "sausage-danish", name: "Sausage Danish", price: 35000,
    note: "Danish pastry dengan keju, sausage, bolognese." },
  { id: "beef-and-cheese", name: "Beef and Cheese", price: 41500 },
  { id: "smoked-beef-quiche", name: "Smoked Beef Quiche", price: 30000 },
  { id: "original-egg-tart", name: "Original Egg Tart", price: 23500 },
  { id: "chocolate-babka", name: "Chocolate Babka", price: 45500,
    note: "Twisted chocolate spread croissant." },
];

/**
 * Slice cakes for the counter. Several are single slices of the whole cakes in
 * site-cakes.js (Strawberry Shortcake, Basque Cheesecake, Blackforest, Banoffee,
 * Tiramisu). A slice belongs to the cafe channel; the whole cake to the kue one.
 */
export const SLICE_CAKES = [
  { id: "strawberry-shortcake-slice", name: "Strawberry Shortcake", price: 41500 },
  { id: "chocolate-strawberry-slice", name: "Chocolate Strawberry", price: 44000 },
  { id: "basque-cheesecake-slice", name: "Basque Cheesecake", price: 44000 },
  { id: "red-velvet-slice", name: "Red Velvet", price: 52000 },
  { id: "blackforest-slice", name: "Blackforest", price: 40600 },
  { id: "banoffee-slice", name: "Banoffee", price: 39000 },
  { id: "seasalt-choco-basque-slice", name: "Seasalt Choco Basque Cheesecake", price: 48000 },
  { id: "pistachio-slice", name: "Pistachio", price: 48000 },
  { id: "chocolate-mint-slice", name: "Chocolate Mint", price: 41500 },
  { id: "tiramisu-slice", name: "Tiramisu", price: 52000 },
  { id: "tiramisu-cup", name: "Tiramisu Cup", price: 36500 },
];

export const DRINKS_COLD = [
  { id: "ice-noi-signature", name: "Ice Noi Signature", price: 38000, note: "Americano dan orange." },
  { id: "ice-strawberry-matcha-latte", name: "Ice Strawberry Matcha Latte", price: 35000 },
  { id: "ice-latte", name: "Ice Latte", price: 36500 },
  { id: "ice-dirty-matcha", name: "Ice Dirty Matcha", price: 35000, note: "Matcha dengan one shot espresso." },
  { id: "ice-americano-arabica", name: "Ice Americano Arabica", price: 32500 },
  { id: "ice-cappucino", name: "Ice Cappucino", price: 38000 },
  { id: "ice-chocolate", name: "Ice Chocolate", price: 35000 },
  { id: "ice-chocolate-orange", name: "Ice Chocolate Orange", price: 35000 },
  { id: "ice-matcha-latte", name: "Ice Matcha Latte", price: 35000 },
  { id: "watermelon-yakult", name: "Watermelon Yakult", price: 30000 },
  { id: "seasalt-caramel-latte", name: "Seasalt Caramel Latte", price: 35000 },
  { id: "berry-americano", name: "Berry Americano", price: 32500 },
  { id: "bananapresso", name: "Bananapresso", price: 32500, note: "Perpaduan susu pisang yang creamy dan espresso." },
];

export const DRINKS_HOT = [
  { id: "hot-americano-arabica", name: "Hot Americano Arabica", price: 29500 },
  { id: "hot-latte", name: "Hot Latte", price: 32500 },
  { id: "hot-cappucino", name: "Hot Cappucino", price: 35000 },
  { id: "hot-chocolate", name: "Hot Chocolate", price: 32500 },
  { id: "hot-matcha-latte", name: "Hot Matcha Latte", price: 32500 },
  { id: "espresso", name: "Espresso", price: 19500, note: "Saripati kopi, hanya 30 ml." },
];

/**
 * Ube Series. Ube Cheesecake and Ubemisu also appear as SEASONAL_ITEMS in
 * site-cakes.js on the website; here they carry the cafe's GoFood price.
 */
export const UBE_SERIES = [
  { id: "ube-ceremonial-matcha", name: "Ube Ceremonial Matcha", price: 45500 },
  { id: "ube-cloud", name: "Ube Cloud", price: 36500 },
  { id: "matcha-cloud", name: "Matcha Cloud", price: 36500 },
  { id: "ube-cheesecake", name: "Ube Cheesecake", price: 45500 },
  { id: "ubemisu", name: "Ubemisu", price: 49500 },
];

/**
 * The chewy cookie shares the cafe channel's WhatsApp ("cafe dan chewy cookie").
 * The shop's Dubai chewy is on Instagram but has never carried a posted price,
 * so it stays null here rather than borrow a guess.
 */
export const CHEWY_COOKIES = [
  { id: "dubai-chewy-berry", name: "Dubai Chewy Berry", price: null,
    note: "Versi Noisette dari Dubai chewy berry yang viral." },
];

/** Grouped for a future cafe menu page; the labels are the on-page headings. */
export const CAFE_SECTIONS = [
  { id: "pastries", label: "Pastry", items: PASTRIES },
  { id: "slice-cakes", label: "Slice Cake", items: SLICE_CAKES },
  { id: "drinks-cold", label: "Minuman Dingin", items: DRINKS_COLD },
  { id: "drinks-hot", label: "Minuman Panas", items: DRINKS_HOT },
  { id: "ube-series", label: "Ube Series", items: UBE_SERIES },
  { id: "chewy-cookies", label: "Chewy Cookie", items: CHEWY_COOKIES },
];
