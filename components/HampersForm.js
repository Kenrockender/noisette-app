"use client";
import { useState } from "react";
import Icon from "./Icon";
import { dayLabel } from "@/lib/format";

/**
 * The hampers custom-order form.
 *
 * Requested by ci Ariel as a form-first flow, not a WhatsApp-first one: she
 * recaps every request by hand and opens WhatsApp herself only once, to
 * confirm contents and chase payment. So this form is the whole ordering
 * step, unlike the cake and cafe pages, which just build a wa.me link.
 */

const today = () => new Date().toISOString().slice(0, 10);
const emptyRecipient = () => ({ address: "", cardFrom: "", cardTo: "" });

// ci Ariel's seasonal defaults — edit this list per event.
const HAMPER_TYPES = ["Natal", "Idul Fitri"];

export default function HampersForm() {
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [contents, setContents] = useState("");
  const [qty, setQty] = useState("1");
  const [neededOn, setNeededOn] = useState("");
  const [notes, setNotes] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const updateRecipient = (i, field, value) => {
    setRecipients((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };
  const removeRecipient = (i) => setRecipients((rs) => rs.filter((_, idx) => idx !== i));

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = await fetch("/api/hampers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, whatsapp: wa, contents, qty, neededOn, notes, recipients }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.error === "invalid_number") setErr("Sepertinya itu bukan nomor WhatsApp.");
        else if (d.error === "invalid_date") setErr("Pilih tanggal kamu membutuhkannya, hari ini atau setelahnya.");
        else setErr("Ceritakan namamu, nomormu, dan isi hampers yang kamu mau.");
        return;
      }
      setDone(d.order);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="bespoke-done">
        <p className="done-eyebrow">✦ Permintaan diterima ✦</p>
        <h2 className="serif italic">Sampai ketemu di WhatsApp</h2>
        <p>
          Nomor pesanan kamu <b>{done.id}</b>, untuk {dayLabel(done.neededOn)}.
          Admin kami membaca setiap permintaan secara pribadi dan menghubungimu
          di WhatsApp untuk konfirmasi isi hampers dan pembayaran.
        </p>
      </div>
    );
  }

  return (
    <div className="bespoke-form">
      {err && <p className="err" role="alert"><Icon name="alert" size={16} />{err}</p>}

      <div className="field">
        <label htmlFor="h-name" className="sr-only">Nama</label>
        <input id="h-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Nama" />
      </div>
      <div className="field">
        <label htmlFor="h-wa" className="sr-only">Nomor WhatsApp</label>
        <input id="h-wa" type="tel" inputMode="tel" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="Nomor WhatsApp, 08xx" />
      </div>
      <div className="field">
        <span className="field-label-static">Tipe hampers</span>
        <div className="hamper-type-chips" role="radiogroup" aria-label="Tipe hampers">
          {HAMPER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={contents === type}
              className={`hamper-type-chip${contents === type ? " on" : ""}`}
              onClick={() => setContents(type)}
            >
              {contents === type && <Icon name="check" size={14} />}
              {type}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={contents === "Custom"}
            className={`hamper-type-chip${contents === "Custom" ? " on" : ""}`}
            onClick={() => setContents("Custom")}
          >
            {contents === "Custom" && <Icon name="check" size={14} />}
            Custom
          </button>
        </div>
        {contents === "Custom" && (
          <p className="hamper-type-hint">Ceritakan tema hampers custom kamu di kolom catatan di bawah.</p>
        )}
      </div>
      <div className="bespoke-row">
        <div className="field">
          <label htmlFor="h-date">Dibutuhkan tanggal</label>
          <input id="h-date" type="date" min={today()} value={neededOn} onChange={(e) => setNeededOn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="h-qty">Jumlah hampers</label>
          <input id="h-qty" type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="h-notes">Catatan tambahan (opsional)</label>
        <input
          id="h-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={contents === "Custom" ? "Tema, isi, warna kemasan, dll" : "Occasion, dll"}
        />
      </div>

      <div className="hamper-recipients">
        <p className="hamper-recipients-label">Alamat &amp; kartu ucapan (opsional)</p>
        {recipients.map((r, i) => (
          <div key={i} className="hamper-recipient">
            <div className="field">
              <label htmlFor={`h-addr-${i}`} className="sr-only">Alamat pengiriman</label>
              <input
                id={`h-addr-${i}`}
                value={r.address}
                onChange={(e) => updateRecipient(i, "address", e.target.value)}
                placeholder="Alamat pengiriman"
              />
            </div>
            <div className="bespoke-row">
              <div className="field">
                <label htmlFor={`h-from-${i}`} className="sr-only">Card dari</label>
                <input
                  id={`h-from-${i}`}
                  value={r.cardFrom}
                  onChange={(e) => updateRecipient(i, "cardFrom", e.target.value)}
                  placeholder="Card dari"
                />
              </div>
              <div className="field">
                <label htmlFor={`h-to-${i}`} className="sr-only">Card untuk</label>
                <input
                  id={`h-to-${i}`}
                  value={r.cardTo}
                  onChange={(e) => updateRecipient(i, "cardTo", e.target.value)}
                  placeholder="Card untuk"
                />
              </div>
            </div>
            <button type="button" className="btn btn-sm ghost" onClick={() => removeRecipient(i)}>
              Hapus alamat ini
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm ghost" onClick={() => setRecipients((rs) => [...rs, emptyRecipient()])}>
          + Tambah alamat &amp; kartu
        </button>
      </div>

      <button type="button" className="btn" disabled={busy || !name.trim() || !wa.trim() || !neededOn || !contents.trim()} onClick={submit}>
        {busy ? "Mengirim" : "Kirim permintaan"}
      </button>
      <p className="note">Admin kami menghubungimu di WhatsApp untuk konfirmasi dan pembayaran.</p>
    </div>
  );
}
