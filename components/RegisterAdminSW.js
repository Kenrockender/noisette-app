"use client";
import { useEffect } from "react";

export default function RegisterAdminSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" }).catch(() => {
      // Counter still works without it, just without the offline shell.
    });
  }, []);

  return null;
}
