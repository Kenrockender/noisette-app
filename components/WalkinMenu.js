"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import ThemeToggle from "./ThemeToggle";
import { rp } from "@/lib/format";
import { HOUSES } from "@/lib/store/catalog";

/*
 * THE MENU (walk-in sales).
 *
 * A customer standing at the counter right now, not a pre-order for a future
 * pickup day. Staff taps through it like a POS: pick items, confirm, done —
 * paid and handed over in the same motion. It draws from today's actual
 * daily_inventory row (today, not the pre-order horizon which starts
 * tomorrow), through the same createWalkinSale path /admin used to expose
 * directly. See [[noisette-three-surfaces]]: this is a fourth thing, staff
 * tooling like /admin, just shaped like a menu instead of a table.
 */

const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function WalkinMenu() {
  const [authed, setAuthed] = useState(null); // null = checking
  const [demoPin, setDemoPin] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [day, setDay] = useState(null);
  const [qtys, setQtys] = useState({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch("/api/staff/session")
      .then((r) => r.json())
      .then((d) => { setAuthed(!!d.authed); setDemoPin(d.demoPin || ""); })
      .catch(() => setAuthed(false));
  }, []);

  const load = () => {
    fetch(`/api/admin/day?date=${todayIso()}`)
      .then((r) => {
        if (r.status === 401) { setAuthed(false); throw new Error("staff_only"); }
        return r.json();
      })
      .then(setDay)
      .catch(() => {});
  };

  useEffect(() => { if (authed) load(); }, [authed]);

  const signIn = async () => {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/staff/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "rate_limited") setErr("Terlalu banyak percobaan. Tunggu lima belas menit.");
        else if (d.error === "not_configured") setErr("STAFF_PIN belum diatur di deployment ini, jadi tidak ada yang bisa masuk. Itu disengaja.");
        else setErr("PIN salah.");
        return;
      }
      setPin("");
      setAuthed(true);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/staff/session", { method: "DELETE" });
    setDay(null);
    setAuthed(false);
  };

  const bump = (productId, delta, max) => {
    setConfirming(false); // cart changed, any pending confirmation is stale
    setQtys((q) => {
      const n = Math.max(0, Math.min(max, (q[productId] || 0) + delta));
      return { ...q, [productId]: n };
    });
  };

  const lines = (day?.inventory ?? [])
    .map((r) => ({ productId: r.productId, name: r.name, unitPrice: r.price, qty: qtys[r.productId] || 0 }))
    .filter((l) => l.qty > 0);
  const total = lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);

  const recordSale = async () => {
    setBusy(true);
    setErr("");
    setOkMsg("");
    try {
      const res = await fetch("/api/admin/walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: todayIso(),
          items: lines.map(({ productId, qty }) => ({ productId, qty })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "insufficient_stock") setErr("Stok tidak cukup untuk mencatat penjualan itu.");
        else setErr("Penjualan itu belum tercatat.");
        return;
      }
      setQtys({});
      setConfirming(false);
      setOkMsg(`Tercatat: ${data.order.id} · ${rp(data.order.total)}`);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (authed === null) {
    return (
      <div className="admin admin-loading">
        <p className="micro">Memeriksa</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="admin">
        <header className="admin-bar">
          <div className="admin-bar-id">
            <Link href="/" className="brand brand-sm">NOISETTE</Link>
            <span className="admin-tagname">Menu toko</span>
          </div>
          <ThemeToggle />
        </header>
        <main id="main" className="admin-gate">
          <h1 className="admin-gate-h">Masuk staf</h1>
          <p className="admin-hint">
            Menu ini mencatat penjualan langsung ke pelanggan yang sedang di
            toko. PIN sama dengan konter.
          </p>
          {demoPin && (
            <p className="warn" role="note">
              <Icon name="alert" size={16} />
              <span>Build demo. PIN-nya <b>{demoPin}</b>. Di produksi PIN datang dari STAFF_PIN dan petunjuk ini tidak ada.</span>
            </p>
          )}
          {err && (
            <p className="err" role="alert">
              <Icon name="alert" size={16} />
              {err}
            </p>
          )}
          <div className="field">
            <label htmlFor="staff-pin">PIN</label>
            <input
              id="staff-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pin.trim() && signIn()}
              placeholder="******"
            />
          </div>
          <button type="button" className="btn" disabled={!pin.trim() || busy} onClick={signIn}>
            {busy ? "Memeriksa" : "Masuk"}
          </button>
        </main>
      </div>
    );
  }

  if (!day) {
    return (
      <div className="admin admin-loading">
        <p className="micro">Memuat menu</p>
      </div>
    );
  }

  return (
    <div className="admin walkin-menu-page">
      <header className="admin-bar">
        <div className="admin-bar-id">
          <Link href="/" className="brand brand-sm">NOISETTE</Link>
          <span className="admin-tagname">Menu toko</span>
        </div>
        <div className="admin-bar-actions">
          <ThemeToggle />
          <button type="button" className="iconbtn" onClick={signOut} aria-label="Keluar">
            <Icon name="lock" size={18} />
          </button>
        </div>
      </header>

      <main id="main" className="admin-main walkin-menu-main">
        {err && (
          <p className="err" role="alert">
            <Icon name="alert" size={16} />
            {err}
          </p>
        )}
        {okMsg && (
          <p className="walkin-ok" role="status">
            <Icon name="check" size={16} />
            {okMsg}
          </p>
        )}

        {Object.values(HOUSES).map((house) => {
          const rows = day.inventory.filter((r) => r.house === house.id);
          if (rows.length === 0) return null;
          return (
            <section key={house.id} className="walkin-house">
              <h2 className="admin-h3">{house.name}</h2>
              <ul className="walkin-rows">
                {rows.map((r) => (
                  <li key={r.productId} className={`walkin-row ${r.retailAvailable === 0 ? "row-out" : ""}`}>
                    <span className="walkin-row-name">
                      {r.name}
                      <small>
                        {rp(r.price)}
                        {r.retailAvailable === 0 ? <> · habis</> : <> · sisa {r.retailAvailable}</>}
                      </small>
                    </span>
                    <span className="walkin-stepper">
                      <button
                        type="button"
                        className="walkin-step"
                        disabled={busy || !qtys[r.productId]}
                        aria-label={`Kurangi ${r.name}`}
                        onClick={() => bump(r.productId, -1, r.retailAvailable)}
                      >
                        <Icon name="minus" size={14} />
                      </button>
                      <span className="walkin-qty">{qtys[r.productId] || 0}</span>
                      <button
                        type="button"
                        className="walkin-step"
                        disabled={busy || r.retailAvailable === 0 || (qtys[r.productId] || 0) >= r.retailAvailable}
                        aria-label={`Tambah ${r.name}`}
                        onClick={() => bump(r.productId, 1, r.retailAvailable)}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>

      {lines.length > 0 && (
        <div className="walkin-cartbar">
          {confirming ? (
            <>
              <span className="walkin-cartbar-total">{rp(total)}, catat?</span>
              <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Batal
              </button>
              <button type="button" className="btn" disabled={busy} onClick={recordSale}>
                {busy ? "Mencatat" : "Ya, catat"}
              </button>
            </>
          ) : (
            <>
              <span className="walkin-cartbar-count">{lines.reduce((a, l) => a + l.qty, 0)} item</span>
              <span className="walkin-cartbar-total">{rp(total)}</span>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(true)}>
                Catat penjualan
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
