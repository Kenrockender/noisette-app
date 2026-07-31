"use client";
import { useEffect } from "react";

export default function RegisterSiteSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // /admin, /order (the counter walk-in menu) and /pre-order are separate
    // products, /pre-order with its own service worker. Mounted from the root
    // layout, so guard here rather than register site-wide.
    if (
      location.pathname.startsWith("/admin") ||
      location.pathname.startsWith("/order") ||
      location.pathname.startsWith("/pre-order")
    )
      return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The site still works without it, just without the offline shell.
    });
  }, []);

  return null;
}
