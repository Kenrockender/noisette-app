# Plan Perbaikan Noisette App

Gabungan dari dua telaah: upgrade dependency, lalu review keamanan & efisiensi (dua bug sudah direproduksi). Diurutkan dari yang paling penting.

## Ringkasan prioritas

| # | Item | Jenis | Prioritas | Status |
|---|------|-------|-----------|--------|
| 1 | Broken access control: standing order/langganan bisa dibajak antar akun | Keamanan | Harus | ✅ Selesai |
| 2 | Webhook 500 saat callback deposit bespoke | Bug | Harus | ✅ Selesai |
| 3 | Pola O(n^2) pada deliveries/reminders/admin day | Efisiensi | Sebaiknya | ✅ Selesai |
| 4 | Upgrade dependency (Next 14->16, React 18->19) | Perawatan | Terjadwal | ✅ Selesai |
| 5 | State in-memory -> Redis/Postgres | Infra produksi | Sudah didokumentasikan | 🔄 Kode selesai untuk semua modul (store, notifications, commissions, deliveries, reviews, reminders, payments), **tapi adapter Postgres belum diverifikasi terhadap Postgres sungguhan** — lihat catatan di bawah |
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

**Selesai (cutover lima modul sisanya + ledger invoice).** Pola yang sama dengan `lib/store` diulang untuk tiap modul: `lib/<nama>/memory.js` (logika lama dipindah apa adanya) + `lib/<nama>/pg.js` (adapter baru) + `lib/<nama>.js` sebagai dispatcher via `hasPostgres()`. Tercakup: `notifications` (tabel `notifications`), `reviews` (tabel `reviews`, join ke `order_items` untuk `order_item_id`), `commissions` (tabel `commissions` + `commission_capacity`), `deliveries` (tabel `delivery_overrides`), ledger invoice di `payments` (diekstrak ke `lib/payments/memory.js` + `lib/payments/pg.js`, tabel `invoices`), dan dedupe pengingat harian di `reminders` (tabel `reminder_log` baru — lihat "Tambahan kecil" di bawah). `db/seed-products.mjs` sudah ada untuk menyemai `products`.

**Review pass menemukan & memperbaiki beberapa bug nyata sebelum ini dianggap selesai** (ditemukan lewat `node --check` per file + pembacaan manual terhadap `db/schema.sql`, bukan lewat Postgres sungguhan — lihat catatan verifikasi di bawah):
- `lib/deliveries/pg.js`: backtick ter-escape (`` \`...\` ``) di `invoicesFor` — `SyntaxError` murni, bikin seluruh app gagal start (dispatcher meng-import `pg.js` tanpa syarat, bukan hanya saat `DATABASE_URL` di-set). Diperbaiki.
- `lib/commissions/pg.js`: kolom `name` (nama kontak pemesan) tidak pernah disimpan — `commissions` di `schema.sql` tidak punya kolom itu, jadi `getCommission`/`listCommissions`/`commissionsFor` selalu kembalikan nama kosong setelah request pertama. `AdminDash.js` merender `{c.name}` di pipeline bespoke, jadi ini akan tampil kosong di produksi. Ditambah kolom `commissions.name TEXT NOT NULL DEFAULT ''` ke schema + pg.js diperbaiki.
- `lib/commissions/pg.js` -> `lib/payments/pg.js`: id komisi berformat `"B-0004"` (dari `formatId`) dikirim langsung sebagai parameter kolom `invoices.commission_id` yang `BIGINT` — akan gagal dengan error tipe di Postgres sungguhan untuk setiap pembuatan invoice deposit bespoke. Diperbaiki dengan konversi id di `payments/pg.js` sebelum query.
- `lib/commissions/pg.js`: `customerId` dikembalikan sebagai `Number`, beda dari konvensi di seluruh app (selalu `String`, lihat keputusan ID di atas). Diperbaiki, termasuk di `lib/payments/pg.js`'s `mapInvoice`.
- `lib/commissions/pg.js`: pengecekan kapasitas minggu di `advanceCommission` awalnya memakai counter tersimpan (`commission_capacity.booked_cakes`, increment manual) — berbeda doktrin dari `lib/store/pg.js` ("komitmen diturunkan, bukan disimpan"). Secara kebetulan konsisten selama `advanceCommission` satu-satunya penulis, tapi rapuh. Diperbaiki: baris `commission_capacity` tetap dikunci (`FOR UPDATE`) sebagai mutex per-minggu, tapi jumlah aktual dihitung ulang (`COUNT(*)`) dari `commissions`, sama seperti `bookedCakes()` yang diekspor.
- Banyak route (`/api/commissions`, `/api/admin/commissions`, `/api/admin/reviews`, `/api/reviews`, `/api/admin/notifications`, **`/api/orders` — jalur checkout inti, bikin `createInvoice` tak ke-`await`**) memanggil fungsi yang sekarang dispatched-async tanpa `await`. Di bawah backend memory ini "kebetulan jalan" untuk sebagian modul (fungsinya sync), tapi untuk `lib/reviews.js` dispatchernya sengaja dibungkus `async` sehingga **dua bug di antaranya sudah pecah bahkan di backend memory default** (`/api/admin/reviews` PATCH dan `/api/reviews?mine=1`/`?all=1`), dan seluruhnya akan pecah begitu `DATABASE_URL` di-set. Semua pemanggil yang ditemukan sudah ditambah `await`; test terkait (`test/commissions.test.js`, `test/payments.test.js`, `test/routes.test.js`) diperbarui sekalian.

**Diperbaiki: transaksi bersarang di `handlePaymentCallback`.** `lib/payments/pg.js` membuka transaksinya sendiri, dan di dalamnya tadinya memanggil `advanceCommission` (`lib/commissions/pg.js`) dan `markPaid` (`lib/store/pg.js`) — keduanya membuka transaksi SENDIRI di koneksi pool yang berbeda, jadi commit keduanya tidak benar-benar bagian dari transaksi luar. Kalau langkah setelahnya (`UPDATE invoices ... SET status='paid'`) gagal setelah salah satu sudah commit, komisi/order bisa berstatus "sudah dibayar" sementara baris invoice tetap `pending`. Diperbaiki dengan menambah parameter `existingClient` opsional ke `markPaid(orderId, existingClient)` dan `advanceCommission(id, existingClient)`: kalau diisi, keduanya jalan di client yang sama alih-alih membuka transaksi baru; kalau tidak diisi (pemanggil lama), perilakunya sama seperti sebelumnya. `handlePaymentCallback` sekarang mengalirkan client transaksinya sendiri ke keduanya, jadi commit atau rollback-nya benar-benar satu paket dengan update invoice.

**Diperbaiki: celah sama di `cancelAndRefundOrder`.** Fungsi ini memanggil `cancelOrder` (`lib/store/pg.js`) lalu `refundOrderInvoice` (`lib/payments/pg.js`) berurutan — keduanya tadinya membuka transaksi sendiri-sendiri juga, jadi kalau refund gagal setelah cancel sudah commit, order jadi berstatus cancelled (stok sudah dilepas) sementara invoice-nya tetap "paid", bukan "refunded". Pola perbaikannya sama: `cancelOrder` sekarang menerima `client` di object opsi (`cancelOrder(orderId, { actor, client })`) dan `refundOrderInvoice(orderId, existingClient)` menerima client kedua sebagai parameter, keduanya jalan di client yang sama kalau diisi. `cancelAndRefundOrder` sekarang membuka satu transaksi dan mengalirkan client-nya ke keduanya.

**Masih perlu diverifikasi terhadap Postgres sungguhan** untuk kedua perbaikan di atas (logis dan lolos `node --check` + `node --test` 28/28, tapi belum pernah benar-benar dijalankan lewat koneksi Postgres asli di sandbox ini).

**Catatan verifikasi.** Tidak ada Postgres sungguhan yang bisa dijalankan di sandbox sesi ini untuk verifikasi ujung-ke-ujung seperti pass `lib/store` sebelumnya (harness pglite dari pass itu tidak ada di repo/tidak dijalankan ulang di sini; Docker terpasang tapi daemon-nya tidak menyala). Yang sudah diverifikasi: `node --check` pada tiap file baru (menemukan bug syntax di atas), dan `node --test` 28/28 tetap hijau di jalur memory setelah semua perbaikan. **Yang BELUM diverifikasi:** jalur Postgres sungguhan untuk lima modul baru ini — jalankan `db/schema.sql` (sudah termasuk `commissions.name`, `invoice_number_seq`, `reminder_log`) terhadap Supabase/Neon nyata, set `DATABASE_URL`, lalu ulangi skenario commissions/reviews/notifications/deliveries/payments sebelum menganggap #5 benar-benar selesai.

**Catatan verifikasi build/runtime (dari pass sebelumnya, masih berlaku).** `npm run build` dan smoke test browser TIDAK bisa diselesaikan di sandbox ini karena `app/layout.js` memakai `next/font/google` yang mengunduh font dari `fonts.googleapis.com` saat build, dan host itu diblokir jaringan di sini (`fetch failed`) — tidak terkait perubahan kode. Build 08:59 sebelumnya berhasil saat jaringan masih ada (font ter-vendor di `.next/static/media`). Jalankan `npm run build` di lingkungan ber-jaringan untuk konfirmasi akhir. Jalur Postgres nyata terhadap Supabase/Neon juga perlu kredensial pemilik: `psql "$DATABASE_URL" -f db/schema.sql`, `npm install`, `npm run dev`, lalu uji login + order. Unit suite tetap 28/28 (`node --test`).

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
