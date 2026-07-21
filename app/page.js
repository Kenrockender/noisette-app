import Link from "next/link";
import { getProducts, getAvailability } from "@/lib/store";
import { allProductStats } from "@/lib/reviews";
import { dayLabel, k } from "@/lib/format";
import ThemeToggle from "@/components/ThemeToggle";
import PhotoFrame from "@/components/PhotoFrame";
import Icon from "@/components/Icon";
import { SITE_PHOTOS, photoOf } from "@/lib/photos";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Noisette Patissier, patisserie moderne di Malang",
  description:
    "Dipanggang subuh, habis sebelum siang. Patisserie kecil di Jl. Bondowoso No.8, Malang. Lihat apa yang kami panggang dan pesan untuk diambil.",
  alternates: { canonical: "/" },
};

/*
 * THE WEBSITE (Noisette v2).
 *
 * This page exists to introduce the bakery to someone who has never heard of
 * it: what we make, why the numbers are small, where we are, when we are open.
 * It is the brand voice, in Indonesian with French section names, on a wide
 * editorial layout.
 *
 * It deliberately has no bag and no checkout. The one job of every CTA here is
 * to hand the visitor to /order, which is a different product with a different
 * layout and a plainer voice. See components/OrderApp.js.
 */

/*
 * The hero card compares today's remaining retail stock against the day's full
 * bake (retail + wholesale + counter), which is brand copy ("forty a day"), not
 * a number the availability API returns.
 */
const BAKE_OF = { dubai: 40, pistachio: 10, piscok: 14 };
const HERO_TICKER = ["dubai", "pistachio", "piscok"];

export default async function LandingPage() {
  const products = getProducts();
  const avail = await getAvailability();
  const stats = allProductStats();
  const stockOf = (id) => avail.stock[id] ?? 0;
  const showcase = products.slice(0, 6);
  const dubai = stockOf("dubai");
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  return (
    <div className="site">
      <p className="ticker">
        {dayLabel(avail.date)} —{" "}
        <b>Dubai Chocolate sisa {dubai} dari 40</b> · pre-order buka sampai
        besok subuh
      </p>

      <header className="site-header">
        <div className="site-address micro">Jl. Bondowoso No.8, Malang</div>
        <Link href="/" className="brand brand-stack" aria-label="Noisette Patissier, beranda">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Patissier de Malang ✦</span>
        </Link>
        <nav className="site-nav" aria-label="Utama">
          <a href="#vitrine">Menu</a>
          <a href="#cerita">Cerita</a>
          <a href="#kunjung">Kunjungi</a>
          <ThemeToggle />
          <Link href="/order" className="btn btn-sm">
            Pesan
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="site-hero">
          <div className="site-hero-copy">
            <p className="eyebrow">✦ Patisserie moderne, Malang</p>
            <h1 className="serif">
              Dipanggang
              <br />
              subuh. <em className="accent-em">Habis</em>
              <br />
              <em className="accent-em">sebelum siang.</em>
            </h1>
            <p className="lede">
              Kami membuat empat puluh Dubai chocolate bar sehari — lalu
              berhenti. Pesan jatah besok, pilih jam ambilmu, dan datang saat
              semuanya masih hangat.
            </p>
            <div className="site-hero-row">
              <Link href="/order" className="btn site-hero-cta">
                Pesan untuk diambil
                <Icon name="arrowRight" size={15} />
              </Link>
              <span className="micro site-hours">Buka tiap hari · 08.00–21.00</span>
            </div>
          </div>
          <div className="site-hero-visual">
            {/* The one image above the fold, so it is the only one that preloads. */}
            <PhotoFrame
              photo={SITE_PHOTOS.hero}
              alt="Konter Noisette dengan pastry hari itu di balik kaca."
              className="site-hero-photo"
              sizes="(min-width: 1000px) 46vw, 100vw"
              priority
            />
            <div className="site-hero-stock">
              <p className="site-hero-stock-label">Jatah hari ini</p>
              <div className="site-hero-stock-rows">
                {HERO_TICKER.map((id) => {
                  const p = byId[id];
                  if (!p) return null;
                  const left = stockOf(id);
                  const bake = BAKE_OF[id] ?? left;
                  const pct = bake > 0 ? Math.round((left / bake) * 100) : 0;
                  return (
                    <div key={id} className="site-hero-stock-row">
                      <span>{p.name.replace(" Bar", "")}</span>
                      <span className={`site-hero-stock-left${pct <= 50 ? " is-low" : ""}`}>
                        sisa {left}/{bake}
                      </span>
                      <span className="site-hero-stock-track">
                        <span
                          className={`site-hero-stock-bar${pct <= 20 ? " is-critical" : ""}`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="vitrine">
          <div className="section-head">
            <div>
              <p className="eyebrow">✦ La Vitrine</p>
              <h2 className="serif">
                Yang kami panggang
                <br />
                <em className="accent-em">minggu ini</em>
              </h2>
            </div>
            <Link href="/order" className="section-link">
              Menu lengkap &amp; stok
              <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          <ul className="showcase">
            {showcase.map((p) => {
              const s = stockOf(p.id);
              const st = stats[p.id];
              const badge =
                p.id === "giftbox6"
                  ? "Untuk hadiah"
                  : s > 0 && s <= 7
                    ? `Sisa ${s} hari ini`
                    : null;
              return (
                <li key={p.id} className="showcase-item">
                  <Link href={`/order?p=${p.id}`} className="showcase-link">
                    <div className="showcase-photowrap">
                      {/* alt="" on purpose: the name is in the h3 immediately below. */}
                      <PhotoFrame
                        photo={photoOf(p.id)}
                        label={p.name}
                        className="showcase-photo"
                        sizes="(min-width: 1000px) 33vw, (min-width: 700px) 50vw, 100vw"
                      />
                      {badge && <span className="showcase-badge">{badge}</span>}
                    </div>
                    <div className="showcase-row">
                      <h3 className="serif">{p.name}</h3>
                      <span className="showcase-price">{k(p.price)}</span>
                    </div>
                    <p className="showcase-desc">{p.description}</p>
                    {st?.count > 0 && (
                      <p
                        className="showcase-rating"
                        aria-label={`${st.average} dari 5 bintang, ${st.count} ulasan`}
                      >
                        ★ {st.average} · {st.count} ulasan dari pembeli
                      </p>
                    )}
                    {s <= 0 && (
                      <span className="tag tag-out">
                        Habis untuk {dayLabel(avail.date)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="split split-deep" id="cerita">
          <PhotoFrame
            photo={SITE_PHOTOS.histoire}
            alt="Patissier menata dessert di rak dapur."
            className="split-photo"
            sizes="(min-width: 1000px) 52vw, 100vw"
          />
          <div className="split-copy">
            <p className="eyebrow">✦ Notre histoire</p>
            <h2 className="serif italic">Dapur kecil di Jalan Bondowoso</h2>
            <p>
              Semua dilaminasi dan dipanggang pagi yang sama dengan hari kamu
              mengambilnya. Itu alasan angkanya kecil: kalau jatah hari itu
              habis, ya habis — kami tidak memanggang batch kedua untuk
              mengejar.
            </p>
            <p>
              Jam buka jadi pendek, dan sesekali ada pelanggan tetap yang
              kecewa. Kami memutuskan bisa hidup dengan itu.
            </p>
            <p className="quiet serif">Dibuat segar setiap pagi, tanpa kecuali.</p>
          </div>
        </section>

        <section className="section">
          <p className="eyebrow">✦ Cara ambilnya</p>
          <ol className="steps">
            <li className="step">
              <span className="step-num serif">01</span>
              <h3 className="step-title">Pilih hari</h3>
              <p className="step-desc">
                Pre-order buka untuk lima hari ke depan. Stok dihitung per
                hari, jadi tentukan harinya dulu.
              </p>
            </li>
            <li className="step">
              <span className="step-num serif">02</span>
              <h3 className="step-title">Pilih jam</h3>
              <p className="step-desc">
                Slot dua jam, masing-masing dibatasi — supaya kamu tidak
                mengantre di Jalan Bondowoso.
              </p>
            </li>
            <li className="step">
              <span className="step-num serif">03</span>
              <h3 className="step-title">Tunjukkan kodemu</h3>
              <p className="step-desc">
                Bayar QRIS, struk dan kode ambil masuk WhatsApp. Di konter
                tinggal tunjukkan.
              </p>
            </li>
          </ol>
        </section>

        <section className="split split-reverse" id="kunjung">
          <PhotoFrame
            photo={SITE_PHOTOS.visite}
            alt="Tampak depan toko dari jalan."
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
              <dt>Ambil pre-order</dt>
              <dd>Setiap hari · 08.00–18.00</dd>
              <dt>Kafe &amp; hotel</dt>
              <dd>
                Harga khusus mitra —{" "}
                <Link href="/wholesale">portal wholesale</Link>
              </dd>
              <dt>Kue custom</dt>
              <dd>
                Beberapa komisi per minggu —{" "}
                <Link href="/bespoke">kirim brief</Link>
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
          <a href="https://wa.me/6281000000000" target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a href="https://instagram.com/" target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
          <Link href="/order">Pesan</Link>
          <Link href="/wholesale">Wholesale</Link>
          <Link href="/bespoke">Bespoke</Link>
          <Link href="/admin">Konter</Link>
        </nav>
        <small className="site-copyright">2026 Noisette Patissier</small>
      </footer>
    </div>
  );
}
