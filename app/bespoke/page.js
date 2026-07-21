import Link from "next/link";
import BespokeForm from "@/components/BespokeForm";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = {
  title: "Kue custom",
  description:
    "Kue custom dan entremets dari La Patisserie. Brief, penawaran, DP, dan tanggal — dua minggu sebelumnya.",
  alternates: { canonical: "/bespoke" },
};

/**
 * The bespoke page (Noisette v2). Website voice, not app voice: this is still
 * the introduction, because someone commissioning a wedding cake is not a
 * customer racing a stock counter. The form is the only interactive thing
 * on it, and the numbers stay small on purpose.
 */
export default function BespokePage() {
  return (
    <div className="bespoke">
      <header className="bespoke-bar">
        <Link href="/" className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Sur mesure ✦</span>
        </Link>
        <span className="bespoke-theme">
          <ThemeToggle />
        </span>
      </header>

      <main id="main" className="bespoke-main">
        <h1 className="serif bespoke-h1">
          Kue yang hanya
          <br />
          <em className="accent-em">ada sekali</em>
        </h1>
        <p className="bespoke-lede">
          Kue pernikahan, entremets untuk momen besar, karya yang tak punya
          tempat di etalase. Patissier kami hanya mengambil beberapa komisi
          seminggu — tidak pernah lebih.
        </p>

        <ol className="bespoke-steps">
          <li>
            <span className="bespoke-step-num serif">1</span>
            <span className="bespoke-step-label">Kirim brief</span>
          </li>
          <li>
            <span className="bespoke-step-num serif">2</span>
            <span className="bespoke-step-label">Terima penawaran</span>
          </li>
          <li>
            <span className="bespoke-step-num serif">3</span>
            <span className="bespoke-step-label">DP mengunci minggu</span>
          </li>
          <li>
            <span className="bespoke-step-num serif">4</span>
            <span className="bespoke-step-label">Ambil di toko</span>
          </li>
        </ol>

        <BespokeForm />
      </main>

      <footer className="bespoke-foot">
        <Link href="/">Kembali ke toko</Link>
      </footer>
    </div>
  );
}
