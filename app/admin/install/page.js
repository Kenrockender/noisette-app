import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import InstallGuide from "@/components/InstallGuide";

export const metadata = {
  title: "Pasang aplikasi konter",
  description: "Cara memasang aplikasi konter Noisette ke layar utama HP atau tablet kasir.",
  robots: { index: false, follow: false },
};

export default function InstallAdminPage() {
  return (
    <div className="bespoke">
      <header className="bespoke-bar">
        <Link href="/admin" className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Pasang aplikasi ✦</span>
        </Link>
        <span className="bespoke-theme">
          <ThemeToggle />
        </span>
      </header>

      <main id="main" className="bespoke-main">
        <h1 className="serif bespoke-h1">
          Pasang <em className="accent-em">Konter</em>
        </h1>
        <p className="bespoke-lede">
          Tambahkan Konter ke layar utama HP atau tablet kasir, biar buka
          langsung ke pesanan hari ini tanpa ketik alamat website.
        </p>

        <InstallGuide appName="Konter Noisette" tagline="Untuk staf di kasir" iconSrc="/admin/icons/icon-192.png" />
      </main>

      <footer className="bespoke-foot">
        <Link href="/admin">Kembali ke konter</Link>
      </footer>
    </div>
  );
}
