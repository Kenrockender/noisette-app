import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";
import RegisterSiteSW from "@/components/RegisterSiteSW";

// Self-hosted by next/font, so there is no render-blocking request to Google and
// no flash of unstyled text. Both faces are exposed as CSS vars for globals.css.
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--serif",
});

const sans = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--sans",
});

export const metadata = {
  metadataBase: new URL("https://noisette.id"),
  title: {
    default: "Noisette Patissier, patisserie moderne in Malang",
    template: "%s | Noisette Patissier",
  },
  description:
    "A small patisserie on Jalan Bondowoso. Everything is baked the morning you collect it, so the numbers are small and the day sells out.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Noisette",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale and no userScalable:false. Pinch zoom stays available.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f2e6" },
    { media: "(prefers-color-scheme: dark)", color: "#181008" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={`${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint. Without this the page
          paints light, then snaps to dark once ThemeToggle mounts.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("noisette-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <RegisterSiteSW />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
