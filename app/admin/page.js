import AdminDash from "@/components/AdminDash";
import RegisterAdminSW from "@/components/RegisterAdminSW";

export const metadata = {
  title: "Counter",
  // Back of house. Keep it out of search entirely, both the page and any link
  // followed from it.
  robots: { index: false, follow: false },
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Noisette",
  },
  icons: {
    icon: [
      { url: "/admin/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/admin/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/admin/icons/apple-touch-icon.png",
  },
};

export default function AdminPage() {
  return (
    <>
      <RegisterAdminSW />
      <AdminDash />
    </>
  );
}
