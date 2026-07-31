import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import InstallGuide from "@/components/InstallGuide";

export const metadata = {
  title: "Pasang aplikasi pre-order",
  description: "Cara memasang aplikasi pre-order Noisette ke layar utama HP kamu.",
  alternates: { canonical: "/pre-order/install" },
  robots: { index: false, follow: true },
};

export default function InstallPreOrderPage() {
  return (
    <div className="bespoke">
      <header className="bespoke-bar">
        <Link href="/pre-order" className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Pasang aplikasi ✦</span>
        </Link>
        <span className="bespoke-theme">
          <ThemeToggle />
        </span>
      </header>

      <main id="main" className="bespoke-main">
        <h1 className="serif bespoke-h1">
          Pasang <em className="accent-em">Pre-order</em>
        </h1>
        <p className="bespoke-lede">
          Tambahkan Pre-order Noisette ke layar utama, biar pesan kue tiap minggu
          tinggal satu ketukan, tanpa buka browser dulu.
        </p>

        <InstallGuide appName="Pre-order Noisette" tagline="Pesan pastry mingguan" iconSrc="/pre-order/icons/icon-192.png" />
      </main>

      <footer className="bespoke-foot">
        <Link href="/pre-order">Kembali ke pre-order</Link>
      </footer>
    </div>
  );
}
