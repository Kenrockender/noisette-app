"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

const WEEKDAY_LABELS = ["Mi", "Sn", "Sl", "Rb", "Km", "Jm", "Sb"];
const MONTH_LABELS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const pad = (n) => String(n).padStart(2, "0");
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * The trading-day jump, replacing the native `<input type="date">`.
 *
 * The native picker is a different widget per browser and OS — fast as a
 * wheel on a phone, a heavier month panel on desktop Chrome — and looks
 * nothing like the rest of the counter. This is the same month-grid idea,
 * built once, so it is consistent and instant everywhere.
 */
export default function DateJump({ value, min, onPick }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => fromIso(value));
  const boxRef = useRef(null);
  const triggerRef = useRef(null);

  // Never open showing a stale month if the trading day moved since last close.
  useEffect(() => {
    if (open) setViewDate(fromIso(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const minDate = fromIso(min);
  const atOrBeforeMinMonth = year < minDate.getFullYear() || (year === minDate.getFullYear() && month <= minDate.getMonth());

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array(firstOfMonth.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="date-jump" ref={boxRef}>
      <button
        type="button"
        ref={triggerRef}
        className="date-jump-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Lompat ke tanggal"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="calendar" size={16} />
      </button>
      {open && (
        <div className="date-jump-pop" role="dialog" aria-label="Pilih tanggal">
          <div className="date-jump-head">
            <button
              type="button"
              className="date-jump-nav"
              disabled={atOrBeforeMinMonth}
              aria-label="Bulan sebelumnya"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
            >
              <Icon name="arrowLeft" size={15} />
            </button>
            <span className="date-jump-month">{MONTH_LABELS[month]} {year}</span>
            <button
              type="button"
              className="date-jump-nav"
              aria-label="Bulan berikutnya"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
            >
              <Icon name="arrowRight" size={15} />
            </button>
          </div>
          <div className="date-jump-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
          </div>
          <div className="date-jump-grid">
            {cells.map((d, i) => {
              if (d == null) return <span key={i} className="date-jump-empty" aria-hidden="true" />;
              const iso = toIso(new Date(year, month, d));
              const disabled = iso < min;
              const selected = iso === value;
              return (
                <button
                  key={i}
                  type="button"
                  className={`date-jump-day ${selected ? "on" : ""}`}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => { onPick(iso); setOpen(false); }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
