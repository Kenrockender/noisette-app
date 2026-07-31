"use client";
import { useEffect } from "react";

export default function RegisterPreOrderSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/pre-order-sw.js", { scope: "/pre-order" }).catch(() => {
      // Ordering still works without it, just without the offline shell.
    });
  }, []);

  return null;
}
