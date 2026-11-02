"use strict";

/* Service worker di BetterViva.
   - Il guscio dell'app viene servito subito dalla cache; la rete aggiorna la copia
     per l'apertura successiva.
   - /api/* non passa mai di qui: i dati personali sono gestiti in IndexedDB per account. */
const CACHE = "betterviva-v3";
const SHELL = [
  "/",
  "/static/build/assets/index.css", "/static/build/assets/app.js",
  "/static/build/assets/manifest.webmanifest", "/static/build/assets/icon-192.png",
  "/static/build/assets/apple-touch-icon.png", "/static/build/assets/figtree-latin-400-normal.woff2",
  "/static/sheet.js", "/static/home.js", "/static/settings.js", "/static/app.js",
  "/static/icons/icon-512.png",
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
