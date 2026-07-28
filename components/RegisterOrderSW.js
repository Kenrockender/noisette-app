"use client";
import { useEffect } from "react";

export default function RegisterOrderSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/order-sw.js", { scope: "/order" }).catch(() => {
      // Ordering still works without it, just without the offline shell.
    });
  }, []);

  return null;
}
