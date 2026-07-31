// Scope is set to /pre-order via the Service-Worker-Allowed header (see
// next.config.mjs), even though this file is served from the root. Keep it
// minimal: cache the app shell so the pre-order screen still opens on a
// flaky connection. Stock and pricing are live data (the page is
// force-dynamic), so this never caches API calls or anything other than GET
// navigations — a stale cache fallback only ever appears when the network
// request has already failed.
const SHELL_CACHE = "noisette-preorder-shell-v1";
const SHELL_URLS = ["/pre-order", "/pre-order/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/pre-order")) return;

  // Network-first so a customer with a connection always sees live stock; the
  // cached shell only kicks in once the network request has already failed.
  if (request.mode === "navigate" || SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/pre-order")))
    );
  }
});
