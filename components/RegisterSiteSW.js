"use client";
import { useEffect } from "react";

export default function RegisterSiteSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // /admin and /order are separate products with their own service workers.
    // Mounted from the root layout, so guard here rather than register site-wide.
    if (location.pathname.startsWith("/admin") || location.pathname.startsWith("/order")) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The site still works without it, just without the offline shell.
    });
  }, []);

  return null;
}
