"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import ThemeToggle from "./ThemeToggle";
import { rp, dayLabel, dayShort } from "@/lib/format";

/*
 * THE BACK OF HOUSE.
 *
 * The third surface, and the only one with no charm in it at all. The website
 * sells the bakery, the app sells pastries, this counts them. Nobody browsing
 * this has to be persuaded of anything, so: no serif, no photography, no
 * romance, tabular numerals everywhere, and rows dense enough to see a whole
 * trading day at once.
 *
 * It is built for a tablet propped by the pass, which is why the fulfillment
 * buttons are oversized. Staff hit them with flour on their hands.
 */

const TABS = [
  { id: "fulfil", label: "Pesanan hari ini" },
  { id: "stock", label: "Stok & panggang" },
  { id: "slots", label: "Slot ambil" },
  { id: "wholesale", label: "Wholesale" },
  { id: "reviews", label: "Ulasan" },
  { id: "bespoke", label: "Bespoke" },
  { id: "outbox", label: "Outbox" },
];

const COMMISSION_LABEL = {
  enquiry: "Enquiry",
  quoted: "Ditawar",
  deposit_paid: "DP masuk",
  in_production: "Produksi",
  ready: "Siap",
  collected: "Diambil",
  declined: "Ditolak",
};
const COMMISSION_NEXT = {
  quoted: "DP diterima",
  deposit_paid: "Mulai produksi",
  in_production: "Tandai siap",
  ready: "Serahkan",
};

const REV_STATUSES = [
  { id: "pending", label: "Menunggu" },
  { id: "published", label: "Tayang" },
  { id: "rejected", label: "Ditolak" },
];

const STAGE_LABEL = { paid: "Dibayar", preparing: "Disiapkan", ready: "Siap", collected: "Diambil" };
const NEXT_LABEL = { paid: "Mulai siapkan", preparing: "Tandai siap", ready: "Serahkan" };

/** "08:00-10:00" from the API becomes "08.00–10.00" on screen. */
const slotLabel = (t) => (t || "").replace(/:/g, ".").replace("-", "–");

const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** Is this slot running right now, on this trading day? */
const slotIsNow = (date, time) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (date !== today) return false;
  const [a, b] = time.split("-");
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return hm >= a && hm < b;
};

/**
 * A number you can edit, that always tells the truth.
 *
 * This is controlled rather than a plain defaultValue input for one reason: when
 * the server refuses a change, the server's value has not moved, so nothing
 * about the props changes and an uncontrolled input would happily keep showing
 * the number that was just rejected. Staff would read a refused "1" as the real
 * allocation. On a rejected commit we put the true value back.
 */
function NumberCell({ id, label, value, min, disabled, onCommit }) {
  const [draft, setDraft] = useState(String(value));

  // Follow the server whenever it genuinely moves.
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = async () => {
    const n = Number(draft);
    if (draft.trim() === "" || Number.isNaN(n)) return setDraft(String(value));
    if (n === value) return;
    const ok = await onCommit(n);
    if (!ok) setDraft(String(value));
  };

  return (
    <>
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="numin"
        type="number"
        min={min}
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(String(value));
        }}
      />
    </>
  );
}

/** Quote input for one enquiry. Amounts in rupiah; deposit defaults to half. */
function QuoteForm({ busy, onQuote }) {
  const [quote, setQuote] = useState("");
  const [deposit, setDeposit] = useState("");
  return (
    <div className="quoteform">
      <input
        className="numin numin-wide"
        type="number"
        min={0}
        inputMode="numeric"
        aria-label="Penawaran dalam rupiah"
        placeholder="Penawaran (Rp)"
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
      />
      <input
        className="numin numin-wide"
        type="number"
        min={0}
        inputMode="numeric"
        aria-label="DP dalam rupiah, default setengah"
        placeholder="DP (setengah)"
        value={deposit}
        onChange={(e) => setDeposit(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy || !Number(quote)}
        onClick={() => onQuote(Number(quote), deposit === "" ? undefined : Number(deposit))}
      >
        Kirim penawaran
      </button>
    </div>
  );
}

export default function AdminDash() {
  const [day, setDay] = useState(null);
  const [tab, setTab] = useState("fulfil");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(null); // order id pending cancel confirm
  const [ws, setWs] = useState(null); // applications and standing orders
  const [rv, setRv] = useState(null); // review moderation queue
  const [revStatus, setRevStatus] = useState("pending"); // reviews tab: pending | published | rejected
  const [ob, setOb] = useState(null); // notification outbox
  const [authed, setAuthed] = useState(null); // null = checking
  const [demoPin, setDemoPin] = useState("");
  const [pin, setPin] = useState("");
  const [dl, setDl] = useState(null); // wholesale delivery run for the day
  const [bk, setBk] = useState(null); // bespoke commissions pipeline
  const [clock, setClock] = useState(() => new Date()); // the header clock
  const dateRef = useRef(null);

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  // Who is asking comes before what they are asking for.
  useEffect(() => {
    fetch("/api/staff/session")
      .then((r) => r.json())
      .then((d) => { setAuthed(!!d.authed); setDemoPin(d.demoPin || ""); })
      .catch(() => setAuthed(false));
  }, []);

  const load = useCallback((date) => {
    const d = date ?? dateRef.current;
    return fetch("/api/admin/day" + (d ? `?date=${d}` : ""))
      .then((r) => {
        if (r.status === 401) { setAuthed(false); throw new Error("staff_only"); }
        return r.json();
      })
      .then((data) => {
        dateRef.current = data.date;
        setDay(data);
        return data;
      })
      .catch(() => {});
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  // The delivery run follows the trading day. Re-fetched whenever the day is,
  // so the 15-second fulfillment poll keeps it honest too.
  useEffect(() => {
    if (!authed || !day?.date) return;
    fetch(`/api/admin/deliveries?date=${day.date}`)
      .then((r) => r.json())
      .then((d) => setDl(d.deliveries || []))
      .catch(() => {});
  }, [authed, day]);

  const advanceDeliveryRow = async (d) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/deliveries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standingOrderId: d.standingOrderId, date: d.date }),
      });
      if (!res.ok) setErr("Kiriman itu belum bisa maju tahap.");
      await load();
    } finally {
      setBusy(false);
    }
  };

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
    setDay(null); setWs(null); setRv(null); setOb(null);
    setAuthed(false);
  };

  // Wholesale is not day-scoped, so it loads on its own, when the tab opens.
  const loadWs = useCallback(() => {
    return fetch("/api/admin/wholesale").then((r) => r.json()).then(setWs);
  }, []);

  useEffect(() => { if (tab === "wholesale" && authed) loadWs(); }, [tab, authed, loadWs]);

  const loadRv = useCallback((status) => {
    return fetch(`/api/admin/reviews?status=${status}`).then((r) => r.json()).then(setRv);
  }, []);
  useEffect(() => { if (tab === "reviews" && authed) loadRv(revStatus); }, [tab, authed, revStatus, loadRv]);

  // Opening the outbox drains the queue: this GET is the demo's worker.
  const loadOb = useCallback(() => {
    return fetch("/api/admin/notifications").then((r) => r.json()).then(setOb);
  }, []);
  useEffect(() => { if (tab === "outbox" && authed) loadOb(); }, [tab, authed, loadOb]);

  const loadBk = useCallback(() => {
    return fetch("/api/admin/commissions").then((r) => r.json()).then(setBk);
  }, []);
  useEffect(() => { if (tab === "bespoke" && authed) loadBk(); }, [tab, authed, loadBk]);

  const patchCommission = async (body, failMsg) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/commissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "week_full")
          setErr(`Minggu ${d.week} sudah penuh: ${d.booked} dari ${d.max} kue terisi. Naikkan kapasitas minggunya atau tolak.`);
        else if (d.error === "below_committed")
          setErr(`Tidak bisa turun di bawah ${d.committed}; sebanyak itu DP sudah masuk untuk minggu itu.`);
        else if (d.error === "no_deposit")
          setErr("Komisi ini belum punya nominal DP. Tolak lalu tawar ulang dengan DP.");
        else setErr(failMsg || "Perubahan itu belum tersimpan.");
      }
      await loadBk();
    } finally {
      setBusy(false);
    }
  };

  const decideReview = async (id, publish) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, publish }),
      });
      if (!res.ok) setErr("Keputusan itu belum tersimpan.");
      await loadRv(revStatus);
    } finally {
      setBusy(false);
    }
  };

  const retryNotification = async (id) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) setErr("Pesan itu belum bisa diantrekan ulang.");
      await loadOb();
    } finally {
      setBusy(false);
    }
  };

  const decide = async (customerId, approve) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/wholesale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, approve }),
      });
      if (!res.ok) setErr("Keputusan itu belum tersimpan.");
      await loadWs();
    } finally {
      setBusy(false);
    }
  };

  // The pass needs to see new orders without anyone thinking to refresh.
  useEffect(() => {
    if (tab !== "fulfil") return;
    const iv = setInterval(() => load(), 15000);
    return () => clearInterval(iv);
  }, [tab, load]);

  if (authed === null) {
    return (
      <div className="admin admin-loading">
        <p className="micro">Memeriksa</p>
      </div>
    );
  }

  // The gate. Nothing about the day is fetched, let alone shown, before this.
  if (!authed) {
    return (
      <div className="admin">
        <header className="admin-bar">
          <div className="admin-bar-id">
            <Link href="/" className="brand brand-sm">NOISETTE</Link>
            <span className="admin-tagname">Konter</span>
          </div>
          <ThemeToggle />
        </header>
        <main id="main" className="admin-gate">
          <h1 className="admin-gate-h">Masuk staf</h1>
          <p className="admin-hint">
            Konter mengubah alokasi dan menyerahkan pesanan, jadi ia bertanya
            dulu siapa kamu. PIN diatur oleh yang menjalankan deployment.
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
        <p className="micro">Memuat hari ini</p>
      </div>
    );
  }

  const mutate = async (url, body, method = "PATCH") => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "below_committed")
          setErr(`Tidak bisa mengalokasikan di bawah ${data.committed}. Sebanyak itu sudah terjual atau ditahan untuk tanggal ini.`);
        else if (data.error === "below_booked")
          setErr(`Kapasitas tidak bisa turun di bawah ${data.booked}. Jendela itu sudah punya ${data.booked} pesanan.`);
        else if (data.error === "cannot_go_backwards") setErr("Pesanan tidak bisa mundur tahap.");
        else if (data.error === "too_late") setErr("Sudah telat untuk batal: hari ambilnya sudah tiba.");
        else if (data.error === "not_cancellable") setErr("Pesanan itu sudah tidak bisa dibatalkan.");
        else setErr("Perubahan itu belum tersimpan.");
        await load();
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const t = day.totals;

  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="admin-bar-id">
          <Link href="/" className="brand brand-sm">NOISETTE</Link>
          <span className="admin-tagname">Konter</span>
        </div>
        <div className="admin-bar-actions">
          <button
            type="button"
            className="iconbtn"
            onClick={() => load()}
            aria-label="Muat ulang"
            disabled={busy}
          >
            <Icon name="refresh" />
          </button>
          <ThemeToggle />
          <span className="admin-bar-clock">
            {dayLabel(day.date)} ·{" "}
            {clock.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(/[:.]/, ".")}
          </span>
          <span className="admin-bar-staff">
            <span className="admin-staff-dot" aria-hidden="true" />
            Kasir 1
          </span>
          <button type="button" className="iconbtn" onClick={signOut} aria-label="Keluar">
            <Icon name="lock" size={18} />
          </button>
        </div>
      </header>

      <div className="admin-dates">
        <p className="micro" id="trading-day">Hari dagang</p>
        <ul className="daterail" aria-labelledby="trading-day">
          {day.dates.map((d) => (
            <li key={d}>
              <button
                type="button"
                className={`daychip ${day.date === d ? "on" : ""}`}
                aria-pressed={day.date === d}
                onClick={() => load(d)}
              >
                <small>{dayShort(d)}</small>
                {d.slice(8)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <main id="main" className="admin-main">
        <dl className="stats">
          <div className="stat">
            <dt>Pesanan</dt>
            <dd>{t.orders}</dd>
          </div>
          <div className="stat">
            <dt>Omzet</dt>
            <dd>{rp(t.revenue)}</dd>
          </div>
          <div className="stat">
            <dt>Unit terjual</dt>
            <dd>
              {t.unitsSold}
              <small>dari {t.allocated}</small>
            </dd>
          </div>
          <div className="stat">
            <dt>Terserap</dt>
            <dd>{t.sellThrough}%</dd>
          </div>
          <div className="stat">
            <dt>Belum diserahkan</dt>
            <dd className={t.awaitingCollection ? "hot" : ""}>{t.awaitingCollection}</dd>
          </div>
        </dl>

        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`tab-${x.id}`}
              aria-selected={tab === x.id}
              aria-controls={`panel-${x.id}`}
              className={`tab ${tab === x.id ? "on" : ""}`}
              onClick={() => { setTab(x.id); setErr(""); }}
            >
              {x.label}
            </button>
          ))}
        </div>

        {err && (
          <p className="err" role="alert">
            <Icon name="alert" size={16} />
            {err}
          </p>
        )}

        {tab === "fulfil" && (
          <section role="tabpanel" id="panel-fulfil" aria-labelledby="tab-fulfil">
            {day.orders.length === 0 ? (
              <p className="admin-empty">Belum ada pesanan terbayar untuk {dayLabel(day.date)}.</p>
            ) : (
              [...new Set(day.orders.map((o) => o.slotTime))].sort().map((sl) => {
                const inSlot = day.orders.filter((o) => o.slotTime === sl);
                const now = slotIsNow(day.date, sl);
                return (
                  <section key={sl} className="slotgroup">
                    <div className="slotgroup-head">
                      <h2 className={`slotgroup-h ${now ? "now" : ""}`}>{slotLabel(sl)}</h2>
                      {now && <span className="nowpill">Sedang berjalan</span>}
                      <span className="slotgroup-count">{inSlot.length} pesanan</span>
                    </div>
                    <ul className="tickets">
                      {inSlot.map((o) => (
                        <li key={o.id} className={`ticket stage-${o.status}`}>
                          <div className="ticket-head">
                            <p className="ticket-who">
                              {o.customer.name}
                              <small>{o.customer.whatsapp}</small>
                            </p>
                            <span className={`pill pill-${o.status}`}>{STAGE_LABEL[o.status]}</span>
                          </div>
                          <ul className="ticket-items">
                            {o.items.map((it) => (
                              <li key={it.productId}>
                                <b>{it.qty}</b> {it.name}
                              </li>
                            ))}
                            {o.giftWrap && <li className="ticket-wrap">Bungkus kado</li>}
                          </ul>
                          <div className="ticket-foot">
                            <span className="ticket-no">{o.id}</span>
                            <span className="ticket-total">{rp(o.total)}</span>
                          </div>
                          {NEXT_LABEL[o.status] ? (
                            cancellingOrder === o.id ? (
                              <div className="ticket-cancel-confirm">
                                <p className="micro">Batalkan dan refund {o.id}?</p>
                                <div className="approw-btns">
                                  <button type="button" className="btn btn-sm ghost" onClick={() => setCancellingOrder(null)}>
                                    Biarkan
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busy}
                                    onClick={async () => {
                                      if (await mutate(`/api/admin/orders/${o.id}`, {}, "DELETE")) setCancellingOrder(null);
                                    }}
                                  >
                                    Batalkan & refund
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="ticket-btnrow">
                                <button
                                  type="button"
                                  className={`btn ticket-go ${o.status === "ready" ? "ticket-go-ready" : ""}`}
                                  disabled={busy}
                                  onClick={() => mutate(`/api/admin/orders/${o.id}`, {})}
                                >
                                  {NEXT_LABEL[o.status]}
                                </button>
                                <button
                                  type="button"
                                  className="linkbtn ticket-cancel-link"
                                  disabled={busy}
                                  onClick={() => setCancellingOrder(o.id)}
                                >
                                  Batalkan & refund
                                </button>
                              </div>
                            )
                          ) : (
                            <p className="ticket-done">
                              <Icon name="check" size={15} />
                              Sudah diambil
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}

            {/* The delivery run. Same oversized buttons as the tickets, same
                flour-covered hands. */}
            {dl?.length > 0 && (
              <>
                <h3 className="admin-h3">Kiriman wholesale — keluar 07.30</h3>
                <ul className="tickets">
                  {dl.map((d) => (
                    <li key={`${d.standingOrderId}:${d.date}`} className={`ticket ${d.skipped ? "ticket-skip" : `stage-${d.stage}`}`}>
                      <div className="ticket-head">
                        <p className="ticket-who">
                          {d.businessName}
                          {d.address && <small>{d.address}</small>}
                        </p>
                        <span className={`pill ${d.skipped ? "pill-out" : d.stage === "delivered" ? "pill-collected" : d.stage === "packed" ? "pill-ready" : "pill-paid"}`}>
                          {d.skipped ? "Dilewati" : d.stage === "pending" ? "Belum dikemas" : d.stage === "packed" ? "Dikemas" : "Terkirim"}
                        </span>
                      </div>
                      <ul className="ticket-items">
                        {d.items.map((it) => (
                          <li key={it.productId}><b>{it.qty}</b> {it.name}</li>
                        ))}
                      </ul>
                      <div className="ticket-foot">
                        <span className="ticket-no">{d.standingOrderId}</span>
                        <span className="ticket-total">{d.skipped ? "—" : rp(d.total)}</span>
                      </div>
                      {!d.skipped && d.stage !== "delivered" && (
                        <button type="button" className="btn ticket-go" disabled={busy} onClick={() => advanceDeliveryRow(d)}>
                          {d.stage === "pending" ? "Tandai dikemas" : "Serahkan ke kurir"}
                        </button>
                      )}
                      {d.skipped && <p className="ticket-done">Pelanggan melewati kiriman ini. Jangan dipanggang.</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Subscribers pay at the counter, so these are reminders, not
                tickets: set the box aside before the case opens. */}
            {day.subscriptionPickups?.length > 0 && (
              <>
                <h3 className="admin-h3">Ambilan langganan — bayar di konter</h3>
                <ul className="subruns">
                  {day.subscriptionPickups.map((s) => (
                    <li key={`${s.standingOrderId}:${s.date}`} className="subrun">
                      <b>{s.name}</b>
                      <span>{s.items.map((it) => `${it.qty} ${it.name}`).join(", ")}</span>
                      <span className="subrun-amt">{rp(s.total)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {tab === "stock" && (
          <section role="tabpanel" id="panel-stock" aria-labelledby="tab-stock">
            <p className="admin-hint">
              Dua kolam terpisah untuk {dayLabel(day.date)}. Retail tidak bisa
              turun di bawah yang sudah terjual atau ditahan; wholesale tidak
              bisa turun di bawah yang sudah dijanjikan pesanan tetap. Keduanya
              tidak bisa saling pinjam. Panggang = jumlah keduanya — satu-satunya
              angka yang dapur butuhkan.
            </p>
            <div className="tablewrap">
              <table className="dtable">
                <caption className="visually-hidden">
                  Inventaris untuk {dayLabel(day.date)}, kolam retail dan wholesale
                </caption>
                <thead>
                  <tr className="grouprow">
                    <td />
                    <th scope="colgroup" colSpan={4} className="group group-retail">Retail</th>
                    <th scope="colgroup" colSpan={3} className="group group-ws">Wholesale</th>
                    <td />
                  </tr>
                  <tr>
                    <th scope="col">Produk</th>
                    <th scope="col" className="num">Jatah</th>
                    <th scope="col" className="num">Terjual</th>
                    <th scope="col" className="num">Ditahan</th>
                    <th scope="col" className="num">Sisa</th>
                    <th scope="col" className="num divide">Jatah</th>
                    <th scope="col" className="num">Dijanjikan</th>
                    <th scope="col" className="num">Bebas</th>
                    <th scope="col" className="num divide">Panggang</th>
                  </tr>
                </thead>
                <tbody>
                  {day.inventory.map((r) => (
                    <tr key={r.productId} className={r.retailAvailable === 0 ? "row-out" : ""}>
                      <th scope="row">
                        {r.name}
                        <small>{r.category}</small>
                      </th>

                      <td className="num">
                        <NumberCell
                          id={`alloc-${r.productId}`}
                          label={`Jatah retail untuk ${r.name}`}
                          value={r.retailAllocated}
                          min={r.retailSold + r.retailHeld + (r.retailSubscribed || 0)}
                          disabled={busy}
                          onCommit={(v) =>
                            mutate("/api/admin/inventory", {
                              date: day.date, productId: r.productId, allocated: v, pool: "retail",
                            })
                          }
                        />
                      </td>
                      <td className="num">{r.retailSold}</td>
                      <td className="num quiet">{r.retailHeld}</td>
                      <td className="num">
                        {r.retailAvailable === 0 ? <span className="pill pill-out">Habis</span> : r.retailAvailable}
                      </td>

                      {r.soldWholesale ? (
                        <>
                          <td className="num divide">
                            <NumberCell
                              id={`ws-${r.productId}`}
                              label={`Jatah wholesale untuk ${r.name}`}
                              value={r.wholesaleAllocated}
                              min={r.wholesaleCommitted}
                              disabled={busy}
                              onCommit={(v) =>
                                mutate("/api/admin/inventory", {
                                  date: day.date, productId: r.productId, allocated: v, pool: "wholesale",
                                })
                              }
                            />
                          </td>
                          <td className="num">{r.wholesaleCommitted}</td>
                          <td className="num quiet">{r.wholesaleFree}</td>
                        </>
                      ) : (
                        <td className="num divide quiet" colSpan={3}>Hanya retail</td>
                      )}

                      <td className="num divide bake">{r.toBake}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="admin-h3">Log audit, {dayLabel(day.date)}</h3>
            {day.inventoryLog.length === 0 ? (
              <p className="admin-empty">Belum ada pergerakan stok tercatat.</p>
            ) : (
              <div className="tablewrap">
                <table className="dtable">
                  <caption className="visually-hidden">Setiap pergerakan stok untuk {dayLabel(day.date)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Waktu</th>
                      <th scope="col">Produk</th>
                      <th scope="col">Kolam</th>
                      <th scope="col" className="num">Perubahan</th>
                      <th scope="col">Alasan</th>
                      <th scope="col">Pesanan</th>
                      <th scope="col">Aktor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.inventoryLog.map((r) => (
                      <tr key={r.id}>
                        <td>{new Date(r.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</td>
                        <td>{day.inventory.find((x) => x.productId === r.productId)?.name || r.productId}</td>
                        <td className="quiet">{r.pool}</td>
                        <td className={`num ${r.delta < 0 ? "delta-neg" : "delta-pos"}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                        <td>{r.reason.replace(/_/g, " ")}</td>
                        <td className="quiet">{r.orderId || "—"}</td>
                        <td className="quiet">{r.actor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "slots" && (
          <section role="tabpanel" id="panel-slots" aria-labelledby="tab-slots">
            <p className="admin-hint">
              Kapasitas = berapa pesanan yang bisa diterima tiap jendela.
              Menurunkannya di bawah yang sudah terisi akan ditolak sistem.
            </p>
            <ul className="slotrows">
              {day.slots.map((s) => {
                const full = s.bookedCount >= s.maxCapacity;
                return (
                  <li key={s.index} className="slotrow">
                    <span className="slotrow-time">{slotLabel(s.time)}</span>
                    <span className={`slotrow-load ${full ? "full" : ""}`}>
                      {s.bookedCount}/{s.maxCapacity} terisi{full ? " · penuh" : ""}
                    </span>
                    <span className="slotbar" aria-hidden="true">
                      <span
                        className={`slotbar-fill ${full ? "full" : ""}`}
                        style={{ width: `${s.maxCapacity ? Math.min(100, (s.bookedCount / s.maxCapacity) * 100) : 0}%` }}
                      />
                    </span>
                    <NumberCell
                      id={`cap-${s.index}`}
                      label={`Kapasitas untuk ${s.time}`}
                      value={s.maxCapacity}
                      min={s.bookedCount}
                      disabled={busy}
                      onCommit={(v) =>
                        mutate("/api/admin/slots", {
                          date: day.date,
                          slotIndex: s.index,
                          maxCapacity: v,
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {tab === "wholesale" && (
          <section role="tabpanel" id="panel-wholesale" aria-labelledby="tab-wholesale">
            <p className="admin-hint">
              Menyetujui aplikasi mengaktifkan harga trade dan kolam wholesale.
              Tidak ada yang bisa masuk sendiri. Penolakan hanya final sampai
              mereka mendaftar lagi.
            </p>

            <h3 className="admin-h3">Aplikasi</h3>
            {ws === null && <p className="admin-empty">Memuat</p>}
            {ws?.applications.length === 0 && <p className="admin-empty">Tidak ada yang menunggu ditinjau.</p>}
            {ws?.applications.length > 0 && (
              <ul className="applist">
                {ws.applications.map((a) => (
                  <li key={a.customerId} className="approw approw-app">
                    <div className="approw-who">
                      <b>Aplikasi baru: {a.businessName}</b>
                      <small>
                        {a.name || "Tanpa nama kontak"} · {a.whatsapp} · {a.address}
                        {a.npwp ? <> · NPWP {a.npwp}</> : null}
                      </small>
                    </div>
                    <div className="approw-btns">
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => decide(a.customerId, true)}>
                        Setujui
                      </button>
                      <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => decide(a.customerId, false)}>
                        Tolak
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="admin-h3">Pesanan tetap</h3>
            {ws?.standingOrders.length === 0 && <p className="admin-empty">Belum ada pesanan tetap.</p>}
            {ws?.standingOrders.length > 0 && (
              <div className="tablewrap">
                <table className="dtable">
                  <caption className="visually-hidden">Semua pesanan tetap, semua akun</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pesanan tetap</th>
                      <th scope="col">Tiap</th>
                      <th scope="col">Isi</th>
                      <th scope="col" className="num">Per kirim</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ws.standingOrders.map((s) => (
                      <tr key={s.id} className={s.active ? "" : "row-out"}>
                        <th scope="row">{s.businessName}<small>{s.id}</small></th>
                        <td>{WEEKDAYS_ID[s.weekday] ?? s.weekdayName}</td>
                        <td>{s.items.map((it) => `${it.qty} ${it.name}`).join(", ")}</td>
                        <td className="num">{rp(s.items.reduce((a, it) => a + it.unitPrice * it.qty, 0))}</td>
                        <td>
                          <span className={`pill ${s.active ? "pill-ready" : "pill-out"}`}>
                            {s.active ? "Aktif" : "Jeda"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "reviews" && (
          <section role="tabpanel" id="panel-reviews" aria-labelledby="tab-reviews">
            <p className="admin-hint">
              Setiap ulasan datang dari pesanan yang sudah diambil, dan tidak
              ada yang tayang di menu sebelum dibaca di sini. Tayangkan atau
              tolak; kata-kata pelanggan tidak bisa diedit.
            </p>
            <div className="tabs tabs-sm" role="tablist" aria-label="Review status">
              {REV_STATUSES.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={revStatus === x.id}
                  className={`tab ${revStatus === x.id ? "on" : ""}`}
                  onClick={() => setRevStatus(x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
            {rv === null && <p className="admin-empty">Memuat</p>}
            {rv?.reviews.length === 0 && (
              <p className="admin-empty">
                {revStatus === "pending"
                  ? "Tidak ada yang menunggu dibaca."
                  : revStatus === "published"
                    ? "Belum ada ulasan tayang."
                    : "Belum ada ulasan ditolak."}
              </p>
            )}
            {rv?.reviews.length > 0 && (
              <ul className="applist">
                {rv.reviews.map((r) => (
                  <li key={r.id} className={`approw ${revStatus !== "pending" ? "approw-done" : ""}`}>
                    <div className="approw-who">
                      <b>
                        {r.productName}
                        <span className="stars stars-admin" aria-label={`${r.rating} dari 5 bintang`}>
                          {" "}{"★".repeat(r.rating)}<span className="stars-off">{"★".repeat(5 - r.rating)}</span>
                        </span>
                      </b>
                      <small>
                        {r.author}, pesanan {r.orderId}
                        {r.body ? <><br />&ldquo;{r.body}&rdquo;</> : <><br />Tanpa teks, hanya nilai.</>}
                      </small>
                    </div>
                    {revStatus === "pending" ? (
                      <div className="approw-btns">
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => decideReview(r.id, true)}>
                          Tayangkan
                        </button>
                        <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => decideReview(r.id, false)}>
                          Tolak
                        </button>
                      </div>
                    ) : (
                      <p className="approw-status micro">{revStatus === "published" ? "Tayang" : "Ditolak"}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "bespoke" && (
          <section role="tabpanel" id="panel-bespoke" aria-labelledby="tab-bespoke">
            <p className="admin-hint">
              Bespoke hidup di luar stok harian. Kapasitas = kue per minggu,
              dan slot minggu baru terpakai saat DP masuk: tawar sebanyak
              apa pun enquiry, tombol DP satu-satunya yang bisa menolak.
              Lead time dua minggu ditegakkan di formulir.
            </p>

            <h3 className="admin-h3">Minggu-minggu ke depan</h3>
            <ul className="weekcaps">
              {(bk?.weeks ?? []).map((w) => (
                <li key={w.week} className={`weekcap ${w.booked >= w.max ? "full" : ""}`}>
                  <span className="weekcap-label">
                    Minggu {dayLabel(w.week)}
                    <small>{w.booked} dari {w.max} terisi</small>
                  </span>
                  <NumberCell
                    id={`wk-${w.week}`}
                    label={`Kapasitas kue untuk minggu ${w.week}`}
                    value={w.max}
                    min={w.booked}
                    disabled={busy}
                    onCommit={async (v) => {
                      await patchCommission({ week: w.week, maxCakes: v });
                      return true;
                    }}
                  />
                </li>
              ))}
            </ul>

            <h3 className="admin-h3">Pipeline</h3>
            {bk === null && <p className="admin-empty">Memuat</p>}
            {bk?.commissions.length === 0 && <p className="admin-empty">Belum ada enquiry.</p>}
            {bk?.commissions.length > 0 && (
              <ul className="applist">
                {bk.commissions.map((c) => (
                  <li key={c.id} className={`approw ${["collected", "declined"].includes(c.status) ? "approw-done" : ""}`}>
                    <div className="approw-who">
                      <b>
                        {c.name} <span className={`pill ${c.status === "declined" ? "pill-out" : c.status === "collected" ? "pill-collected" : "pill-paid"}`}>{COMMISSION_LABEL[c.status]}</span>
                      </b>
                      <small>
                        {dayLabel(c.neededOn)}{c.servings ? ` · ${c.servings} porsi` : ""} · {c.whatsapp} · {c.id}
                        {c.quoteIdr ? <><br />Penawaran {rp(c.quoteIdr)}{c.depositIdr ? `, DP ${rp(c.depositIdr)}` : ""}</> : null}
                        <br />&ldquo;{c.brief}&rdquo;
                      </small>
                    </div>
                    <div className="approw-btns approw-btns-col">
                      {c.status === "enquiry" && (
                        <QuoteForm busy={busy} onQuote={(quote, deposit) => patchCommission({ id: c.id, quote, deposit })} />
                      )}
                      {COMMISSION_NEXT[c.status] && (
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => patchCommission({ id: c.id, advance: true })}>
                          {COMMISSION_NEXT[c.status]}
                        </button>
                      )}
                      {["enquiry", "quoted"].includes(c.status) && (
                        <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => patchCommission({ id: c.id, decline: true })}>
                          Tolak
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "outbox" && (
          <section role="tabpanel" id="panel-outbox" aria-labelledby="tab-outbox">
            <p className="admin-hint">
              WhatsApp keluar. Pesan diantrekan oleh peristiwa yang terjadi dan
              dikirim oleh worker, tidak pernah inline, jadi gangguan WhatsApp
              tidak bisa menggagalkan pesanan yang uangnya sudah masuk. Membuka
              tab ini menjalankan worker sekali. Di produksi, pengiriman gagal
              tertutup sampai WhatsApp Business API dikonfigurasi, dan semuanya
              menunggu di sini.
            </p>
            {ob === null && <p className="admin-empty">Memuat</p>}
            {ob && (
              <>
                <p className="micro outbox-counts">
                  {ob.counts.queued} antre, {ob.counts.sent} terkirim, {ob.counts.failed} gagal
                </p>
                {ob.notifications.length === 0 && <p className="admin-empty">Belum ada yang perlu dikabarkan.</p>}
                {ob.notifications.length > 0 && (
                  <div className="tablewrap">
                    <table className="dtable">
                      <caption className="visually-hidden">Pesan WhatsApp keluar</caption>
                      <thead>
                        <tr>
                          <th scope="col">Kepada</th>
                          <th scope="col">Pesan</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="num">Percobaan</th>
                          <td />
                        </tr>
                      </thead>
                      <tbody>
                        {ob.notifications.map((n) => (
                          <tr key={n.id}>
                            <th scope="row">
                              +{n.whatsapp}
                              <small>{n.id}</small>
                            </th>
                            <td className="outbox-text">{n.text}</td>
                            <td>
                              <span className={`pill ${n.status === "sent" ? "pill-ready" : n.status === "failed" ? "pill-out" : "pill-paid"}`}>
                                {n.status === "sent" ? "terkirim" : n.status === "failed" ? "gagal" : "antre"}
                              </span>
                              {n.lastError && <small className="outbox-err">{n.lastError}</small>}
                            </td>
                            <td className="num">{n.attempts}</td>
                            <td>
                              {n.status === "failed" && (
                                <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => retryNotification(n.id)}>
                                  Coba lagi
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
