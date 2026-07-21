import AdminDash from "@/components/AdminDash";

export const metadata = {
  title: "Counter",
  // Back of house. Keep it out of search entirely, both the page and any link
  // followed from it.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDash />;
}
