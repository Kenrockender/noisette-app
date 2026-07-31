"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import ThemeToggle from "./ThemeToggle";
import { rp, dayLabel } from "@/lib/format";

/*
 * THE WHOLESALE PORTAL (Noisette v2).
 *
 * The fourth surface. It borrows the app's chrome and the counter's tables,
 * because its user is somewhere between the two: a cafe owner planning a week,
 * not a customer craving a croissant and not staff at the pass.
 *
 * Everything here keys off /api/wholesale/me, which names one of three states:
 *
 *   anonymous   sign in first. Same OTP flow as the app, because a wholesale
 *               account IS a customer account with `type` flipped.
 *   retail      signed in but not approved. Show the application form, or the
 *               state of the application already sent.
 *   wholesale   the actual portal: price list, standing orders, delivery
 *               schedule.
 *
 * Prices are never rendered before approval. The server already refuses to
 * send them; this component simply has nowhere to show what it never gets.
 */

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/* ------------------------------------------------------------ sign in -- */

function SignIn({ onSignedIn }) {
  const [step, setStep] = useState("phone");
  const [wa, setWa] = useState("");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);

  useEffect(() => { if (step === "code" && codeRef.current) codeRef.current.focus(); }, [step]);

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
        if (d.error === "code_wrong") setErr(`Kodenya salah. Sisa ${d.attemptsLeft} percobaan.`);
        else if (d.error === "code_expired") setErr("Kodenya kedaluwarsa. Minta yang baru, ya.");
        else if (d.error === "too_many_attempts") setErr("Terlalu banyak percobaan. Minta kode baru.");
        else setErr("Belum bisa memasukkanmu.");
        return;
      }
      onSignedIn();
    } finally { setBusy(false); }
  };

  return (
    <section className="ws-panel">
      <h1 className="serif ws-h1">Wholesale</h1>
      <p className="ws-lede">
        Pesanan tetap untuk kafe dan restoran: jumlahmu, harimu, diantar dari
        dapur Bondowoso. Masuk dengan nomor WhatsApp yang dipakai bisnismu.
      </p>

      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}

      {step === "phone" ? (
        <>
          <div className="field">
            <label htmlFor="ws-wa">Nomor WhatsApp</label>
            <input
              id="ws-wa" type="tel" inputMode="tel" autoComplete="tel"
              value={wa}
              onChange={(e) => setWa(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && wa.trim() && requestCode()}
              placeholder="08xx xxxx xxxx"
            />
          </div>
          <button type="button" className="btn" disabled={!wa.trim() || busy} onClick={requestCode}>
            {busy ? "Mengirim" : "Kirim kode"}
          </button>
        </>
      ) : (
        <>
          <p className="ws-lede">Masukkan enam digit yang kami kirim ke {wa}.</p>
          {demoCode && (
            <p className="warn" role="note">
              <Icon name="alert" size={16} />
              <span>Build demo, tidak ada yang terkirim. Kodemu <b>{demoCode}</b>.</span>
            </p>
          )}
          <div className="field">
            <label htmlFor="ws-code">Kode</label>
            <input
              id="ws-code" ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && submitCode()}
              placeholder="123456"
            />
          </div>
          <button type="button" className="btn" disabled={code.length !== 6 || busy} onClick={submitCode}>
            {busy ? "Mengecek" : "Masuk"}
          </button>
          <button type="button" className="linkbtn" onClick={() => { setStep("phone"); setCode(""); setErr(""); setDemoCode(""); }}>
            Pakai nomor lain
          </button>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- apply form -- */

function Apply({ application, onApplied }) {
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [npwp, setNpwp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // An application already sent is a state, not a form.
  if (application?.status === "pending") {
    return (
      <section className="ws-panel">
        <h1 className="serif ws-h1">Aplikasi diterima</h1>
        <p className="ws-lede">
          <b>{application.businessName}</b> sedang kami tinjau. Setiap aplikasi
          dicek satu per satu, biasanya dalam dua hari kerja, dan kami kabari
          lewat WhatsApp apa pun hasilnya.
        </p>
      </section>
    );
  }

  const rejected = application?.status === "rejected";

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/wholesale/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, address, npwp }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.error === "missing_fields") setErr("Nama bisnis dan alamat kirim wajib diisi.");
        else if (d.error === "already_pending") setErr("Kamu sudah punya aplikasi yang sedang ditinjau.");
        else setErr("Aplikasinya belum terkirim.");
        return;
      }
      onApplied();
    } finally { setBusy(false); }
  };

  return (
    <section className="ws-panel">
      <h1 className="serif ws-h1">Buka akun wholesale</h1>
      <p className="ws-lede">
        Untuk kafe, restoran, dan hotel di sekitar Malang. Akun wholesale
        mendapat harga trade, pesanan tetap mingguan, dan antaran pagi. Setiap
        aplikasi kami tinjau satu per satu.
      </p>

      {rejected && (
        <p className="warn" role="note">
          <Icon name="alert" size={16} />
          <span>Aplikasi sebelumnya belum disetujui. Silakan daftar lagi.</span>
        </p>
      )}
      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}

      <div className="field">
        <label htmlFor="ws-biz">Nama bisnis</label>
        <input id="ws-biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Kopi Pagi Malang" />
      </div>
      <div className="field">
        <label htmlFor="ws-addr">Alamat kirim</label>
        <input id="ws-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. Ijen No.10, Malang" />
      </div>
      <div className="field">
        <label htmlFor="ws-npwp">NPWP (opsional)</label>
        <input id="ws-npwp" value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="Untuk faktur pajak" />
      </div>
      <button type="button" className="btn" disabled={!businessName.trim() || !address.trim() || busy} onClick={submit}>
        {busy ? "Mengirim" : "Daftar"}
      </button>
      <p className="note">Pesanan retail di /order tetap jalan sambil menunggu.</p>
    </section>
  );
}

/* --------------------------------------------------------- profile edit -- */

/**
 * The address was locked at application; this is the edit path a cafe needs
 * when it moves. Deliveries read the address live from the account, so a
 * change here takes effect from the next delivery without touching anything
 * already scheduled.
 */
function ProfileEdit({ customer, onSaved, onCancel }) {
  const [businessName, setBusinessName] = useState(customer.businessName || "");
  const [address, setAddress] = useState(customer.address || "");
  const [npwp, setNpwp] = useState(customer.npwp || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/wholesale/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, address, npwp }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error === "missing_fields") setErr("Nama bisnis dan alamat kirim wajib diisi.");
        else setErr("Perubahannya belum tersimpan.");
        return;
      }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="ws-soform">
      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}
      <div className="field">
        <label htmlFor="ws-edit-biz">Nama bisnis</label>
        <input id="ws-edit-biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ws-edit-addr">Alamat kirim</label>
        <input id="ws-edit-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ws-edit-npwp">NPWP (opsional)</label>
        <input id="ws-edit-npwp" value={npwp} onChange={(e) => setNpwp(e.target.value)} />
      </div>
      <div className="ws-soform-foot">
        <span className="ws-sototal">Alamat baru berlaku mulai antaran berikutnya.</span>
        <div className="ws-soform-btns">
          <button type="button" className="btn btn-sm ghost" onClick={onCancel}>Batal</button>
          <button type="button" className="btn btn-sm" disabled={!businessName.trim() || !address.trim() || busy} onClick={submit}>
            {busy ? "Menyimpan" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------- standing order form -- */

/**
 * One form for create and edit. Quantities are drafted as strings so an input
 * can be emptied while typing without collapsing to zero; only rows with a
 * usable number are sent.
 */
function StandingOrderForm({ priceList, editing, onSaved, onCancel }) {
  const [weekday, setWeekday] = useState(editing?.weekday ?? 2);
  const [qty, setQty] = useState(() => {
    const q = {};
    for (const it of editing?.items ?? []) q[it.productId] = String(it.qty);
    return q;
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const items = priceList
    .map((p) => ({ productId: p.id, qty: Math.floor(Number(qty[p.id])) }))
    .filter((it) => Number.isFinite(it.qty) && it.qty > 0);

  const total = items.reduce((a, it) => {
    const p = priceList.find((x) => x.id === it.productId);
    return a + (p?.wholesalePrice || 0) * it.qty;
  }, 0);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/wholesale/standing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing?.id, weekday, items }),
      });
      const d = await res.json();
      if (!res.ok) {
        // Name the product and the number. "Tidak bisa" is useless to
        // someone trying to plan a cafe.
        if (d.error === "below_moq") setErr(`${d.name} minimal ${d.moq} per kirim.`);
        else if (d.error === "wholesale_capacity")
          setErr(`Hanya ${d.free} ${d.name} yang bebas untuk ${dayLabel(d.date)}. Turunkan jumlahnya atau bicarakan alokasi dengan kami.`);
        else if (d.error === "empty_order") setErr("Tambahkan minimal satu produk.");
        else setErr("Pesanan tetapnya belum tersimpan.");
        return;
      }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="ws-soform">
      <p className="micro">Tiap</p>
      <div className="ws-days" role="group" aria-label="Hari pengiriman">
        {WEEKDAYS.map((name, i) => (
          <button
            key={name} type="button"
            className={`daychip ${weekday === i ? "on" : ""}`}
            aria-pressed={weekday === i}
            onClick={() => setWeekday(i)}
          >
            {name.slice(0, 3)}
          </button>
        ))}
      </div>

      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}

      <ul className="ws-solines">
        {priceList.map((p) => (
          <li key={p.id} className="ws-soline">
            <label htmlFor={`so-${p.id}`} className="ws-soline-name">
              {p.name}
              <small>{rp(p.wholesalePrice)} per pcs, minimal {p.moq}</small>
            </label>
            <input
              id={`so-${p.id}`}
              className="numin"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="0"
              value={qty[p.id] ?? ""}
              onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
            />
          </li>
        ))}
      </ul>

      <div className="ws-soform-foot">
        <span className="ws-sototal">{items.length ? `${rp(total)} per kirim` : "Isi jumlahnya"}</span>
        <div className="ws-soform-btns">
          {onCancel && (
            <button type="button" className="btn btn-sm ghost" onClick={onCancel}>Batal</button>
          )}
          <button type="button" className="btn btn-sm" disabled={items.length === 0 || busy} onClick={submit}>
            {busy ? "Mengecek kapasitas" : editing ? "Simpan" : "Buat pesanan tetap"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- the portal -- */

function Portal({ me, onSignedOut, onProfileSaved }) {
  const [data, setData] = useState(null); // { standingOrders, schedule }
  const [del, setDel] = useState(null); // { deliveries, invoices }
  const [editing, setEditing] = useState(null); // null | "new" | standing order
  const [editingProfile, setEditingProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipErr, setSkipErr] = useState("");

  const load = useCallback(() => {
    return Promise.all([
      fetch("/api/wholesale/standing").then((r) => r.json()).then(setData),
      fetch("/api/wholesale/deliveries").then((r) => r.json()).then(setDel),
    ]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setActive = async (id, active) => {
    setBusy(true);
    try {
      await fetch("/api/wholesale/standing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const setSkip = async (d, skip) => {
    setBusy(true);
    setSkipErr("");
    try {
      const res = await fetch("/api/wholesale/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standingOrderId: d.standingOrderId, date: d.date, skip }),
      });
      if (!res.ok) {
        const e = await res.json();
        if (e.error === "too_late")
          setSkipErr(`Sudah telat mengubah ${dayLabel(d.date)}: dapur merencanakan panggangan ${e.cutoffDays} hari sebelumnya. Hubungi kami saja.`);
        else if (e.error === "already_in_progress")
          setSkipErr(`${dayLabel(d.date)} sudah mulai dikemas.`);
        else setSkipErr("Perubahan itu belum tersimpan.");
        return;
      }
      await load();
    } finally { setBusy(false); }
  };

  // The one delivery the cafe cares about most, floated to the top.
  const next = del?.deliveries.find((d) => !d.skipped && d.stage !== "delivered");
  const nextStage = next
    ? next.stage === "packed"
      ? "Sedang dikemas"
      : "Terjadwal"
    : null;

  return (
    <main id="main" className="ws-main">
      <p className="ws-eyebrow">✦ Akun mitra</p>
      <div className="ws-id">
        <div>
          <h1 className="serif ws-h1">{me.customer.businessName || me.customer.name}</h1>
          <p className="ws-idsub">
            {me.customer.address ? `${me.customer.address} · ` : ""}
            {me.customer.whatsapp} · harga trade aktif
          </p>
        </div>
        <div className="ws-soform-btns">
          {!editingProfile && (
            <button type="button" className="btn btn-sm ghost" onClick={() => setEditingProfile(true)}>
              Ubah profil
            </button>
          )}
        </div>
      </div>

      {next && (
        <section className="ws-next" aria-label="Kiriman berikutnya">
          <div className="ws-next-row">
            <div>
              <p className="ws-next-label">Kiriman berikutnya</p>
              <p className="ws-next-when serif">
                {dayLabel(next.date)} · tiba ≤ 07.30
              </p>
              <p className="ws-next-items">
                {next.items.map((it) => `${it.qty} ${it.name}`).join(" · ")} ·{" "}
                <span className="ws-next-total">{rp(next.total)}</span>
              </p>
            </div>
            <span className="ws-next-pill">{nextStage}</span>
          </div>
        </section>
      )}

      {editingProfile && (
        <section className="ws-section" aria-label="Ubah profil bisnis">
          <ProfileEdit
            customer={me.customer}
            onSaved={() => { setEditingProfile(false); onProfileSaved(); }}
            onCancel={() => setEditingProfile(false)}
          />
        </section>
      )}

      {/* -------- standing orders -------- */}
      <section className="ws-section" aria-labelledby="ws-so-h">
        <div className="ws-section-head">
          <h2 id="ws-so-h" className="ws-h2">Pesanan tetap</h2>
          {editing === null && (
            <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}>
              <Icon name="plus" size={14} /> Baru
            </button>
          )}
        </div>
        <p className="ws-hint">
          Berulang tiap minggu sampai kamu jeda. Setiap perubahan dicek terhadap
          jatah dapur empat minggu ke depan — pesanan yang tersimpan adalah
          pesanan yang ditepati.
        </p>

        {editing !== null && (
          <StandingOrderForm
            priceList={me.priceList}
            editing={editing === "new" ? null : editing}
            onSaved={() => { setEditing(null); load(); }}
            onCancel={() => setEditing(null)}
          />
        )}

        {data === null && <p className="ws-empty">Memuat</p>}
        {data?.standingOrders.length === 0 && editing === null && (
          <p className="ws-empty">Belum ada pesanan tetap.</p>
        )}
        {data?.standingOrders.length > 0 && (
          <ul className="ws-solist">
            {data.standingOrders.map((so) => (
              <li key={so.id} className={`ws-so ${so.active ? "" : "paused"}`}>
                <div className="ws-so-top">
                  <span className="ws-so-day">Tiap {WEEKDAYS[so.weekday] ?? so.weekdayName}</span>
                  <span className={`pill ${so.active ? "pill-ready" : "pill-out"}`}>
                    {so.active ? "Aktif" : "Jeda"}
                  </span>
                </div>
                <p className="ws-so-items">
                  {so.items.map((it) => `${it.qty} ${it.name}`).join(" · ")} ·{" "}
                  <span className="ws-so-total">
                    {rp(so.items.reduce((a, it) => a + it.unitPrice * it.qty, 0))}/kirim
                  </span>
                </p>
                <div className="ws-so-btns">
                  {so.active && (
                    <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => setEditing(so)}>
                      Ubah
                    </button>
                  )}
                  <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => setActive(so.id, !so.active)}>
                    {so.active ? "Jeda" : "Lanjutkan"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* -------- deliveries -------- */}
      <section className="ws-section" aria-labelledby="ws-del-h">
        <h2 id="ws-del-h" className="ws-h2">Empat minggu ke depan</h2>
        <p className="ws-hint">
          Tutup sehari? Lewati kiriman itu saja, maksimal H-2. Jatahmu tetap
          milikmu, dan hari yang dilewati tidak pernah ditagih.
        </p>
        {skipErr && <p className="err" role="alert"><Icon name="alert" size={16} />{skipErr}</p>}
        {del?.deliveries.length === 0 && <p className="ws-empty">Belum ada jadwal. Buat pesanan tetap di atas.</p>}
        {del?.deliveries.length > 0 && (
          <ul className="ws-deliveries">
            {del.deliveries.map((d) => (
              <li key={`${d.standingOrderId}:${d.date}`} className={`ws-delivery ${d.skipped ? "skipped" : ""}`}>
                <span className="ws-delivery-date">{dayLabel(d.date)}</span>
                <span className="ws-delivery-items">
                  {d.items.map((it) => `${it.qty} ${it.name}`).join(" · ")}
                  {d.skipped && <em className="ws-skiptag"> — dilewati</em>}
                  {d.stage === "packed" && <em className="ws-stagetag"> — sedang dikemas</em>}
                  {d.stage === "delivered" && <em className="ws-stagetag"> — terkirim</em>}
                </span>
                <span className="ws-delivery-total">{d.skipped ? "—" : rp(d.total)}</span>
                <span className="ws-delivery-act">
                  {d.stage === "pending" || d.skipped ? (
                    <button type="button" className="btn btn-sm ghost" disabled={busy} onClick={() => setSkip(d, !d.skipped)}>
                      {d.skipped ? "Pulihkan" : "Lewati"}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* -------- invoices -------- */}
      <section className="ws-section" aria-labelledby="ws-inv-h">
        <h2 id="ws-inv-h" className="ws-h2">Tagihan</h2>
        <p className="ws-hint">
          Satu invoice per bulan, satu baris per kiriman, hari yang dilewati
          tidak pernah ditagih. Wholesale jalan lewat invoice, bukan QRIS dengan
          hitung mundur.
        </p>
        {del?.invoices.length === 0 && <p className="ws-empty">Belum ada yang perlu ditagih.</p>}
        {del?.invoices.map((inv) => (
          <div key={inv.number} className="ws-invoice">
            <div className="ws-invoice-head">
              <span className="ws-invoice-no">{inv.number}</span>
              <span className="ws-invoice-total">{rp(inv.total)}</span>
            </div>
            <ul className="ws-invoice-lines">
              {inv.lines.map((l) => (
                <li key={l.date}>
                  <span>{dayLabel(l.date)}</span>
                  <span className="ws-invoice-linedet">
                    {l.items.map((it) => `${it.qty} ${it.name}`).join(" · ")}
                    {l.delivered ? " · terkirim" : " · dijadwalkan"}
                  </span>
                  <span className="ws-invoice-lineamt">{rp(l.total)}</span>
                </li>
              ))}
            </ul>
            <p className="ws-invoice-foot">
              {inv.deliveries} kiriman · {inv.month}
            </p>
          </div>
        ))}
      </section>

      {/* -------- price list -------- */}
      <section className="ws-section" aria-labelledby="ws-price-h">
        <h2 id="ws-price-h" className="ws-h2">Daftar harga trade</h2>
        <p className="ws-hint">
          Khusus akun yang disetujui — mohon dijaga. Produk di luar daftar ini
          retail saja.
        </p>
        <div className="tablewrap">
          <table className="dtable">
            <caption className="visually-hidden">Daftar harga wholesale</caption>
            <thead>
              <tr>
                <th scope="col">Produk</th>
                <th scope="col" className="num">Retail</th>
                <th scope="col" className="num">Trade</th>
                <th scope="col" className="num">Min/kirim</th>
              </tr>
            </thead>
            <tbody>
              {me.priceList.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}<small>{p.category}</small></th>
                  <td className="num ws-retail-strike">{rp(p.retailPrice)}</td>
                  <td className="num ws-trade">{rp(p.wholesalePrice)}</td>
                  <td className="num">{p.moq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------- shell -- */

export default function WholesalePortal() {
  const [me, setMe] = useState(null);

  const loadMe = useCallback(() => {
    return fetch("/api/wholesale/me").then((r) => r.json()).then(setMe);
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const signOut = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    loadMe();
  };

  return (
    <div className="ws">
      <header className="ws-bar">
        <div className="ws-bar-id">
          <Link href="/" className="brand brand-sm">NOISETTE</Link>
          <span className="ws-tagname">Wholesale</span>
        </div>
        <div className="app-bar-actions">
          <Link href="/pre-order" className="linkbtn">Pesan retail</Link>
          <ThemeToggle />
          {(me?.state === "retail" || me?.state === "wholesale") && (
            <button type="button" className="btn btn-sm ghost" onClick={signOut}>Keluar</button>
          )}
        </div>
      </header>

      {me === null && (
        <main className="ws-main"><p className="micro">Memuat</p></main>
      )}
      {me?.state === "anonymous" && (
        <main id="main" className="ws-main"><SignIn onSignedIn={loadMe} /></main>
      )}
      {me?.state === "retail" && (
        <main id="main" className="ws-main">
          <Apply application={me.application} onApplied={loadMe} />
          <p className="note">Masuk sebagai {me.customer.whatsapp}.</p>
        </main>
      )}
      {me?.state === "wholesale" && <Portal me={me} onSignedOut={signOut} onProfileSaved={loadMe} />}
    </div>
  );
}
