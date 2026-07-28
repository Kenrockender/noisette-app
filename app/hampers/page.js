import Link from "next/link";
import HampersForm from "@/components/HampersForm";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = {
  title: "Hampers custom",
  description:
    "Hampers custom dari Noisette. Ceritakan isi yang kamu mau, admin kami menghubungimu di WhatsApp untuk konfirmasi dan pembayaran.",
  alternates: { canonical: "/hampers" },
};

/**
 * The hampers page (Noisette v2). Same website voice and shell as /bespoke:
 * a hampers order starts as a request ci Ariel reads and replies to, not a
 * stock pick, so it gets a form and a promise of a human reply, not a cart.
 */
export default function HampersPage() {
  return (
    <div className="bespoke">
      <header className="bespoke-bar">
        <Link href="/" className="brand brand-stack">
          <span className="brand-word">NOISETTE</span>
          <span className="brand-sub">✦ Hampers ✦</span>
        </Link>
        <span className="bespoke-theme">
          <ThemeToggle />
        </span>
      </header>

      <main id="main" className="bespoke-main">
        <h1 className="serif bespoke-h1">
          Hampers,
          <br />
          <em className="accent-em">disusun untukmu</em>
        </h1>
        <p className="bespoke-lede">Form order</p>

        <HampersForm />
      </main>

      <footer className="bespoke-foot">
        <Link href="/">Kembali ke toko</Link>
      </footer>
    </div>
  );
}
