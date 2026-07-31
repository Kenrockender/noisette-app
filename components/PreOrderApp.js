"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import PhotoFrame from "./PhotoFrame";
import Icon from "./Icon";
import { photoOf } from "@/lib/photos";
import { rp, k, dayLabel, dayShort, pickupIcs, googleCalendarUrl } from "@/lib/format";

// Split off the chunks that only a fraction of visits ever reach, so the initial
// /order bundle is just the catalog. The account sheet (large) loads the first
// time it is opened; the payment QR loads only when a payment screen shows.
const AccountSheet = dynamic(() => import("./AccountSheet"), { ssr: false });
const FakeQR = dynamic(() => import("./FakeQR"), { ssr: false });

/*
 * THE APP (Noisette v2).
 *
 * Everyone who reaches this screen already knows what Noisette is. So there is
 * no hero, no story, no address block. The whole surface is one job: pick a
 * day, pick pastries, pick a window, pay, get a code.
 *
 * The one structural decision worth knowing about: the pickup date lives at the
 * top of the catalog, not buried in a later step. Stock is allocated per day,
 * so "sisa 4" is meaningless until you know which day. Choosing the day first
 * means the number on every card is true for the order you are actually placing.
 *
 * v2 also folds the old slot and pay screens into one checkout ("Jam ambil &
 * bayar"), and lets you add to the bag straight from the catalog card.
 */

const PAYS = ["QRIS", "GoPay", "BCA VA", "Mandiri"];

/*
 * The day's full bake per product, so the card meter can show how much of the
 * allocation is gone. Brand copy, mirrored from the kitchen's plan; the
 * availability API only returns what is left.
 */
const ALLOC = {
  pistachio: 10, piscok: 14, almond: 9, dubai: 40, bonbon: 15,
  eggtart: 20, hazelnut: 8, mango: 10, giftbox6: 5,
};

/** "08:00-10:00" from the API becomes "08.00–10.00" on screen. */
const slotLabel = (t) => (t || "").replace(/:/g, ".").replace("-", "–");

export default function OrderApp({ initialProducts = [], initialAvail = null, initialStats = {} }) {
  const [view, setView] = useState("catalog"); // catalog | product | checkout | qris | done
  const [products, setProducts] = useState(initialProducts);
  const [avail, setAvail] = useState(initialAvail); // { date, dates, stock, slots, giftWrapPrice }
  const [cat, setCat] = useState("Semua");
  const [customer, setCustomer] = useState(null);
  const [acctOpen, setAcctOpen] = useState(false);
  const [claimed, setClaimed] = useState(0);
  const [lastOrder, setLastOrder] = useState(null); // fuels "Pesanan terakhirmu"
  const [pid, setPid] = useState(null);
  const [qtyN, setQtyN] = useState(1);
  const [bag, setBag] = useState({}); // productId -> qty
  const [giftWrap, setGiftWrap] = useState(false);
  const [giftPicks, setGiftPicks] = useState({}); // productId -> qty, for the Signature Box
  const [bagOpen, setBagOpen] = useState(false);
  const [slotIndex, setSlotIndex] = useState(null);
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [payM, setPayM] = useState("QRIS");
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(15 * 60);
  const [rev, setRev] = useState(null); // published reviews for the open product
  const [stats, setStats] = useState(initialStats); // productId -> {count, average}, for catalog cards
  const errRef = useRef(null);

  const P = (id) => products.find((p) => p.id === id);
  const stockOf = (id) => (avail ? avail.stock[id] ?? 0 : 0);
  const bagCount = Object.values(bag).reduce((a, b) => a + b, 0);
  const bagTotal = useMemo(() => {
    let t = Object.entries(bag).reduce((a, [id, q]) => a + (P(id)?.price || 0) * q, 0);
    if (giftWrap && avail) t += avail.giftWrapPrice;
    return t;
  }, [bag, giftWrap, products, avail]);

  // The Signature Box of 6 is its own SKU: picking the six does not draw down
  // individual stock, it just tells the counter what to assemble. Any picks
  // sent must add up exactly, or none at all ("pilih di konter").
  const giftBoxQty = bag.giftbox6 || 0;
  const giftBoxNeeded = giftBoxQty * 6;
  const giftPickTotal = Object.values(giftPicks).reduce((a, b) => a + (b || 0), 0);
  const giftPickItems = products.filter((p) => p.house === "patisserie" && p.id !== "giftbox6");

  // Lines in the bag that no longer fit the selected day. Switching the date rail
  // can strand an item, so we say so here rather than at the payment step.
  const overStock = useMemo(
    () => Object.entries(bag).filter(([id, q]) => q > stockOf(id)).map(([id, q]) => ({ id, q, have: stockOf(id) })),
    [bag, avail]
  );

  const loadAvail = (date) =>
    fetch("/api/availability" + (date ? `?date=${date}` : ""))
      .then((r) => r.json())
      .then(setAvail);

  useEffect(() => {
    // Server-rendered props already seed products, availability and stats, so the
    // catalog is on screen before this runs. Only fetch what the server did not
    // hand us (e.g. if PreOrderApp is ever mounted without initial props).
    if (!products.length) fetch("/api/products").then((r) => r.json()).then((d) => setProducts(d.products));
    if (!avail) loadAvail();
    if (!Object.keys(stats).length) fetch("/api/reviews?all=1").then((r) => r.json()).then((d) => setStats(d.stats || {})).catch(() => {});
    // 204 means nobody is signed in, which is a perfectly normal state here.
    fetch("/api/auth/session")
      .then((r) => (r.status === 204 ? null : r.json()))
      .then((d) => d && setCustomer(d.customer))
      .catch(() => {});
  }, []);

  // Signing in should fill the checkout in, not make you retype what we know.
  // It also fetches the order history so the catalog can offer a one-tap reorder.
  useEffect(() => {
    if (!customer) { setLastOrder(null); return; }
    setName((n) => n || customer.name || "");
    setWa((w) => w || customer.whatsapp || "");
    fetch("/api/account/orders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const done = (d?.orders || []).filter((o) => o.status !== "cancelled");
        setLastOrder(done[0] || null);
      })
      .catch(() => {});
  }, [customer]);

  useEffect(() => {
    if (view !== "qris") return;
    setSecs(15 * 60);
    const iv = setInterval(() => setSecs((s) => {
      if (s <= 1) { clearInterval(iv); setView("checkout"); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(iv);
  }, [view]);

  useEffect(() => { if (err && errRef.current) errRef.current.focus(); }, [err]);

  // Published reviews for whichever product is open. Cleared first so a slow
  // response never shows the previous pastry's praise under the wrong photo.
  useEffect(() => {
    if (view !== "product" || !pid) return;
    setRev(null);
    fetch(`/api/reviews?product=${pid}`)
      .then((r) => r.json())
      .then(setRev)
      .catch(() => {});
  }, [view, pid]);

  if (!products.length || !avail) {
    return (
      <div className="app app-loading">
        <p className="micro">Menyiapkan konter</p>
      </div>
    );
  }

  const changeDate = (d) => { setSlotIndex(null); loadAvail(d); };

  const cats = ["Semua", ...new Set(products.map((p) => p.category))];
  const shown = products.filter((p) => cat === "Semua" || p.category === cat);

  const setQty = (id, q) => {
    const max = stockOf(id);
    const v = Math.max(0, Math.min(max, q));
    setBag((b) => {
      const c = { ...b };
      if (v === 0) delete c[id];
      else c[id] = v;
      return c;
    });
    if (id === "giftbox6" && v === 0) setGiftPicks({});
  };

  const addToBag = () => {
    setBag((b) => ({ ...b, [pid]: Math.min(stockOf(pid), (b[pid] || 0) + qtyN) }));
    setQtyN(1);
    setView("catalog");
    setBagOpen(true);
  };

  const reorderLast = () => {
    if (!lastOrder) return;
    setBag((b) => {
      const c = { ...b };
      for (const it of lastOrder.items || []) {
        const cap = stockOf(it.productId);
        const want = (c[it.productId] || 0) + it.qty;
        if (cap > 0) c[it.productId] = Math.min(cap, want);
      }
      return c;
    });
    setBagOpen(true);
  };

  const placeOrder = async () => {
    setErr("");
    if (slotIndex === null) return setErr("Pilih jam ambil dulu.");
    if (!name.trim()) return setErr("Isi nama kamu dulu.");
    if (!wa.trim()) return setErr("Isi nomor WhatsApp supaya kode ambilmu bisa dikirim.");
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: Object.entries(bag).map(([productId, qty]) => ({ productId, qty })),
        pickupDate: avail.date, slotIndex, name, whatsapp: wa, paymentMethod: payM, giftWrap,
        giftContents: giftPickTotal === giftBoxNeeded && giftPickTotal > 0
          ? Object.entries(giftPicks).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }))
          : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === "insufficient_stock")
        setErr(`${P(data.productId)?.name || "Salah satu item"} tinggal ${data.available} untuk ${dayLabel(avail.date)}. Kurangi jumlahnya atau pilih hari lain.`);
      else if (data.error === "slot_full") setErr("Jam itu baru saja penuh. Pilih jam lain, ya.");
      else setErr("Pesanan belum terkirim. Cek nama dan nomormu, lalu coba lagi.");
      loadAvail(avail.date);
      return;
    }
    setOrder(data.order);
    setView("qris");
  };

  const confirmPaid = async () => {
    const res = await fetch(`/api/orders/${order.id}/pay`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setErr("Jendela pembayarannya keburu tutup. Tasmu masih ada, coba lagi saja.");
      setView("checkout");
      loadAvail(avail.date);
      return;
    }
    setOrder(data.order);
    setBag({}); setGiftWrap(false); setGiftPicks({}); setSlotIndex(null);
    loadAvail(avail.date);
    setView("done");
  };

  const BagButton = () => (
    <button
      type="button"
      className="iconbtn"
      onClick={() => setBagOpen(true)}
      aria-label={bagCount ? `Buka tas, ${bagCount} item` : "Buka tas, kosong"}
    >
      <Icon name="bag" />
      {bagCount > 0 && <span className="bagcount">{bagCount}</span>}
    </button>
  );

  const BackButton = ({ onClick, label }) => (
    <button type="button" className="iconbtn" onClick={onClick} aria-label={label}>
      <Icon name="arrowLeft" />
    </button>
  );

  const AccountButton = () => (
    <button
      type="button"
      className={`iconbtn ${customer ? "on" : ""}`}
      onClick={() => setAcctOpen(true)}
      aria-label={customer ? `Akunmu, masuk sebagai ${customer.name || customer.whatsapp}` : "Masuk"}
    >
      <Icon name="user" />
      {customer && <span className="dot" aria-hidden="true" />}
    </button>
  );

  const Err = () =>
    err ? (
      <p className="err" role="alert" tabIndex={-1} ref={errRef}>
        <Icon name="alert" size={16} />
        {err}
      </p>
    ) : null;

  // Typographic stars. The label carries the number; the glyphs are decoration.
  const Stars = ({ n }) => (
    <span className="stars" aria-label={`${n} dari 5 bintang`}>
      <span aria-hidden="true">{"★★★★★".slice(0, n)}</span>
      <span className="stars-off" aria-hidden="true">{"★★★★★".slice(n)}</span>
    </span>
  );

  // The stock meter under every card: how much of today's bake is left.
  const Meter = ({ id, big = false }) => {
    const s = stockOf(id);
    const al = ALLOC[id] || 1;
    const pct = Math.max(Math.round((s / al) * 100), s > 0 ? 8 : 0);
    const low = s > 0 && s / al <= 0.25;
    return (
      <span className={`meter ${big ? "meter-lg" : ""}`}>
        <span className="meter-track">
          <span
            className={`meter-bar ${s <= 0 ? "is-out" : low ? "is-low" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className={`meter-tag ${s <= 0 ? "is-out" : s <= 5 ? "is-low" : ""}`}>
          {s <= 0
            ? "Habis"
            : big
              ? s <= 5
                ? `Sisa ${s} untuk ${dayLabel(avail.date)}`
                : `${s} tersedia, ${dayLabel(avail.date)}`
              : s <= 5
                ? `Sisa ${s}`
                : `${s} tersedia`}
        </span>
      </span>
    );
  };

  return (
    <div className={`app ${view === "qris" ? "app-focus" : ""}`}>

      {view === "catalog" && (
        <>
          <header className="app-bar app-bar-stack">
            <div className="app-bar-row">
              <Link href="/" className="brand brand-sm app-brand" aria-label="Kembali ke situs Noisette">
                NOISETTE
                <span className="app-brand-tag">Malang</span>
              </Link>
              <div className="app-bar-actions">
                <ThemeToggle />
                <AccountButton />
                <BagButton />
              </div>
            </div>
            <div className="app-dates">
              <div className="app-dates-head">
                <p className="app-dates-label" id="pickup-day">
                  Ambil hari apa?
                </p>
                <p className="app-dates-note">Stok dihitung per hari</p>
              </div>
              <ul className="daterail" aria-labelledby="pickup-day">
                {avail.dates.map((d) => (
                  <li key={d}>
                    <button
                      type="button"
                      className={`daychip ${avail.date === d ? "on" : ""}`}
                      aria-pressed={avail.date === d}
                      onClick={() => changeDate(d)}
                    >
                      <small>{dayShort(d)}</small>
                      {d.slice(8)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </header>

          <main id="main" className="app-main">
            {customer && lastOrder && bagCount === 0 && (
              <section className="reorder" aria-label="Pesanan terakhirmu">
                <div className="reorder-head">
                  <p className="reorder-label">Pesanan terakhirmu</p>
                  <span className="reorder-when">{dayLabel(lastOrder.pickupDate)}</span>
                </div>
                <p className="reorder-items">
                  {(lastOrder.items || [])
                    .map((it) => `${it.qty}× ${P(it.productId)?.name || it.productId}`)
                    .join(", ")}{" "}
                  <span className="reorder-total">· {rp(lastOrder.total)}</span>
                </p>
                <button type="button" className="reorder-btn" onClick={reorderLast}>
                  Tambahkan lagi ke tas
                  <Icon name="arrowRight" size={15} />
                </button>
              </section>
            )}

            <ul className="cats" aria-label="Kategori">
              {cats.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    className={`cat ${cat === c ? "on" : ""}`}
                    aria-pressed={cat === c}
                    onClick={() => setCat(c)}
                  >
                    {c}
                  </button>
                </li>
              ))}
            </ul>

            <ul className="grid">
              {shown.map((p) => {
                const s = stockOf(p.id);
                const q = bag[p.id] || 0;
                const st = stats[p.id];
                return (
                  <li key={p.id} className={`card ${s <= 0 ? "soldout" : ""}`}>
                    <button
                      type="button"
                      className="card-open"
                      disabled={s <= 0}
                      onClick={() => { setPid(p.id); setQtyN(1); setView("product"); }}
                    >
                      <span className="card-photowrap">
                        <PhotoFrame
                          photo={photoOf(p.id)}
                          label={p.name}
                          className="card-photo"
                          sizes="(min-width: 1000px) 250px, (min-width: 700px) 33vw, 50vw"
                        />
                        {s <= 0 && (
                          <span className="card-out">
                            <span className="card-out-pill">Habis</span>
                          </span>
                        )}
                      </span>
                      <span className="card-row">
                        <span className="card-name serif">{p.name}</span>
                        <span className="card-sub">
                          <span className="card-price">{k(p.price)}</span>
                          {st?.count > 0 && (
                            <span className="card-rating">★ {st.average}</span>
                          )}
                        </span>
                      </span>
                    </button>
                    <div className="card-foot">
                      <Meter id={p.id} />
                      {s > 0 && q === 0 && (
                        <button type="button" className="card-add" onClick={() => setQty(p.id, 1)}>
                          <Icon name="plus" size={15} />
                          Tambah
                        </button>
                      )}
                      {s > 0 && q > 0 && (
                        <div className="card-step">
                          <button
                            type="button"
                            onClick={() => setQty(p.id, q - 1)}
                            aria-label={`Kurangi ${p.name}`}
                          >
                            <Icon name="minus" size={16} />
                          </button>
                          <span aria-live="polite" aria-label={`Jumlah ${q}`}>{q}</span>
                          <button
                            type="button"
                            onClick={() => setQty(p.id, q + 1)}
                            disabled={q >= s}
                            aria-label={`Tambah ${p.name}`}
                          >
                            <Icon name="plus" size={16} />
                          </button>
                        </div>
                      )}
                      {s <= 0 && (
                        <button type="button" className="card-notify">
                          Kabari kalau ada lagi
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </main>

          {bagCount > 0 && !bagOpen && (
            <div className="app-dock">
              <button type="button" className="btn dockbtn" onClick={() => setBagOpen(true)}>
                <span className="dockbtn-sum">
                  <span className="dockbtn-count">{bagCount}</span>
                  {rp(bagTotal)}
                </span>
                <span className="dockbtn-go">
                  Lihat tas
                  <Icon name="arrowRight" size={16} />
                </span>
              </button>
            </div>
          )}
        </>
      )}

      {view === "product" && pid && (() => {
        const p = P(pid);
        if (!p) return null;
        const left = stockOf(pid) - (bag[pid] || 0);
        const pair = P(p.pairsWith);
        const st = stats[pid];
        return (
          <>
            <header className="app-bar">
              <BackButton onClick={() => setView("catalog")} label="Kembali ke menu" />
              <div className="app-bar-actions">
                <ThemeToggle />
                <AccountButton />
                <BagButton />
              </div>
            </header>
            <main id="main" className="product">
              {/* Here the photo is the point of the screen, so it gets a real alt. */}
              <PhotoFrame
                photo={photoOf(p.id)}
                alt={p.name}
                label={p.name}
                className="product-photo"
                sizes="(min-width: 700px) 50vw, 100vw"
                priority
              />
              <div className="product-copy">
                <p className="product-kicker">
                  {p.category} <span className="product-kicker-star">✦</span>{" "}
                  {p.house === "boulangerie" ? "La Boulangerie" : "La Patisserie"}
                </p>
                <h1 className="serif product-name">{p.name}</h1>
                <div className="product-priceline">
                  <p className="product-price">{rp(p.price)}</p>
                  {st?.count > 0 && (
                    <p className="product-rating">
                      ★ {st.average} · {st.count} ulasan terverifikasi
                    </p>
                  )}
                </div>
                <Meter id={pid} big />
                <p className="desc">{p.description}</p>
                <p className="allerg">Mengandung {p.allergens}</p>

                {pair && (
                  <button
                    type="button"
                    className="pairs"
                    disabled={stockOf(p.pairsWith) <= 0}
                    onClick={() => { setPid(p.pairsWith); setQtyN(1); }}
                  >
                    <span>
                      <span className="pairs-kicker">Cocok ditemani</span>
                      <span className="pairs-name serif">{pair.name}</span>
                    </span>
                    <Icon name="arrowRight" size={16} />
                  </button>
                )}

                <div className="addrow">
                  <div className="stepper">
                    <button
                      type="button"
                      onClick={() => setQtyN((q) => Math.max(1, q - 1))}
                      disabled={qtyN <= 1}
                      aria-label="Kurangi jumlah"
                    >
                      <Icon name="minus" size={18} />
                    </button>
                    <span className="stepper-val" aria-live="polite" aria-label={`Jumlah ${qtyN}`}>
                      {qtyN}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQtyN((q) => Math.min(Math.max(left, 1), q + 1))}
                      disabled={qtyN >= left}
                      aria-label="Tambah jumlah"
                    >
                      <Icon name="plus" size={18} />
                    </button>
                  </div>
                  <button type="button" className="btn" disabled={left <= 0} onClick={addToBag}>
                    {left <= 0 ? "Semuanya sudah di tasmu" : `Masukkan tas · ${rp(p.price * qtyN)}`}
                  </button>
                </div>

                {/* Only customers who collected this from an order can write
                    these, and staff read them first. Silence means unreviewed,
                    so an empty list renders nothing rather than pleading. */}
                {rev?.stats.count > 0 && (
                  <section className="revs" aria-label="Ulasan">
                    <p className="revs-head">Kata mereka</p>
                    <ul className="revs-list">
                      {rev.reviews.slice(0, 4).map((r) => (
                        <li key={r.id} className="rev">
                          <p className="rev-top">
                            <Stars n={r.rating} />
                            <span className="rev-author">{r.author} · ambil terverifikasi</span>
                          </p>
                          {r.body && <p className="rev-body">{r.body}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </main>
          </>
        );
      })()}

      {view === "checkout" && (
        <>
          <header className="app-bar">
            <BackButton onClick={() => { setErr(""); setView("catalog"); setBagOpen(true); }} label="Kembali ke tas" />
            <p className="app-step">Satu langkah terakhir</p>
            <span className="app-bar-spacer" />
          </header>
          <main id="main" className="app-form">
            <h1 className="q serif">Jam ambil &amp; bayar</h1>

            <div className="sum">
              <span className="sum-when">
                <b>{dayLabel(avail.date)}</b> · Jl. Bondowoso No.8
              </span>
              <span className="sum-count">
                {bagCount} item · {rp(bagTotal)}
              </span>
            </div>

            <Err />

            <section className="ck-sec">
              <p className="ck-label" id="ck-slot">1 · Pilih jam</p>
              <ul className="slots" aria-labelledby="ck-slot">
                {avail.slots.map((s) => (
                  <li key={s.index}>
                    <button
                      type="button"
                      className={`slot ${slotIndex === s.index ? "on" : ""}`}
                      disabled={s.remaining <= 0}
                      aria-pressed={slotIndex === s.index}
                      onClick={() => setSlotIndex(s.index)}
                    >
                      {slotLabel(s.time)}
                      {s.remaining <= 0 ? (
                        <small>Penuh</small>
                      ) : s.remaining <= 2 ? (
                        <small>Sisa {s.remaining}</small>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="ck-sec">
              <p className="ck-label">2 · Data kamu</p>
              <div className="field">
                <label htmlFor="f-name" className="sr-only">Nama</label>
                <input
                  id="f-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Nama"
                />
              </div>
              <div className="field">
                <label htmlFor="f-wa" className="sr-only">Nomor WhatsApp</label>
                <input
                  id="f-wa"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={wa}
                  onChange={(e) => setWa(e.target.value)}
                  placeholder="Nomor WhatsApp, 08xx"
                  aria-describedby="f-wa-help"
                />
                <p className="help" id="f-wa-help">
                  <Icon name="check" size={14} />
                  Struk &amp; kode ambil dikirim ke sini. Tanpa akun.
                </p>
              </div>
            </section>

            <fieldset className="payset">
              <legend className="ck-label">3 · Bayar pakai</legend>
              <div className="paygrid">
                {PAYS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`pay ${payM === m ? "on" : ""}`}
                    aria-pressed={payM === m}
                    onClick={() => setPayM(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </fieldset>

            <button type="button" className="btn" onClick={placeOrder}>
              Bayar {rp(bagTotal)}
            </button>
            <p className="note">Pesananmu ditahan 15 menit sampai pembayaran masuk.</p>
          </main>
        </>
      )}

      {view === "qris" && order && (
        <>
          <header className="app-bar">
            <BackButton onClick={() => setView("checkout")} label="Kembali ke checkout" />
            <span className="brand brand-sm">NOISETTE</span>
            <span className="app-bar-spacer" />
          </header>
          <main id="main" className="qwrap">
            <h1 className="serif italic qtitle">Scan untuk bayar</h1>
            <button type="button" className="qr" onClick={confirmPaid}>
              <FakeQR seed={order.id} size={200} />
            </button>
            <p className="qamount">{rp(order.total)}</p>
            {order.paymentRef && <p className="qinv">Invoice {order.paymentRef}</p>}
            {/* role=timer, not aria-live: a per-second countdown would talk over everything else. */}
            <p className="qtimer" role="timer">
              Ditahan untukmu · {String(Math.floor(secs / 60)).padStart(2, "0")}:
              {String(secs % 60).padStart(2, "0")}
            </p>
            <p className="qdemo">Demo — ketuk kode QR untuk simulasi bayar</p>
            <button type="button" className="linkbtn" onClick={() => setView("checkout")}>
              Ganti metode bayar
            </button>
          </main>
        </>
      )}

      {view === "done" && order && (
        <main id="main" className="done">
          <p className="done-eyebrow">✦ Sampai jumpa ✦</p>
          <h1 className="serif italic">Pesanan aman</h1>
          <p className="done-sub">
            {dayLabel(order.pickupDate)}, {slotLabel(order.slotTime)} · Jl. Bondowoso No.8, Malang
          </p>

          <div className="pass">
            <p className="pass-label">Kode ambil — tunjukkan di konter</p>
            <FakeQR seed={order.id + "-pass"} size={150} />
            <p className="ordno">{order.id}</p>
          </div>

          <p className="help done-help">
            <Icon name="check" size={14} />
            Struk &amp; kode sudah dikirim ke WhatsApp kamu.
          </p>

          {claimed > 0 && (
            <p className="help done-help claimed">
              <Icon name="check" size={14} />
              Tersimpan di akunmu, bersama {claimed} pesanan sebelumnya.
            </p>
          )}

          <button
            type="button"
            className="btn ghost done-cal"
            onClick={() => {
              const blob = new Blob([pickupIcs(order)], { type: "text/calendar" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `noisette-${order.id}.ics`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Icon name="calendar" size={16} />
            Simpan ke kalender
          </button>
          <a
            className="linkbtn"
            href={googleCalendarUrl(order)}
            target="_blank"
            rel="noreferrer"
          >
            Atau simpan ke Google Calendar
          </a>

          {!customer && (
            <button type="button" className="linkbtn" onClick={() => setAcctOpen(true)}>
              Simpan pesanan ini ke akun
            </button>
          )}

          <button
            type="button"
            className="linkbtn"
            onClick={() => { setOrder(null); setView("catalog"); }}
          >
            Pesan yang lain
          </button>
        </main>
      )}

      {acctOpen && (
        <AccountSheet
          customer={customer}
          onClose={() => setAcctOpen(false)}
          onSignedIn={(c, claimedCount) => {
            setCustomer(c);
            setClaimed(claimedCount || 0);
            setAcctOpen(false);
          }}
          onSignedOut={() => {
            setCustomer(null);
            setClaimed(0);
            setAcctOpen(false);
          }}
        />
      )}

      {bagOpen && (
        <>
          <button
            type="button"
            className="sheetdim"
            aria-label="Tutup tas"
            onClick={() => setBagOpen(false)}
          />
          <aside className="sheet" aria-label="Tas kamu">
            <div className="sheet-head">
              <h2 className="serif">Tas kamu</h2>
              <button type="button" className="iconbtn" onClick={() => setBagOpen(false)} aria-label="Tutup tas">
                <Icon name="close" />
              </button>
            </div>

            <p className="sheet-date">
              Ambil <b>{dayLabel(avail.date)}</b>, 08.00–18.00 · dibuat pagi itu juga
            </p>

            {bagCount === 0 && <p className="sheet-empty">Tasmu masih kosong.</p>}

            {overStock.length > 0 && (
              <p className="warn" role="alert">
                <Icon name="alert" size={16} />
                <span>
                  {overStock
                    .map((o) => `${P(o.id)?.name} tinggal ${o.have}`)
                    .join(", ")}{" "}
                  untuk {dayLabel(avail.date)}. Kurangi jumlahnya atau pilih hari lain.
                </span>
              </p>
            )}

            <ul className="bag-list">
              {Object.entries(bag).map(([id, q]) => {
                const p = P(id);
                if (!p) return null;
                const s = stockOf(id);
                return (
                  <li key={id} className="bag-item">
                    <PhotoFrame photo={photoOf(p.id)} label={p.name} className="bag-photo" sizes="54px" />
                    <div className="bag-name">
                      {p.name}
                      <small>
                        {q} × {k(p.price)} = {rp(p.price * q)}
                      </small>
                    </div>
                    <div className="bag-step">
                      <button
                        type="button"
                        onClick={() => setQty(id, q - 1)}
                        aria-label={`Kurangi ${p.name}`}
                      >
                        <Icon name="minus" size={14} />
                      </button>
                      <span aria-live="polite" aria-label={`Jumlah ${q}`}>{q}</span>
                      <button
                        type="button"
                        onClick={() => setQty(id, q + 1)}
                        disabled={q >= s}
                        aria-label={`Tambah ${p.name}`}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {giftBoxQty > 0 && (
              <div className="giftpicker">
                <p className="micro giftpicker-head">
                  Pilih {giftBoxNeeded} isi Kotak Signature
                  <span className={giftPickTotal === giftBoxNeeded ? "caramel" : ""}>
                    {" "}{giftPickTotal} dari {giftBoxNeeded}
                  </span>
                </p>
                <ul className="giftpicker-list">
                  {giftPickItems.map((p) => {
                    const n = giftPicks[p.id] || 0;
                    return (
                      <li key={p.id} className="giftpicker-row">
                        <span className="giftpicker-name">{p.name}</span>
                        <div className="stepper stepper-sm">
                          <button
                            type="button"
                            onClick={() => setGiftPicks((g) => ({ ...g, [p.id]: Math.max(0, (g[p.id] || 0) - 1) }))}
                            disabled={n <= 0}
                            aria-label={`Kurangi ${p.name} di kotak`}
                          >
                            <Icon name="minus" size={14} />
                          </button>
                          <span className="stepper-val" aria-live="polite" aria-label={`${n} ${p.name} di kotak`}>
                            {n}
                          </span>
                          <button
                            type="button"
                            onClick={() => setGiftPicks((g) => ({ ...g, [p.id]: (g[p.id] || 0) + 1 }))}
                            disabled={giftPickTotal >= giftBoxNeeded}
                            aria-label={`Tambah ${p.name} di kotak`}
                          >
                            <Icon name="plus" size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="note">
                  {giftPickTotal === 0
                    ? "Kosongkan saja, nanti kami pilihkan enam di konter."
                    : giftPickTotal < giftBoxNeeded
                    ? `Pilih ${giftBoxNeeded - giftPickTotal} lagi, atau kosongkan biar kami yang pilih.`
                    : "Siap. Kami kemas persis seperti ini."}
                </p>
                {giftPickTotal > 0 && (
                  <button type="button" className="linkbtn giftpicker-clear" onClick={() => setGiftPicks({})}>
                    Kosongkan pilihan
                  </button>
                )}
              </div>
            )}

            {bagCount > 0 && (
              <>
                <label className="gift">
                  <input type="checkbox" checked={giftWrap} onChange={(e) => setGiftWrap(e.target.checked)} />
                  <span>Bungkus kado, pita karamel</span>
                  <span className="caramel">+{k(avail.giftWrapPrice)}</span>
                </label>
                <p className="bag-total">
                  <span>Total</span>
                  <span>{rp(bagTotal)}</span>
                </p>
              </>
            )}

            <button
              type="button"
              className="btn"
              disabled={bagCount === 0 || overStock.length > 0}
              onClick={() => { setBagOpen(false); setView("checkout"); }}
            >
              Pilih jam &amp; bayar
              <Icon name="arrowRight" size={16} />
            </button>
          </aside>
        </>
      )}
    </div>
  );
}
