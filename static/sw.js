"use strict";

/* Service worker di BetterViva.
   - Il guscio dell'app viene servito subito dalla cache, anche offline.
   - All'avvio gli asset vengono confrontati con la rete; se cambiano, la pagina si ricarica.
   - /api/* non passa mai di qui: i dati personali sono gestiti in IndexedDB per account. */
const CACHE = "betterviva-v9";
const SHELL = [
  "/",
  "/static/style.css", "/static/home.js", "/static/grades.js", "/static/absences.js", "/static/noticeboard.js", "/static/calendar.js", "/static/sheet.js", "/static/setup.js", "/static/settings.js", "/static/notifications.js", "/static/app.js", "/static/pwa.js",
  "/static/manifest.webmanifest",
  "/static/fonts/figtree-latin-400-normal.woff2",
  "/static/icons/icon-192.png", "/static/icons/icon-512.png", "/static/icons/icon-maskable-512.png", "/static/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // un file mancante non deve bloccare l'installazione: si aggiunge uno per volta
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

let refreshPromise;

async function sameContent(cached, fresh) {
  if (!cached) return false;
  const [cachedBody, freshBody] = await Promise.all([
    cached.clone().arrayBuffer(),
    fresh.clone().arrayBuffer(),
  ]);
  if (cachedBody.byteLength !== freshBody.byteLength) return false;
  const cachedBytes = new Uint8Array(cachedBody);
  const freshBytes = new Uint8Array(freshBody);
  return cachedBytes.every((byte, index) => byte === freshBytes[index]);
}

function refreshAssets() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const cache = await caches.open(CACHE);
    const updates = await Promise.all(SHELL.map(async (url) => {
      const request = new Request(url, { cache: "no-cache" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`Richiesta asset non riuscita (${response.status}): ${url}`);
      const cached = await cache.match(request, { ignoreSearch: true });
      return { request, response, changed: !(await sameContent(cached, response)) };
    }));
    const changed = updates.some((update) => update.changed);
    if (changed) {
      await Promise.all(updates
        .filter((update) => update.changed)
        .map(({ request, response }) => cache.put(request, response)));
    }
    return changed;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CHECK_FOR_UPDATES") return;
  event.waitUntil(refreshAssets().then((changed) => {
    if (changed) {
      return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: "ASSETS_UPDATED" });
      });
    }
  }).catch((error) => {
    console.error("Impossibile aggiornare la cache degli asset.", error);
  }));
});

self.addEventListener("fetch", (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;                      // mai in cache
  if (url.pathname !== "/" && !url.pathname.startsWith("/static/")) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok) await (await caches.open(CACHE)).put(req, response.clone());
    return response;
  })());
});
