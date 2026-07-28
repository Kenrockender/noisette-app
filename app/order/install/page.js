import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import InstallGuide from "@/components/InstallGuide";

export const metadata = {
  title: "Pasang aplikasi order",
  description: "Cara memasang aplikasi order Noisette ke layar utama HP kamu.",
  alternates: { canonical: "/order/install" },
  robots: { index: false, follow: true },
};

export default function InstallOrderPage() {
  return (
    <div className="bespoke">
      <header className="bespoke-bar">
        <Link href="/order" className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Pasang aplikasi ✦</span>
        </Link>
        <span className="bespoke-theme">
          <ThemeToggle />
        </span>
      </header>

      <main id="main" className="bespoke-main">
        <h1 className="serif bespoke-h1">
          Pasang <em className="accent-em">Order</em>
        </h1>
        <p className="bespoke-lede">
          Tambahkan Order Noisette ke layar utama, biar pesan kue tiap minggu
          tinggal satu ketukan, tanpa buka browser dulu.
        </p>

        <InstallGuide appName="Order Noisette" tagline="Pesan pastry mingguan" iconSrc="/order/icons/icon-192.png" />
      </main>

      <footer className="bespoke-foot">
        <Link href="/order">Kembali ke order</Link>
      </footer>
    </div>
  );
}
