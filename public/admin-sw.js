// Scope is set to /admin via the Service-Worker-Allowed header (see next.config.mjs),
// even though this file is served from the root. Keep it minimal: cache the app shell
// so the counter still opens on a flaky connection, and let every other request just
// hit the network — this is order data, it must never go stale.
const SHELL_CACHE = "noisette-admin-shell-v1";
const SHELL_URLS = ["/admin", "/admin/manifest.webmanifest"];

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
  if (!url.pathname.startsWith("/admin")) return;

  // Network-first for the shell so staff see fresh UI when online, with the
  // cached shell as a fallback when the network drops mid-shift.
  if (request.mode === "navigate" || SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/admin")))
    );
  }
});
