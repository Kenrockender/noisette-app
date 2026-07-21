# Plan Perbaikan Noisette App

Gabungan dari dua telaah: upgrade dependency, lalu review keamanan & efisiensi (dua bug sudah direproduksi). Diurutkan dari yang paling penting.

## Ringkasan prioritas

| # | Item | Jenis | Prioritas | Status |
|---|------|-------|-----------|--------|
| 1 | Broken access control: standing order/langganan bisa dibajak antar akun | Keamanan | Harus | ✅ Selesai |
| 2 | Webhook 500 saat callback deposit bespoke | Bug | Harus | ✅ Selesai |
| 3 | Pola O(n^2) pada deliveries/reminders/admin day | Efisiensi | Sebaiknya | ✅ Selesai |
| 4 | Upgrade dependency (Next 14->16, React 18->19) | Perawatan | Terjadwal | ✅ Selesai |
| 5 | State in-memory -> Redis/Postgres | Infra produksi | Sudah didokumentasikan | 🔄 Sebagian (fondasi + Redis auth/staff + adapter Postgres `lib/store` selesai & terverifikasi; commissions/deliveries/notifications/reviews dll belum) |
| 6 | Security header global + anti-replay webhook | Keamanan | Nice to have | ✅ Selesai |

**Catatan implementasi (unit suite 28/28 via `node --test`; adapter Postgres `lib/store` 13/13 via harness pglite — lihat #5):**

- #1: cek kepemilikan di `saveStandingOrder` (`lib/store.js`) — `id` milik akun lain kini mengembalikan `not_found`. Menutup POST di kedua route sekaligus. Test: `test/routes.test.js`.
- #2: `app/api/payments/webhook/route.js` kini membalas `{ ok, id }` dari `res.order?.id ?? res.commission?.id`; deposit bespoke dapat ack 200, replay juga. Import route dibuat relatif supaya bisa dites langsung lewat handler. Test route-level: `test/routes.test.js`.
- #3: `deliveriesOn` & `reminders` memakai `Map` standing order sekali per panggilan; `getAdminDay` menghitung komitmen kedua kolam satu pass (`committedMapsOn`); lookup produk via `productById` Map.
- #6: `headers()` di `next.config.mjs` (CSP, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy) — sudah diverifikasi terkirim di semua route; webhook menolak callback bertimestamp lebih tua dari 5 menit (`stale_callback`), timestamp ikut ditandatangani HMAC. Simulator demo menyertakan `ts`.
- #4: `next` 16.2.10, `react`/`react-dom` 19.2.7. Migrasi kode: `cookies()` kini async (semua pemanggil di-`await`, termasuk `currentCustomer`/`requireWholesale`/`requireStaff` yang jadi async), `params` di route `[id]` di-`await`. Tidak ada API React lama yang terpakai. Diverifikasi: `node --test` 28/28, `next build` (Turbopack) bersih, semua halaman 200, login staf + sesi cookie + `/api/admin/day` jalan. Setelah pull, jalankan `npm install` dan hapus `.next` lama.

---

## 1. Broken access control (IDOR) pada standing order [HARUS]

**Masalah.** `saveStandingOrder` di `lib/store.js` menerima `id` untuk mengganti standing order, tapi tidak memeriksa apakah `id` itu milik pemanggil. Route yang memakainya juga tidak memeriksa pada jalur POST:

- `app/api/wholesale/standing/route.js` (POST)
- `app/api/account/subscriptions/route.js` (POST)

Jalur PATCH dan DELETE di route yang sama sudah cek kepemilikan (`mine`); hanya POST yang lupa. ID berurutan (`S-001`, `S-002`, ...) sehingga mudah ditebak.

**Bukti (sudah direproduksi).** Dua akun wholesale terpisah:

```
victim owns: S-001 -> C-0001
after attacker 'edit': S-001 -> C-0002
victim's list now: []
attacker's list now: [ 'S-001' ]
```

Penyerang menimpa standing order kafe lain, memindahkan kepemilikan ke dirinya, dan komitmen produksi yang diturunkan kitchen ikut berubah. Korban hilang diam-diam dari portalnya.

**Perbaikan.** Satu tempat, konsisten dengan `deleteStandingOrder` yang sudah punya param `customerId`. Di `lib/store.js` sebelum `db.standingOrders.set`:

```js
const soId = draft.id || "S-" + String(++db.stSeq).padStart(3, "0");
const existing = db.standingOrders.get(soId);
if (existing && existing.customerId !== customerId) return { error: "not_found" };
const so = { ...draft, id: soId, createdAt: existing?.createdAt ?? Date.now() };
```

**Test.** Tambah test level route/lib: akun A membuat `S-001`, akun B mencoba replace dengan `id: "S-001"` harus dapat `not_found`, dan `S-001` tetap milik A.

## 2. Webhook 500 saat callback deposit bespoke [HARUS]

**Masalah.** `app/api/payments/webhook/route.js` baris akhir membaca `res.order.id`, padahal `handlePaymentCallback` mengembalikan `{ commission, invoice }` (tanpa `order`) untuk deposit komisi.

**Bukti (sudah direproduksi).**

```
callback keys: [ 'commission', 'invoice' ]
res.order: undefined
ROUTE THROWS: TypeError - Cannot read properties of undefined (reading 'id') => HTTP 500
```

Di produksi, provider yang POST callback deposit asli akan: deposit tercatat + notifikasi terkirim, lalu route lempar 500. Provider anggap gagal -> retry -> replay juga tanpa `order` -> 500 lagi terus. Deposit sukses tapi provider tidak pernah dapat ack 200.

**Perbaikan.**

```js
return Response.json({ ok: true, id: res.order?.id ?? res.commission?.id, replay: !!res.replay });
```

**Test.** Panggil handler POST route dengan payload deposit komisi bertanda tangan valid, pastikan status 200 dan body memuat `id` komisi.

Catatan: tes lama tidak menangkap #1 dan #2 karena memanggil di level lib (`saveStandingOrder`, `handlePaymentCallback`) langsung, bukan lewat handler route.

## 3. Efisiensi: pola O(n^2) [SEBAIKNYA]

- `deliveriesOn` / `deliveriesFor` di `lib/deliveries.js`: di dalam `.map` memanggil `listStandingOrders()` tanpa argumen tiap iterasi, yang membangun ulang + sort array penuh setiap kali. Sama di `lib/reminders.js`. Ambil `listStandingOrders()` sekali ke `Map` di luar loop.
- `getAdminDay` di `lib/store.js`: per produk memanggil `wholesaleCommitted` + `subscriptionCommitted`, tiap panggilan loop semua standing order dan `occurrencesOf` membuat 28 objek `Date`. Hitung sekali per request (map `date:product -> committed`).
- `products.find(...)` dipanggil berulang di `createOrder`; ganti ke `Map` id->produk sekali di modul.

Semua ini aman dilakukan tanpa mengubah perilaku; hanya mengurangi kerja per request. Prioritas rendah selama data masih in-memory, tapi jadi penting begitu volume standing order naik.

## 4. Upgrade dependency [TERJADWAL]

| Package | Terpasang | Terbaru | Loncatan |
|---------|-----------|---------|----------|
| next | 14.2.5 | 16.2.10 | 2 major |
| react | 18.3.1 | 19.2.7 | 1 major |
| react-dom | 18.3.1 | 19.2.7 | 1 major |

Ketiganya major, ada breaking changes:

- React 18 -> 19: `ref` sebagai prop, `useFormState` -> `useActionState`, beberapa API lama dihapus. Syarat untuk Next 15+.
- Next 14 -> 16: request API jadi async (`cookies()`, `headers()`, `params`, `searchParams` harus di-`await`), caching default berubah, Node.js minimum naik. Ada codemod resmi.

**Urutan disarankan:** React 18->19 dulu, lalu Next 14->15->16 pakai codemod, jalankan `npm test` di tiap langkah. Kerjakan setelah #1 dan #2 selesai supaya perbaikan keamanan tidak tercampur migrasi besar.

Tidak ada devDependency (ESLint dll) di `package.json`, jadi hanya 3 paket inti ini.

## 5. State in-memory -> Redis/Postgres [SEDANG DIKERJAKAN]

OTP, sesi customer, rate limit, sesi staff semua di `globalThis`. Multi-instance (serverless) membuat rate limit dan sesi tidak konsisten antar instance. Migrasi ke Postgres (data durable) + Redis (hot path) per PRD.

**Keputusan arsitektur.**
- Backend dipilih via env, bukan flag kode (`lib/db/backend.js`): ada `DATABASE_URL` -> Postgres; ada env Upstash -> Redis; tidak ada -> in-memory (untuk `node --test` dan checkout kosong). Produksi wajib keduanya, menolak boot kalau kurang (`assertProductionBackends`).
- ID tetap string (`C-0001`, `S-001`, `N-0342`) sebagai `TEXT` PK, supaya route dan komponen frontend tidak berubah. Ganti ke integer key adalah follow-up terpisah.
- Rahasia (connection string/token) diisi sendiri oleh pemilik ke `.env.local`; kode tidak membuat akun atau menyimpan kredensial.

**Sudah selesai (fondasi + lapisan Redis).**
- `lib/db/pg.js` (pool Postgres, `query`, `transaction`), `lib/db/redis.js` (Upstash REST + namespacing `rk`), `lib/db/backend.js` (selektor + fail-closed produksi).
- `.env.example` dan `db/README.md` (panduan provisioning Supabase/Neon + Upstash).
- Driver ditambah ke `package.json` (`pg`, `@upstash/redis`); `npm install` sudah jalan.
- `lib/auth.js`: OTP, rate-limit, sesi customer -> Redis (kode & token disimpan HASH, TTL nyata) dengan fallback in-memory. Fungsi jadi async; semua pemanggil di-`await` (session.js, orders, account/orders, auth/session).
- `lib/staff.js`: sesi staff + rate-limit PIN -> Redis (token HASH) dengan fallback; `isStaff/staffSignIn/staffSignOut` jadi async; pemanggil di-`await`.
- Verifikasi: `node --test` 28/28, `next build` bersih, smoke test runtime (login staf + guard admin, OTP issue/verify/session, whoami, wrong-code) semua benar di jalur fallback, tanpa error server.

**Sudah selesai (cutover `lib/store` ke Postgres).** `lib/store/pg.js` kini adapter Postgres penuh, mirror fungsi-per-fungsi dari `lib/store/memory.js`, dipilih dispatcher (`lib/store.js`) via `hasPostgres()`. Cakupan: inventory dua kolam, hold stok all-or-nothing (transaksi + `SELECT ... FOR UPDATE`, CHECK constraint sebagai backstop), `expireHolds`, `markPaid`, `cancelOrder`, customers + claim guest order, standing order (retail & wholesale) dengan cek kapasitas + kepemilikan, jadwal/langganan, aplikasi wholesale, `getAdminDay`, dan audit log. Komitmen langganan/wholesale diturunkan dari template (`occurrencesOf`) sama persis seperti memory, bukan dari kolom counter.

- Timestamp menyeberang sebagai epoch-ms (cocok `Date.now()` memory); tanggal sebagai `YYYY-MM-DD`.
- Tiap penulisan uang/stok satu transaksi; baris error setelah penulisan melempar sentinel (`AbortTx`) supaya benar-benar rollback — bukan `return` (yang akan commit hold sebagian).
- **Keputusan ID:** mengikuti `schema.sql` apa adanya (`BIGSERIAL` untuk customers/standing_orders/commissions), dikembalikan sebagai string. Ini berbeda dari catatan "ID tetap TEXT" di atas; instruksi tegasnya adalah mengikuti `schema.sql`.
- **Tambahan kecil ke `schema.sql`** yang diperlukan interface tapi belum ada: `order_number_seq` (nomor `N-xxxx`), kolom `standing_orders.active`, kolom `inventory_transactions.pool`, dan tabel `wholesale_applications`. Semua diberi komentar di file.

**Verifikasi adapter Postgres (nyata, bukan mock).** Harness menjalankan `db/schema.sql` di Postgres sungguhan (pglite/WASM), menyemai katalog, lalu memanggil adapter lewat dispatcher `lib/store.js` dengan `DATABASE_URL` diset. 13/13 skenario hijau: no-oversell, hold all-or-nothing + rollback, bayar idempoten, hold kedaluwarsa melepas stok+slot, kapasitas slot, alokasi tak boleh di bawah komitmen, cancel melepas stok, langganan retail (reserve/edit/hapus/kepemilikan), alur aplikasi wholesale + promosi, `getAdminDay`, audit log. Menemukan & memperbaiki dua bug saat verifikasi: (a) error mid-transaksi tadinya commit hold sebagian; (b) query cek kapasitas tak menyertakan `product_id` di SELECT.

**Belum dikerjakan (sisa cutover).** Modul ini masih map `globalThis`: `lib/commissions.js`, `lib/deliveries.js`, `lib/notifications.js`, `lib/reviews.js`, `lib/reminders.js`, dan ledger invoice di `lib/payments.js`. Juga: seed baris `products` ke Postgres (saat ini katalog kode di `lib/store/catalog.js`); konsekuensi async sudah beres untuk `lib/store` (semua export dispatched sudah `async`, pemanggil di-`await`, termasuk test yang diaudit).

**Catatan verifikasi build/runtime.** `npm run build` dan smoke test browser TIDAK bisa diselesaikan di sandbox ini karena `app/layout.js` memakai `next/font/google` yang mengunduh font dari `fonts.googleapis.com` saat build, dan host itu diblokir jaringan di sini (`fetch failed`) — tidak terkait perubahan kode. Build 08:59 sebelumnya berhasil saat jaringan masih ada (font ter-vendor di `.next/static/media`). Jalankan `npm run build` di lingkungan ber-jaringan untuk konfirmasi akhir. Jalur Postgres nyata terhadap Supabase/Neon juga perlu kredensial pemilik: `psql "$DATABASE_URL" -f db/schema.sql`, `npm install`, `npm run dev`, lalu uji login + order. Unit suite tetap 28/28 (`node --test`).

## 6. Header keamanan + anti-replay webhook [NICE TO HAVE]

- Tambah `headers()` di `next.config.mjs` untuk CSP, `X-Content-Type-Options`, `Referrer-Policy`, dll. Halaman `/admin` sudah `noindex`, tapi header tingkat app belum ada.
- Webhook hanya andalkan HMAC + idempotency status. Untuk lebih ketat, tambah cek timestamp payload agar callback lama tidak bisa diputar ulang.

---

## Yang sudah solid (tidak perlu diubah)

- `customerId` selalu dari sesi, tidak pernah dari body (kecuali celah #1).
- Webhook: verifikasi HMAC atas raw body sebelum parse, `timingSafeEqual`, fail-closed tanpa secret di produksi, idempotent replay.
- OTP & PIN staff: `timingSafeEqual`, rate limit, fail-closed di produksi, tidak membocorkan keberadaan akun.
- Inventory dua pool terpisah, all-or-nothing hold + rollback, audit log append-only, alokasi tidak bisa turun di bawah yang sudah terjual/dijanjikan.

## Urutan eksekusi yang disarankan

1. #1 dan #2 sekaligus (perbaikan kecil + test yang menutup keduanya di level route).
2. Jalankan `node --test`, pastikan hijau.
3. #3 efisiensi (opsional, aman).
4. #4 upgrade dependency, bertahap dengan test tiap langkah.
5. #6 header keamanan.
6. #5 saat pindah ke infra produksi.
