/**
 * Photography.
 *
 * These are static imports, not URLs, on purpose. Importing the file lets Next
 * read the real dimensions at build time and generate a blur placeholder, so
 * every photo reserves its own space and nothing shifts while it loads.
 *
 * Source: Unsplash, under the Unsplash License (free for commercial use, no
 * attribution required). Photo IDs and links are listed in public/photos/CREDITS.md
 * so these can be swapped for Noisette's own shots without guesswork.
 *
 * To replace one: drop a real photo at the same path and delete nothing else.
 */
import pistachio from "@/public/photos/pistachio.jpg";
import piscok from "@/public/photos/piscok.jpg";
import almond from "@/public/photos/almond.jpg";
import dubai from "@/public/photos/dubai.jpg";
import bonbon from "@/public/photos/bonbon.jpg";
import eggtart from "@/public/photos/eggtart.jpg";
import hazelnut from "@/public/photos/hazelnut.jpg";
import mango from "@/public/photos/mango.jpg";
import giftbox6 from "@/public/photos/giftbox6.jpg";

import hero from "@/public/photos/hero.jpg";
import histoire from "@/public/photos/histoire.jpg";
import visite from "@/public/photos/visite.jpg";

/** productId -> imported image. Missing key falls back to the monogram frame. */
export const PRODUCT_PHOTOS = {
  pistachio,
  piscok,
  almond,
  dubai,
  bonbon,
  eggtart,
  hazelnut,
  mango,
  giftbox6,
};

export const SITE_PHOTOS = { hero, histoire, visite };

export const photoOf = (id) => PRODUCT_PHOTOS[id] ?? null;
