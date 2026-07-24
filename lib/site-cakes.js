/**
 * The real Noisette whole cake menu, for the website ("/") only.
 *
 * Sourced from the shop's own pricelist PDF and @noisette.mlg on 2026-07-23.
 * Deliberately separate from lib/store/catalog.js: that catalog feeds /order,
 * /admin and /wholesale, which run on a per-day allocation model built for a
 * different (fictional demo) product line. A made-to-order whole cake has no
 * daily stock count to decrement, so it does not belong in that system. If
 * Noisette ever wants real ordering for these cakes, that is a deliberate
 * follow-up design decision, not a data migration.
 *
 * Prices are IDR. Two sizes where the shop sells both; one where it does not.
 */
import tiramisu from "@/public/photos/cakes/tiramisu.jpg";
import lemonEarlGrey from "@/public/photos/cakes/lemon-earl-grey.jpg";
import esCendol from "@/public/photos/cakes/es-cendol.jpg";
import strawberryShortcake from "@/public/photos/cakes/strawberry-shortcake.jpg";
import chocStrawberryFraisier from "@/public/photos/cakes/choc-strawberry-fraisier.jpg";
import strawberryFraisier from "@/public/photos/cakes/strawberry-fraisier.jpg";
import raspberryLychee from "@/public/photos/cakes/raspberry-lychee.jpg";
import blackforest from "@/public/photos/cakes/blackforest.jpg";
import banoffee from "@/public/photos/cakes/banoffee.jpg";
import basqueCheesecake from "@/public/photos/cakes/basque-cheesecake.jpg";
import ubeBasqueCheesecake from "@/public/photos/cakes/ube-basque-cheesecake.jpg";
import chocPeppermint from "@/public/photos/cakes/choc-peppermint.jpg";

export const CAKES = [
  { id: "tiramisu", name: "Tiramisu", photo: tiramisu,
    price14: null, price16: 270000,
    description: "Lady finger, mascarpone cream, chocolate coffee cream, cocoa dusting, gold leaf." },
  { id: "lemon-earl-grey", name: "Lemon Earl Grey", photo: lemonEarlGrey,
    price14: 185000, price16: 235000,
    description: "Vanilla soft cake, earl grey chantilly, lemon ganache, lemon curd." },
  { id: "es-cendol", name: "Es Cendol", photo: esCendol,
    price14: 195000, price16: 245000,
    description: "Sentuhan es cendol khas Indonesia dalam vanilla soft cake." },
  { id: "strawberry-shortcake", name: "Strawberry Shortcake", photo: strawberryShortcake,
    price14: 180000, price16: 230000,
    description: "Vanilla soft cake, fresh strawberries, vanilla chantilly." },
  { id: "choc-strawberry-fraisier", name: "Chocolate Strawberry Fraisier", photo: chocStrawberryFraisier,
    price14: 185000, price16: 240000,
    description: "Chocolate soft cake, chocolate chantilly, strawberry jam, fresh strawberries." },
  { id: "strawberry-fraisier", name: "Strawberry Fraisier", photo: strawberryFraisier,
    price14: 185000, price16: 240000,
    description: "Vanilla soft cake, yoghurt chantilly, strawberry jam, fresh strawberries." },
  { id: "raspberry-lychee", name: "Raspberry Lychee", photo: raspberryLychee,
    price14: 200000, price16: 230000,
    description: "Vanilla soft cake, raspberry chantilly, lychee, fresh flowers (sesuai ketersediaan)." },
  { id: "blackforest", name: "Blackforest", photo: blackforest,
    price14: 210000, price16: 255000,
    description: "Chocolate sponge, vanilla mascarpone chantilly, cherry jam, choc shards." },
  { id: "banoffee", name: "Banoffee", photo: banoffee,
    price14: 210000, price16: 240000,
    description: "Chocolate soft cake, fresh banana, salted caramel sauce." },
  { id: "basque-cheesecake", name: "Basque Cheesecake", photo: basqueCheesecake,
    price14: null, price16: 255000,
    description: "Cookie crumbs, basque cheesecake, strawberry jam, fresh cream." },
  { id: "ube-basque-cheesecake", name: "Ube Basque Cheesecake", photo: ubeBasqueCheesecake,
    price14: null, price16: 265000,
    description: "Ube basque cheesecake, milk chocolate ganache, ube fresh cream, ube chips." },
  { id: "choc-peppermint", name: "Choc Peppermint", photo: chocPeppermint,
    price14: 180000, price16: 235000,
    description: "Chocolate soft cake, peppermint chantilly, choc bits, oreo, chocolate ganache." },
  // Added 2026-07-23 from the shop's own "WHOLE CAKES 2026" pricelist PDF. No
  // product photo shot for the web yet, so PhotoFrame's monogram fallback stands
  // in honestly. Prices are the PDF's; note they sit on a newer (higher) basis
  // than the older entries above, which still await ci Ariel's price reconcile.
  { id: "cookies-and-cream", name: "Cookies and Cream",
    price14: 225000, price16: 260000,
    description: "Vanilla soft cake, chocolate chantilly, chocolate ganache, oreo crumbs." },
  { id: "matcha-fraisier", name: "Matcha Fraisier",
    price14: 225000, price16: 260000,
    description: "Matcha soft cake, matcha chantilly, strawberry jam, fresh strawberries." },
];

/** "185k–235k" when the shop sells two sizes, "270k" when it sells one. */
export function priceLabel(cake, k) {
  if (cake.price14 && cake.price16) return `${k(cake.price14)}–${k(cake.price16)}`;
  return k(cake.price16);
}

/* Reused across the hero, the story split and the visit split: three distinct
 * real cakes stand in for photography this shop has not shot for the web yet
 * (a proper storefront and workshop shot). Swap these for real ones anytime. */
export const SITE_CAKE_PHOTOS = {
  hero: banoffee,
  histoire: tiramisu,
  visite: basqueCheesecake,
};
