import WholesalePortal from "@/components/WholesalePortal";

export const metadata = {
  title: "Wholesale",
  description: "Standing orders and trade pricing for cafes, restaurants and hotels.",
  alternates: { canonical: "/wholesale" },
  // The landing copy may rank, but the portal behind sign-in is a tool.
  robots: { index: false, follow: true },
};

export default function WholesalePage() {
  return <WholesalePortal />;
}
