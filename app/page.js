import Link from "next/link";
import { k } from "@/lib/format";
import ThemeToggle from "@/components/ThemeToggle";
import PhotoFrame from "@/components/PhotoFrame";
import Icon from "@/components/Icon";
import { CAKES, SITE_CAKE_PHOTOS, priceLabel } from "@/lib/site-cakes";

export const metadata = {
  title: "Noisette Patissier, patisserie moderne di Malang",
  description:
    "Whole cake made-to-order di Jl. Bondowoso No.8, Malang. Lihat menu dan pesan lewat WhatsApp.",
  alternates: { canonical: "/" },
};

/*
 * THE WEBSITE (Noisette v2).
 *
 * This page exists to introduce the bakery to someone who has never heard of
 * it: what we make, where we are, when we are open. It is the brand voice, in
 * Indonesian with French section names, on a wide editorial layout.
 *
 * It deliberately has no bag and no checkout. It shows Noisette's real whole
 * cake menu (lib/site-cakes.js, sourced from the shop's own pricelist and
 * Instagram), decoupled on purpose from the fictional demo catalog that
 * /order, /admin and /wholesale still run on — those are a separate,
 * unfinished product and their per-day allocation model does not fit a
 * made-to-order whole cake business anyway. Every CTA here goes to WhatsApp,
 * which is how the shop actually takes orders today.
 */
const WHATSAPP_NUMBER = "6281250571356";
const waLink = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? `&text=${encodeURIComponent(text)}` : ""}`;

export default function LandingPage() {
  return (
    <div className="site">
      <p className="ticker">
        Whole cake made-to-order · pre-order minimal H-2 · Jl. Bondowoso No.8, Malang
      </p>

      <header className="site-header">
        <div className="site-address micro">Jl. Bondowoso No.8, Malang</div>
        <Link href="/" className="brand brand-stack" aria-label="Noisette Patissier, beranda">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Patissier de Malang ✦</span>
        </Link>
        <nav className="site-nav" aria-label="Utama">
          <a href="#vitrine">Menu</a>
          <Link href="/cafe">Kafe</Link>
          <a href="#cerita">Cerita</a>
          <a href="#kunjung">Kunjungi</a>
          <ThemeToggle />
          <a href={waLink("Halo, aku mau tanya menu Noisette")} className="btn btn-sm" target="_blank" rel="noopener noreferrer">
            Pesan
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="site-hero">
          <div className="site-hero-copy">
            <p className="eyebrow">✦ Patisserie moderne, Malang</p>
            <h1 className="serif">
              Whole cake,
              <br />
              dibuat <em className="accent-em">saat</em>
              <br />
              <em className="accent-em">kamu pesan.</em>
            </h1>
            <p className="lede">
              Setiap cake dibuat setelah pesanan masuk, bukan berdiri di
              etalase menunggu dibeli. Chat dulu di WhatsApp, sebutkan rasa
              dan ukurannya, lalu kami sepakatkan tanggal ambil.
            </p>
            <div className="site-hero-row">
              <a
                href={waLink("Halo, aku mau pesan whole cake Noisette")}
                className="btn site-hero-cta"
                target="_blank"
                rel="noopener noreferrer"
              >
                Pesan via WhatsApp
                <Icon name="arrowRight" size={15} />
              </a>
              <span className="micro site-hours">Buka tiap hari · 08.00–21.00</span>
            </div>
          </div>
          <div className="site-hero-visual">
            {/* The one image above the fold, so it is the only one that preloads. */}
            <PhotoFrame
              photo={SITE_CAKE_PHOTOS.hero}
              alt="Salah satu whole cake Noisette."
              className="site-hero-photo"
              sizes="(min-width: 1000px) 46vw, 100vw"
              priority
            />
          </div>
        </section>

        <section className="section" id="vitrine">
          <div className="section-head">
            <div>
              <p className="eyebrow">✦ La Vitrine</p>
              <h2 className="serif">
                Yang kami buat
                <br />
                <em className="accent-em">tiap minggu</em>
              </h2>
            </div>
            <a href={waLink("Halo, aku mau tanya menu Noisette")} className="section-link" target="_blank" rel="noopener noreferrer">
              Tanya &amp; pesan
              <Icon name="arrowRight" size={14} />
            </a>
          </div>

          <ul className="showcase">
            {CAKES.map((c) => (
              <li key={c.id} className="showcase-item">
                <a
                  href={waLink(`Halo, aku mau tanya cake ${c.name}`)}
                  className="showcase-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="showcase-photowrap">
                    {/* alt="" on purpose: the name is in the h3 immediately below. */}
                    <PhotoFrame
                      photo={c.photo}
                      label={c.name}
                      className="showcase-photo"
                      sizes="(min-width: 1000px) 33vw, (min-width: 700px) 50vw, 100vw"
                    />
                  </div>
                  <div className="showcase-row">
                    <h3 className="serif">{c.name}</h3>
                    <span className="showcase-price">{priceLabel(c, k)}</span>
                  </div>
                  <p className="showcase-desc">{c.description}</p>
                </a>
              </li>
            ))}
          </ul>

          {/*
           * The cafe (bread, pastry, slice cake, minuman) has its own real menu
           * page at /cafe, on the cafe WhatsApp line. This note points there.
           */}
          <div className="showcase-note">
            <p>
              Ada juga pilihan roti, pastry, slice cake, dan minuman di kafe,
              di luar menu whole cake di atas.
            </p>
            <Link href="/cafe" className="section-link">
              Lihat menu kafe
              <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        </section>

        <section className="split split-deep" id="cerita">
          <PhotoFrame
            photo={SITE_CAKE_PHOTOS.histoire}
            alt="Salah satu whole cake Noisette, dipotong."
            className="split-photo"
            sizes="(min-width: 1000px) 52vw, 100vw"
          />
          <div className="split-copy">
            <p className="eyebrow">✦ Notre histoire</p>
            <h2 className="serif italic">Dapur kecil di Jalan Bondowoso</h2>
            <p>
              Setiap whole cake dibuat setelah pesanan masuk. Itu sebabnya
              kami minta waktu dua hari — supaya krim, buah, dan lapisannya
              masih di titik paling segar saat kamu ambil.
            </p>
            <p>
              Dari cake harian sampai kue karakter custom, semua dikerjakan
              tangan di dapur yang sama.
            </p>
            <p className="quiet serif">Dibuat tangan, sesuai pesanan, setiap kali.</p>
          </div>
        </section>

        <section className="section">
          <p className="eyebrow">✦ Cara pesannya</p>
          <ol className="steps">
            <li className="step">
              <span className="step-num serif">01</span>
              <h3 className="step-title">Chat WhatsApp</h3>
              <p className="step-desc">
                Sebutkan rasa dan ukuran yang kamu mau, 14cm atau 16cm.
              </p>
            </li>
            <li className="step">
              <span className="step-num serif">02</span>
              <h3 className="step-title">Sepakati tanggal</h3>
              <p className="step-desc">
                Pesan minimal dua hari sebelumnya. Kami konfirmasi tanggal
                ambil yang pas.
              </p>
            </li>
            <li className="step">
              <span className="step-num serif">03</span>
              <h3 className="step-title">Ambil di toko</h3>
              <p className="step-desc">
                Bayar dan ambil langsung di Jl. Bondowoso No.8, sesuai
                jadwal yang disepakati.
              </p>
            </li>
          </ol>
        </section>

        <section className="split split-reverse" id="kunjung">
          <PhotoFrame
            photo={SITE_CAKE_PHOTOS.visite}
            alt="Salah satu whole cake Noisette."
            className="split-photo"
            sizes="(min-width: 1000px) 52vw, 100vw"
          />
          <div className="split-copy">
            <p className="eyebrow">✦ Kunjungi</p>
            <h2 className="serif">
              Jl. Bondowoso No.8,
              <br />
              Malang
            </h2>
            <dl className="hours">
              <dt>Toko</dt>
              <dd>Senin–Minggu · 08.00–21.00</dd>
              <dt>Pre-order</dt>
              <dd>Minimal 2 hari sebelumnya, via WhatsApp</dd>
              <dt>Kafe &amp; hotel</dt>
              <dd>
                Harga khusus mitra —{" "}
                <Link href="/wholesale">portal wholesale</Link>
              </dd>
              <dt>Kue karakter &amp; custom</dt>
              <dd>
                Kirim brief —{" "}
                <Link href="/bespoke">mulai di sini</Link>
              </dd>
              <dt>Hampers custom</dt>
              <dd>
                Ceritakan isinya —{" "}
                <Link href="/hampers">mulai di sini</Link>
              </dd>
            </dl>
            <a
              className="site-maplink"
              href="https://www.google.com/maps/search/?api=1&query=Jl.+Bondowoso+No.8+Malang"
              target="_blank"
              rel="noopener noreferrer"
            >
              Buka di Maps
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
            WhatsApp
          </a>
          <a href="https://instagram.com/noisette.mlg" target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
          <a href={waLink("Halo, aku mau tanya menu Noisette")} target="_blank" rel="noopener noreferrer">
            Pesan
          </a>
          <Link href="/cafe">Menu kafe</Link>
          <Link href="/wholesale">Wholesale</Link>
          <Link href="/bespoke">Bespoke</Link>
          <Link href="/hampers">Hampers</Link>
          <Link href="/admin">Konter</Link>
          <Link href="/install">Pasang aplikasi</Link>
        </nav>
        <small className="site-copyright">2026 Noisette Patissier</small>
      </footer>
    </div>
  );
}
