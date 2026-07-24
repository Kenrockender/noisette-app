import OrderApp from "@/components/OrderApp";
import { getProducts, getAvailability } from "@/lib/store";
import { allProductStats } from "@/lib/reviews";

export const metadata = {
  title: "Order",
  description: "Reserve pastries for a pickup day and window, and pay by QRIS.",
  alternates: { canonical: "/order" },
  // The ordering app is a tool, not a page we want ranked. The website at / is
  // the thing that should show up in search.
  robots: { index: false, follow: true },
};

// Real-time stock: this page renders per request, so the first paint carries the
// same live numbers the old client fetch used to arrive at — but they ship with
// the HTML instead of after four round trips.
export const dynamic = "force-dynamic";

export default async function OrderPage() {
  // Fetch on the server and hand the catalog to the client already filled in, so
  // the ordering screen paints its first frame with data instead of a spinner.
  // Products and review stats are code-defined and cheap; availability is the one
  // live read. Session and order history stay client-side (they depend on the
  // visitor's cookie and never block the catalog).
  const avail = await getAvailability();
  const products = getProducts();
  const stats = await allProductStats();

  return <OrderApp initialProducts={products} initialAvail={avail} initialStats={stats} />;
}
