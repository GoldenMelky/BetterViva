"use strict";

/* Service worker di BetterViva.
   - Il guscio dell'app viene servito subito dalla cache; la rete aggiorna la copia
     per l'apertura successiva.
   - /api/* non passa mai di qui: i dati personali sono gestiti in IndexedDB per account. */
const CACHE = "betterviva-v1";   // cambialo solo se vuoi forzare la pulizia della cache
const SHELL = [
  "/",
  "/static/style.css", "/static/home.js", "/static/grades.js", "/static/calendar.js", "/static/sheet.js", "/static/setup.js", "/static/settings.js", "/static/app.js",
  "/static/manifest.webmanifest",
  "/static/fonts/inter-latin-400-normal.woff2", "/static/fonts/figtree-latin-400-normal.woff2",
  "/static/fonts/dongle-latin-400-normal.woff2",
  "/static/icons/icon-192.png", "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // un file mancante non deve bloccare l'installazione: si aggiunge uno per volta
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;                      // mai in cache
  if (url.pathname !== "/" && !url.pathname.startsWith("/static/")) return;

  const network = fetch(req, { cache: "no-cache" }).then(async (res) => {
    if (res.ok) await (await caches.open(CACHE)).put(req, res.clone());
    return res;
  });
  event.waitUntil(network.catch((err) => console.error("Aggiornamento asset non riuscito.", err)));
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      return cached;
    }
    return network;
  })());
});
