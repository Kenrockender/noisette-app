// Registered at the default root scope. /admin and /order are separate products
// with their own service workers (admin-sw.js, order-sw.js) and this one must
// never intercept their navigations, even though "/" scope technically includes
// them — hence the explicit path guard below rather than relying on scope alone.
const SHELL_CACHE = "noisette-site-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest"];
const EXCLUDED_PREFIXES = ["/admin", "/order", "/api"];

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
  if (EXCLUDED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  // Network-first for site navigations, with the cached shell as an offline
  // fallback. Anything not a navigation (page assets, images) just hits the
  // network normally — Next's own caching headers already handle those.
  if (request.mode === "navigate" || SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
  }
});
