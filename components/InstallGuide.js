"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";

/**
 * Install instructions for one of the three PWA shells (site, order, admin).
 * iOS only offers "Add to Home Screen" from Safari's share sheet — there is
 * no install prompt API there — so that platform always gets manual steps.
 * Android and desktop Chromium browsers fire beforeinstallprompt, so those
 * get a real one-tap button when the browser offers it, and the same manual
 * steps as a fallback otherwise (e.g. already dismissed once this session).
 */

function detectPlatform() {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Win|Mac|Linux/.test(navigator.platform || "") && !/Mobi/.test(ua)) return "desktop";
  return "other";
}

const STEPS = {
  ios: {
    label: "iPhone / iPad (Safari)",
    items: [
      "Buka halaman ini di Safari (bukan Chrome — di iOS cuma Safari yang bisa pasang aplikasi ke layar utama).",
      "Ketuk ikon Share (kotak dengan panah ke atas) di bar bawah.",
      "Scroll dan ketuk “Add to Home Screen” / “Tambah ke Layar Utama”.",
      "Ketuk “Add” di pojok kanan atas.",
    ],
  },
  android: {
    label: "Android (Chrome)",
    items: [
      "Ketuk menu titik tiga di pojok kanan atas Chrome.",
      "Ketuk “Install app” atau “Add to Home screen”.",
      "Konfirmasi dengan ketuk “Install”.",
    ],
  },
  desktop: {
    label: "Komputer (Chrome / Edge)",
    items: [
      "Cari ikon install (layar dengan panah turun) di ujung kanan address bar.",
      "Kalau tidak ada, buka menu titik tiga → “Install [nama aplikasi]…”.",
      "Konfirmasi di jendela yang muncul.",
    ],
  },
  other: {
    label: "Browser lain",
    items: [
      "Buka link ini di Chrome (Android/desktop) atau Safari (iPhone/iPad) — aplikasi lain seperti WhatsApp atau Instagram sering tidak bisa memasang aplikasi langsung dari browser bawaannya.",
      "Setelah terbuka di Chrome atau Safari, ikuti langkah untuk browser itu.",
    ],
  },
};

const ORDER = ["ios", "android", "desktop", "other"];

export default function InstallGuide({ appName, tagline, iconSrc }) {
  const [platform, setPlatform] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [promptResult, setPromptResult] = useState(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
      setInstalled(true);
    }
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setPromptResult(choice.outcome);
    setDeferredPrompt(null);
  };

  const ordered = platform ? [platform, ...ORDER.filter((p) => p !== platform)] : ORDER;

  return (
    <div className="install-guide">
      <div className="install-guide-head">
        {iconSrc && <img src={iconSrc} alt="" width={56} height={56} className="install-guide-icon" />}
        <div>
          <p className="install-guide-app">{appName}</p>
          {tagline && <p className="install-guide-tagline">{tagline}</p>}
        </div>
      </div>

      {installed && (
        <p className="install-guide-done">
          <Icon name="check" size={16} />
          Sudah terpasang di perangkat ini.
        </p>
      )}

      {!installed && deferredPrompt && (
        <button type="button" className="btn" onClick={promptInstall}>
          Pasang aplikasi
        </button>
      )}

      {!installed && promptResult === "dismissed" && (
        <p className="install-guide-hint">Belum dipasang. Ikuti langkah manual di bawah kapan saja.</p>
      )}

      <div className="install-guide-steps">
        {ordered.map((p, i) => (
          <details key={p} className="install-guide-detail" open={i === 0}>
            <summary>{STEPS[p].label}</summary>
            <ol>
              {STEPS[p].items.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </div>
  );
}
