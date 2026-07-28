import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import InstallGuide from "@/components/InstallGuide";

export const metadata = {
  title: "Pasang aplikasi",
  description: "Cara memasang situs Noisette Patissier ke layar utama HP atau komputer kamu.",
  alternates: { canonical: "/install" },
};

export default function InstallSitePage() {
  return (
    <div className="bespoke">
      <header className="bespoke-bar">
        <Link href="/" className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Pasang aplikasi ✦</span>
        </Link>
        <span className="bespoke-theme">
          <ThemeToggle />
        </span>
      </header>

      <main id="main" className="bespoke-main">
        <h1 className="serif bespoke-h1">
          Pasang <em className="accent-em">Noisette</em>
        </h1>
        <p className="bespoke-lede">
          Tambahkan situs Noisette ke layar utama, biar buka menu, kafe, dan info toko
          secepat buka aplikasi lain.
        </p>

        <InstallGuide appName="Noisette Patissier" tagline="Situs utama" iconSrc="/icons/icon-192.png" />
      </main>

      <footer className="bespoke-foot">
        <Link href="/">Kembali ke toko</Link>
      </footer>
    </div>
  );
}
