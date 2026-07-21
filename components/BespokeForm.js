"use client";
import { useState } from "react";
import Icon from "./Icon";
import { dayLabel } from "@/lib/format";

/**
 * The bespoke enquiry form.
 *
 * This is the one form that lives on the website rather than in the app,
 * because a commission starts as a conversation with the bakery, not a
 * transaction with a counter. No prices, no stock, no slots: a name, a date,
 * a brief, and the patissier replies on WhatsApp.
 */

const minNeededOn = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
};

export default function BespokeForm() {
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [neededOn, setNeededOn] = useState("");
  const [servings, setServings] = useState("");
  const [brief, setBrief] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, whatsapp: wa, neededOn, servings, brief }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.error === "too_soon")
          setErr(`Kue custom butuh ${d.leadDays} hari. Tanggal paling awal yang bisa kami ambil ${dayLabel(d.minDate)}.`);
        else if (d.error === "invalid_number") setErr("Sepertinya itu bukan nomor WhatsApp.");
        else if (d.error === "invalid_date") setErr("Pilih tanggal kamu membutuhkannya.");
        else setErr("Ceritakan namamu, nomormu, dan apa yang kamu impikan.");
        return;
      }
      setDone(d.commission);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="bespoke-done">
        <p className="done-eyebrow">✦ Brief diterima ✦</p>
        <h2 className="serif italic">Sampai ketemu di WhatsApp</h2>
        <p>
          Nomor enquiry kamu <b>{done.id}</b>, untuk {dayLabel(done.neededOn)}.
          Patissier membaca setiap brief secara pribadi dan membalas dengan
          penawaran, biasanya dalam dua hari. Belum ada yang dipesan dan belum
          ada yang terutang sampai kamu mengunci penawaran dengan DP.
        </p>
      </div>
    );
  }

  return (
    <div className="bespoke-form">
      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}

      <div className="field">
        <label htmlFor="b-name" className="sr-only">Nama</label>
        <input id="b-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Nama" />
      </div>
      <div className="field">
        <label htmlFor="b-wa" className="sr-only">Nomor WhatsApp</label>
        <input id="b-wa" type="tel" inputMode="tel" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="Nomor WhatsApp, 08xx" />
      </div>
      <div className="bespoke-row">
        <div className="field">
          <label htmlFor="b-date">Dibutuhkan tanggal</label>
          <input id="b-date" type="date" min={minNeededOn()} value={neededOn} onChange={(e) => setNeededOn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="b-serv">Porsi</label>
          <input id="b-serv" type="number" min={1} inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} placeholder="20" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="b-brief" className="sr-only">Brief</label>
        <textarea
          id="b-brief"
          className="revtext"
          rows={5}
          maxLength={2000}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Ceritakan momennya: rasa yang kamu suka, warna, referensi yang pernah kamu lihat. Link boleh."
        />
      </div>
      <button type="button" className="btn" disabled={busy || !name.trim() || !wa.trim() || !neededOn || !brief.trim()} onClick={submit}>
        {busy ? "Mengirim" : "Kirim brief"}
      </button>
      <p className="note">Minimal dua minggu sebelum hari-H. Penawaran dulu, baru bicara uang.</p>
    </div>
  );
}
