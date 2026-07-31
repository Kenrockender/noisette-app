"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { rp, dayLabel } from "@/lib/format";

const CAKE_LABEL = {
  enquiry: "Brief terkirim",
  quoted: "Sudah ditawar",
  deposit_paid: "DP dibayar",
  in_production: "Sedang dibuat",
  ready: "Siap diambil",
  collected: "Sudah diambil",
  declined: "Ditolak",
};
const CAKE_PILL = {
  ready: "pill-ready",
  collected: "pill-collected",
  declined: "pill-out",
};

const ORDER_LABEL = {
  paid: "dibayar",
  preparing: "disiapkan",
  ready: "siap",
  collected: "diambil",
  cancelled: "dibatalkan",
};

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/**
 * Sign in, or the account panel if already signed in.
 *
 * Two steps: number, then code. Nothing else. There is no password, no email,
 * no name field on the way in. The number is already on every order, so asking
 * for it again is the smallest possible ask.
 *
 * Guest checkout is untouched by all of this. Nobody is ever made to sign in to
 * buy a croissant.
 */
export default function AccountSheet({ customer, onClose, onSignedIn, onSignedOut }) {
  const [step, setStep] = useState("phone"); // phone | code
  const [wa, setWa] = useState("");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState(null);
  const [mine, setMine] = useState(null); // { reviews, reviewable }
  const [subs, setSubs] = useState(null); // weekly subscriptions
  const [cakes, setCakes] = useState(null); // bespoke commissions, this number's
  const [cakeErr, setCakeErr] = useState("");
  const [cancelling, setCancelling] = useState(null); // order id pending confirm
  const [cancelErr, setCancelErr] = useState("");
  const [editingSub, setEditingSub] = useState(null); // subscription id being edited
  const [subDraft, setSubDraft] = useState({ weekday: 0, qty: {} });
  const [endingSub, setEndingSub] = useState(null); // subscription id pending confirm
  const [subErr, setSubErr] = useState("");
  const [reviewing, setReviewing] = useState(null); // { orderId, productId, name }
  const [rating, setRating] = useState(0);
  const [revBody, setRevBody] = useState("");
  const errRef = useRef(null);
  const codeRef = useRef(null);

  useEffect(() => { if (err && errRef.current) errRef.current.focus(); }, [err]);
  useEffect(() => { if (step === "code" && codeRef.current) codeRef.current.focus(); }, [step]);

  const loadMine = () =>
    fetch("/api/reviews?mine=1")
      .then((r) => (r.ok ? r.json() : { reviews: [], reviewable: [] }))
      .then(setMine);

  const loadSubs = () =>
    fetch("/api/account/subscriptions")
      .then((r) => (r.ok ? r.json() : { subscriptions: [] }))
      .then(setSubs);

  const loadCakes = () =>
    fetch("/api/commissions?mine=1")
      .then((r) => (r.ok ? r.json() : { commissions: [] }))
      .then((d) => setCakes(d.commissions));

  const payDeposit = async (id) => {
    setCakeErr(""); setBusy(true);
    try {
      const res = await fetch(`/api/commissions/${id}/pay`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "week_full") setCakeErr(`Minggu ${d.week} sudah penuh. Kami hubungi untuk atur ulang jadwalnya.`);
        else setCakeErr("DP-nya belum masuk. Coba lagi sebentar lagi.");
        return;
      }
      await loadCakes();
    } finally { setBusy(false); }
  };

  const loadOrders = () =>
    fetch("/api/account/orders")
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d) => setOrders(d.orders));

  useEffect(() => {
    if (!customer) { setOrders(null); setMine(null); setSubs(null); setCakes(null); return; }
    loadOrders();
    loadMine();
    loadSubs();
    loadCakes();
  }, [customer]);

  const cancelOrder = async (id) => {
    setCancelErr(""); setBusy(true);
    try {
      const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "too_late") setCancelErr("Sudah telat untuk batal: hari ambilnya sudah tiba. Bicara dengan konter, ya.");
        else if (d.error === "not_cancellable") setCancelErr("Pesanan itu sudah tidak bisa dibatalkan.");
        else setCancelErr("Pembatalannya belum berhasil. Coba lagi sebentar lagi.");
        return;
      }
      setCancelling(null);
      await loadOrders();
    } finally { setBusy(false); }
  };

  const subscribeFromOrder = async (o) => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/account/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekday: new Date(o.pickupDate + "T00:00:00Z").getUTCDay(),
          items: o.items.map((it) => ({ productId: it.productId, qty: it.qty })),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "retail_capacity")
          setErr(`${d.name} tidak selalu punya ${d.requested} lebih tiap minggu (hanya ${d.free} tersisa pada ${d.date}).`);
        else setErr("Belum bisa dijadikan pesanan mingguan.");
        return;
      }
      await loadSubs();
    } finally { setBusy(false); }
  };

  const toggleSub = async (s) => {
    setBusy(true);
    try {
      await fetch("/api/account/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, active: !s.active }),
      });
      await loadSubs();
    } finally { setBusy(false); }
  };

  const startEditSub = (s) => {
    setSubErr("");
    setEditingSub(s.id);
    setSubDraft({ weekday: s.weekday, qty: Object.fromEntries(s.items.map((it) => [it.productId, String(it.qty)])) });
  };

  const saveSubEdit = async (s) => {
    setSubErr(""); setBusy(true);
    try {
      const items = s.items
        .map((it) => ({ productId: it.productId, qty: Math.floor(Number(subDraft.qty[it.productId])) }))
        .filter((it) => Number.isFinite(it.qty) && it.qty > 0);
      if (items.length === 0) { setSubErr("Minimal satu item harus ada jumlahnya."); return; }
      const res = await fetch("/api/account/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, weekday: subDraft.weekday, items }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "retail_capacity")
          setSubErr(`${d.name} tidak selalu punya ${d.requested} lebih tiap minggu (hanya ${d.free} tersisa pada ${d.date}).`);
        else setSubErr("Perubahannya belum tersimpan.");
        return;
      }
      setEditingSub(null);
      await loadSubs();
    } finally { setBusy(false); }
  };

  const endSub = async (id) => {
    setBusy(true);
    try {
      await fetch(`/api/account/subscriptions?id=${id}`, { method: "DELETE" });
      setEndingSub(null);
      await loadSubs();
    } finally { setBusy(false); }
  };

  // Which lines can still be reviewed, and what happened to the ones that were.
  const canReview = (orderId, productId) =>
    mine?.reviewable.some((x) => x.orderId === orderId && x.productId === productId);
  const reviewOf = (orderId, productId) =>
    mine?.reviews.find((x) => x.orderId === orderId && x.productId === productId);

  const submitReview = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: reviewing.orderId, productId: reviewing.productId, rating, body: revBody }),
      });
      if (!res.ok) {
        setErr("Ulasannya belum tersimpan. Mungkin sudah ada untuk pesanan ini.");
        return;
      }
      setReviewing(null); setRating(0); setRevBody("");
      await loadMine();
    } finally { setBusy(false); }
  };

  const requestCode = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsapp: wa }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.error === "invalid_number") setErr("Sepertinya itu bukan nomor WhatsApp.");
        else if (d.error === "rate_limited") setErr("Terlalu banyak minta kode. Tunggu lima belas menit lalu coba lagi.");
        else if (d.error === "delivery_failed") setErr("Kode belum bisa dikirim. WhatsApp belum terhubung di build ini.");
        else setErr("Kode belum bisa dikirim.");
        return;
      }
      setDemoCode(d.demoCode || "");
      setStep("code");
    } finally { setBusy(false); }
  };

  const submitCode = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsapp: wa, code }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.error === "code_wrong")
          setErr(`Kodenya salah. Sisa ${d.attemptsLeft} percobaan.`);
        else if (d.error === "code_expired") setErr("Kodenya kedaluwarsa. Minta yang baru, ya.");
        else if (d.error === "too_many_attempts") setErr("Terlalu banyak percobaan. Minta kode baru.");
        else if (d.error === "no_code") setErr("Minta kode dulu.");
        else setErr("Belum bisa memasukkanmu.");
        return;
      }
      onSignedIn(d.customer, d.claimedOrders);
    } finally { setBusy(false); }
  };

  const signOut = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    onSignedOut();
  };

  const Err = () =>
    err ? (
      <p className="err" role="alert" tabIndex={-1} ref={errRef}>
        <Icon name="alert" size={16} />
        {err}
      </p>
    ) : null;

  return (
    <>
      <button type="button" className="sheetdim" aria-label="Tutup" onClick={onClose} />
      <aside className="sheet" aria-label={customer ? "Akunmu" : "Masuk"}>
        <div className="sheet-head">
          <h2 className="serif">{customer ? "Akunmu" : "Masuk"}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Tutup">
            <Icon name="close" />
          </button>
        </div>

        {customer ? (
          <>
            <div className="acct-id">
              <p className="acct-name">{customer.name || "Pelanggan Noisette"}</p>
              <p className="acct-wa">{customer.whatsapp} · masuk via WhatsApp</p>
              {customer.type === "wholesale" && <span className="pill pill-ready">Wholesale</span>}
            </div>

            {subs?.subscriptions.length > 0 && (
              <>
                <h3 className="acct-h3">Tiap minggu</h3>
                <ul className="acct-subs">
                  {subs.subscriptions.map((s) => (
                    <li key={s.id} className={`acct-sub ${s.active ? "" : "paused"}`}>
                      {editingSub === s.id ? (
                        <div className="acct-subedit">
                          <div className="ws-days" role="group" aria-label="Hari pengiriman">
                            {WEEKDAYS.map((name, i) => (
                              <button
                                key={name} type="button"
                                className={`daychip ${subDraft.weekday === i ? "on" : ""}`}
                                aria-pressed={subDraft.weekday === i}
                                onClick={() => setSubDraft((d) => ({ ...d, weekday: i }))}
                              >
                                {name.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                          {subErr && <p className="err" role="alert"><Icon name="alert" size={16} />{subErr}</p>}
                          <ul className="ws-solines">
                            {s.items.map((it) => (
                              <li key={it.productId} className="ws-soline">
                                <label htmlFor={`sub-${s.id}-${it.productId}`} className="ws-soline-name">{it.name}</label>
                                <input
                                  id={`sub-${s.id}-${it.productId}`}
                                  className="numin"
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={subDraft.qty[it.productId] ?? ""}
                                  onChange={(e) =>
                                    setSubDraft((d) => ({ ...d, qty: { ...d.qty, [it.productId]: e.target.value } }))
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                          <div className="acct-revform-btns">
                            <button type="button" className="btn btn-sm ghost" onClick={() => setEditingSub(null)}>Batal</button>
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => saveSubEdit(s)}>
                              {busy ? "Mengecek kapasitas" : "Simpan"}
                            </button>
                          </div>
                        </div>
                      ) : endingSub === s.id ? (
                        <div className="acct-subedit">
                          <p className="micro">Hentikan langganan ini selamanya? Tidak bisa dibatalkan.</p>
                          <div className="acct-revform-btns">
                            <button type="button" className="btn btn-sm ghost" onClick={() => setEndingSub(null)}>Biarkan</button>
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => endSub(s.id)}>
                              {busy ? "Menghentikan" : "Hentikan"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="acct-sub-main">
                            <b>Tiap {WEEKDAYS[s.weekday] ?? s.weekdayName}</b>
                            <small>
                              {s.items.map((it) => `${it.qty} ${it.name}`).join(", ")}, {rp(s.items.reduce((a, it) => a + it.unitPrice * it.qty, 0))}, bayar saat ambil
                            </small>
                          </div>
                          <div className="ws-soform-btns">
                            <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => startEditSub(s)}>
                              Ubah
                            </button>
                            <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => toggleSub(s)}>
                              {s.active ? "Jeda" : "Lanjutkan"}
                            </button>
                            <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => setEndingSub(s.id)}>
                              Hentikan
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {cakes?.length > 0 && (
              <>
                <h3 className="acct-h3">Kue custom-mu</h3>
                {cakeErr && <p className="err" role="alert"><Icon name="alert" size={16} />{cakeErr}</p>}
                <ul className="acct-cakes">
                  {cakes.map((c) => (
                    <li key={c.id} className="acct-cake">
                      <div className="acct-cake-top">
                        <span className="acct-cake-date">Dibutuhkan {dayLabel(c.neededOn)}</span>
                        <span className={`pill ${CAKE_PILL[c.status] || "pill-preparing"}`}>
                          {CAKE_LABEL[c.status] || c.status}
                        </span>
                      </div>
                      <p className="acct-cake-brief">{c.brief}</p>
                      {c.quoteIdr != null && (
                        <p className="acct-cake-price">
                          Penawaran {rp(c.quoteIdr)}
                          {c.depositIdr != null && c.status === "quoted" && ` — DP ${rp(c.depositIdr)} menunggu`}
                        </p>
                      )}
                      <div className="acct-order-foot">
                        <span>{c.id}</span>
                        {c.status === "quoted" && c.depositIdr != null && (
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => payDeposit(c.id)}>
                            {busy ? "Mengirim" : `Bayar DP, ${rp(c.depositIdr)}`}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3 className="acct-h3">Riwayat pesanan</h3>
            {cancelErr && <p className="err" role="alert"><Icon name="alert" size={16} />{cancelErr}</p>}
            {orders === null && <p className="sheet-empty">Memuat</p>}
            {orders?.length === 0 && <p className="sheet-empty">Belum ada pesanan.</p>}
            {orders?.length > 0 && (
              <ul className="acct-orders">
                {orders.map((o) => (
                  <li key={o.id} className="acct-order">
                    <div className="acct-order-top">
                      <span className="acct-order-date">{dayLabel(o.pickupDate)}, {o.slotTime}</span>
                      <span className={`pill pill-${o.status}`}>{ORDER_LABEL[o.status] || o.status}</span>
                    </div>
                    <p className="acct-order-items">
                      {o.items.map((it) => `${it.qty} ${it.name}`).join(", ")}
                    </p>
                    <div className="acct-order-foot">
                      <span>{o.id}</span>
                      <span>{rp(o.total)}</span>
                    </div>

                    {["paid", "preparing", "ready"].includes(o.status) && (
                      cancelling === o.id ? (
                        <div className="acct-cancel-confirm">
                          <p className="micro">Batalkan pesanan ini dan kembalikan uangnya?</p>
                          <div className="acct-revform-btns">
                            <button type="button" className="btn btn-sm ghost" onClick={() => setCancelling(null)}>
                              Biarkan
                            </button>
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => cancelOrder(o.id)}>
                              {busy ? "Membatalkan" : "Batalkan & refund"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="linkbtn acct-cancel-link"
                          onClick={() => { setCancelErr(""); setCancelling(o.id); }}
                        >
                          Batalkan pesanan
                        </button>
                      )
                    )}

                    {/* Reviews attach to a line in a collected order, which is
                        why the buttons live here and nowhere else. */}
                    {o.status === "collected" && mine && (
                      <div className="acct-revrow">
                        {subs !== null && (
                          <button
                            type="button"
                            className="btn btn-sm ghost"
                            disabled={busy}
                            onClick={() => subscribeFromOrder(o)}
                          >
                            Ulangi tiap minggu
                          </button>
                        )}
                        {o.items.map((it) => {
                          const r = reviewOf(o.id, it.productId);
                          if (r) {
                            return (
                              <span key={it.productId} className={`pill ${r.status === "published" ? "pill-ready" : r.status === "rejected" ? "pill-out" : "pill-paid"}`}>
                                {it.name}: {r.status === "pending" ? "ditinjau" : r.status === "published" ? "tayang" : r.status === "rejected" ? "ditolak" : r.status}
                              </span>
                            );
                          }
                          if (!canReview(o.id, it.productId)) return null;
                          return (
                            <button
                              key={it.productId}
                              type="button"
                              className="btn btn-sm ghost"
                              onClick={() => { setReviewing({ orderId: o.id, productId: it.productId, name: it.name }); setRating(0); setRevBody(""); setErr(""); }}
                            >
                              Ulas {it.name}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {reviewing?.orderId === o.id && (
                      <div className="acct-revform">
                        <p className="micro">{reviewing.name}</p>
                        <div className="ratepick" role="radiogroup" aria-label="Nilai">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              role="radio"
                              aria-checked={rating === n}
                              aria-label={`${n} bintang`}
                              className={`ratestar ${rating >= n ? "on" : ""}`}
                              onClick={() => setRating(n)}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <Err />
                        <textarea
                          className="revtext"
                          rows={3}
                          maxLength={800}
                          placeholder="Gimana rasanya? (opsional)"
                          value={revBody}
                          onChange={(e) => setRevBody(e.target.value)}
                        />
                        <div className="acct-revform-btns">
                          <button type="button" className="btn btn-sm ghost" onClick={() => setReviewing(null)}>Batal</button>
                          <button type="button" className="btn btn-sm" disabled={!rating || busy} onClick={submitReview}>
                            {busy ? "Mengirim" : "Kirim ulasan"}
                          </button>
                        </div>
                        <p className="note">Staf membaca setiap ulasan sebelum tayang di menu.</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <button type="button" className="btn ghost" onClick={signOut}>Keluar</button>
            <Link href="/pre-order/install" className="linkbtn acct-install-link">
              Pasang aplikasi order ke layar utama
            </Link>
          </>
        ) : step === "phone" ? (
          <>
            <p className="acct-lede">
              Kami kirim kode ke WhatsApp-mu. Tanpa password, dan riwayat
              pesananmu ikut serta.
            </p>
            <Err />
            <div className="field">
              <label htmlFor="a-wa">Nomor WhatsApp</label>
              <input
                id="a-wa"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={wa}
                onChange={(e) => setWa(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && wa.trim() && requestCode()}
                placeholder="08xx xxxx xxxx"
              />
            </div>
            <button type="button" className="btn" disabled={!wa.trim() || busy} onClick={requestCode}>
              {busy ? "Mengirim" : "Kirim kode"}
            </button>
            <p className="note">Tetap bisa pesan sebagai tamu. Ini opsional.</p>
          </>
        ) : (
          <>
            <p className="acct-lede">Masukkan enam digit yang kami kirim ke {wa}.</p>

            {/* Loud on purpose. This build cannot send WhatsApp messages yet. */}
            {demoCode && (
              <p className="warn" role="note">
                <Icon name="alert" size={16} />
                <span>
                  Build demo, tidak ada yang terkirim. Kodemu <b>{demoCode}</b>.
                  Di produksi, kode ini hanya datang lewat WhatsApp.
                </span>
              </p>
            )}

            <Err />
            <div className="field">
              <label htmlFor="a-code">Kode</label>
              <input
                id="a-code"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && code.length === 6 && submitCode()}
                placeholder="123456"
              />
            </div>
            <button type="button" className="btn" disabled={code.length !== 6 || busy} onClick={submitCode}>
              {busy ? "Mengecek" : "Masuk"}
            </button>
            <button
              type="button"
              className="linkbtn"
              onClick={() => { setStep("phone"); setCode(""); setErr(""); setDemoCode(""); }}
            >
              Pakai nomor lain
            </button>
          </>
        )}
      </aside>
    </>
  );
}
