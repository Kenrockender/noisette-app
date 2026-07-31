import WalkinMenu from "@/components/WalkinMenu";

export const metadata = {
  title: "Menu toko",
  // Staff tool, same as /admin: keep it out of search entirely.
  robots: { index: false, follow: false },
};

export default function OrderPage() {
  return <WalkinMenu />;
}
