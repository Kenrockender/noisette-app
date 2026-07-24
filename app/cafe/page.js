import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import Icon from "@/components/Icon";
import { rp } from "@/lib/format";
import { CAFE_SECTIONS, CAFE_WHATSAPP, PRICES_CONFIRMED } from "@/lib/cafe-menu";

export const metadata = {
  title: "Menu Kafe, Noisette Patissier",
  description:
    "Pastry, slice cake, dan minuman di kafe Noisette, Jl. Bondowoso No.8, Malang. Pesan langsung di tempat atau lewat WhatsApp.",
  alternates: { canonical: "/cafe" },
};

/*
 * THE CAFE MENU (Noisette v2).
 *
 * A menu to read, not a checkout: pastry, slice cake and minuman that the shop
 * makes for the counter. Same website voice as "/", but its own WhatsApp — the
 * cafe line, separate from the kue & hampers line (lib/cafe-menu.js documents
 * the split). No photos and no prices on purpose: prices stay "Tanya harga"
 * until ci Ariel confirms the counter price, at which point flipping
 * PRICES_CONFIRMED in lib/cafe-menu.js lights the numbers up here.
 */
const waLink = (text) =>
  `https://api.whatsapp.com/send?phone=${CAFE_WHATSAPP}${text ? `&text=${encodeURIComponent(text)}` : ""}`;

function priceText(item) {
  if (PRICES_CONFIRMED && item.price != null) return rp(item.price);
  return "Tanya harga";
}

export default function CafeMenuPage() {
  return (
    <div className="site">
      <p className="ticker">
        Kafe buka tiap hari · 08.00–21.00 · Jl. Bondowoso No.8, Malang
      </p>

      <header className="site-header">
        <div className="site-address micro">Jl. Bondowoso No.8, Malang</div>
        <Link href="/" className="brand brand-stack" aria-label="Noisette Patissier, beranda">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Le Cafe ✦</span>
        </Link>
        <nav className="site-nav" aria-label="Utama">
          <Link href="/">Beranda</Link>
          <ThemeToggle />
          <a
            href={waLink("Halo, aku mau pesan dari kafe Noisette")}
            className="btn btn-sm"
            target="_blank"
            rel="noopener noreferrer"
          >
            Pesan
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="section">
          <p className="eyebrow">✦ Le Cafe</p>
          <h1 className="serif cafe-h1">
            Menu <em className="accent-em">kafe</em>
          </h1>
          <p className="lede">
            Pastry, slice cake, dan minuman yang kami buat harian di kedai.
            Pesan langsung di tempat atau lewat WhatsApp kafe. Whole cake dan
            hampers pemesanannya terpisah.
          </p>

          <div className="cafe-menu">
            {CAFE_SECTIONS.map((sec) => (
              <div key={sec.id} className="cafe-cat">
                <div className="cafe-cat-head">
                  <h2 className="serif">{sec.label}</h2>
                  <span className="cafe-cat-count">{sec.items.length} pilihan</span>
                </div>
                <ul className="cafe-list">
                  {sec.items.map((item) => (
                    <li key={item.id} className="cafe-item">
                      <div className="cafe-item-main">
                        <p className="cafe-item-name">{item.name}</p>
                        {item.note && <p className="cafe-item-note">{item.note}</p>}
                      </div>
                      <span className="cafe-item-price">{priceText(item)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="showcase-note">
            <p>
              Harganya menyusul — untuk sekarang tanya langsung lewat WhatsApp
              kafe untuk harga dan ketersediaan hari ini. Untuk whole cake dan
              hampers, pemesanannya lewat WhatsApp yang berbeda.
            </p>
            <a
              href={waLink("Halo, aku mau tanya menu kafe Noisette")}
              className="section-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Tanya lewat WhatsApp
              <Icon name="arrowRight" size={14} />
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Patissier de Malang ✦</span>
        </span>
        <nav className="site-footer-links" aria-label="Footer">
          <a href={waLink()} target="_blank" rel="noopener noreferrer">
            WhatsApp kafe
          </a>
          <a href="https://instagram.com/noisette.mlg" target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
          <Link href="/">Beranda</Link>
          <Link href="/bespoke">Kue custom</Link>
        </nav>
        <small className="site-copyright">2026 Noisette Patissier</small>
      </footer>
    </div>
  );
}
