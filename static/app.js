"use strict";

/* ---------- Archivio locale (IndexedDB) ---------- */
const DB_NAME = "betterviva", STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result.result);
    tx.onerror = () => reject(tx.error);
  });
}
const dbGet = (k) => kv("readonly", (s) => s.get(k));
const dbSet = (k, v) => kv("readwrite", (s) => s.put(v, k));
const dbDelete = (k) => kv("readwrite", (s) => s.delete(k));
const dbClear = async () => {
  await kv("readwrite", (s) => s.clear());
  cacheScope = null;
};

/* ---------- Credenziali cifrate ----------
   La chiave AES è NON esportabile: il browser la usa ma nessuno script
   può leggerne i byte. Protegge da copie dei dati, non da uno script
   malevolo attivo nella pagina (per questo il server imposta una CSP rigida). */
async function saveCredentials(username, password) {
  if (!crypto.subtle) return; // contesto non sicuro (HTTP): niente WebCrypto
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify({ username, password }));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  await dbSet("cred", { key, iv, ct });
}
async function loadCredentials() {
  if (!crypto.subtle) return null;
  const rec = await dbGet("cred");
  if (!rec) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, rec.key, rec.ct);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    await dbClear();
    return null;
  }
}

/* ---------- Chiamate al backend ---------- */
class LoginError extends Error {
  constructor(message, invalid = false) { super(message); this.invalid = invalid; }
}

async function postLogin(username, password) {
  let res;
  try {
    res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new LoginError("Connessione non riuscita. Controlla la rete e riprova.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new LoginError(body.detail || "Accesso non riuscito.", res.status === 401);
  return body;
}

// Rinnovo silenzioso: se il token è scaduto, rifà il login con le credenziali custodite
let renewing = null;
function silentLogin() {
  renewing ||= (async () => {
    const cred = await loadCredentials();
    if (!cred) throw new LoginError("", true); // nessuna credenziale salvata: mostra il form
    try {
      return await postLogin(cred.username, cred.password);
    } catch (e) {
      if (e.invalid) { // password cambiata: serve un nuovo accesso
        await dbClear();
        throw new LoginError("Le credenziali salvate non sono più valide. Accedi di nuovo.", true);
      }
      throw e;
    }
  })().finally(() => { renewing = null; });
  return renewing;
}

let cacheScope = null;
let cacheEpoch = 0;
const cacheRefreshes = new Map();
const cacheKey = (scope, path) => `api-cache:${scope}:${path}`;

async function clearApiCache(scope = cacheScope) {
  if (!scope) return;
  const prefix = `api-cache:${scope}:`;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.getAllKeys();
    request.onsuccess = () => request.result
      .filter((key) => typeof key === "string" && key.startsWith(prefix))
      .forEach((key) => store.delete(key));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function setCacheScope(scope) {
  const previous = await dbGet("api-cache-scope");
  if (previous && previous !== scope) await clearApiCache(previous);
  if (previous !== scope) cacheEpoch++;
  await dbSet("api-cache-scope", scope);
  cacheScope = scope;
}

function cachedResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// API requests renew an expired session once. GET responses are cached per account.
async function fetchApi(path, options) {
  let res = await fetch(path, options);
  if (res.status === 401) {
    await silentLogin();
    res = await fetch(path, options);
  }
  return res;
}

function emitCacheEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function cacheSuccessfulResponse(path, response, scope) {
  if (!response.ok) return response;
  try {
    const data = await response.clone().json();
    if (scope === cacheScope) await dbSet(cacheKey(scope, path), { data });
  } catch (error) {
    console.error("Impossibile salvare la risposta API nella cache locale.", error);
  }
  return response;
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") {
    const response = await fetchApi(path, options);
    if (response.ok) {
      cacheEpoch++;
      try { await clearApiCache(); }
      catch (error) { console.error("Impossibile invalidare la cache API locale.", error); }
    }
    return response;
  }

  const scope = cacheScope;
  if (!scope || !path.startsWith("/api/") || path === "/api/me") {
    return fetchApi(path, options);
  }

  let cached = null;
  try { cached = await dbGet(cacheKey(scope, path)); }
  catch (error) { console.error("Impossibile leggere la cache API locale.", error); }

  const refresh = async () => {
    const epoch = cacheEpoch;
    const response = await fetchApi(path, options);
    if (!response.ok) throw new Error(`Risposta API ${response.status}`);
    const data = await response.clone().json();
    if (scope === cacheScope && epoch === cacheEpoch) {
      try {
        await dbSet(cacheKey(scope, path), { data });
        emitCacheEvent("bv-api-cache-update", { path, data });
      } catch (error) {
        console.error("Impossibile aggiornare la cache API locale.", error);
      }
    }
    return response;
  };

  if (!cached) {
    const response = await fetchApi(path, options);
    return cacheSuccessfulResponse(path, response, scope);
  }

  const refreshKey = `${scope}:${path}`;
  if (!cacheRefreshes.has(refreshKey)) {
    const pending = refresh()
      .catch((error) => emitCacheEvent("bv-api-cache-error", { path, error }))
      .finally(() => cacheRefreshes.delete(refreshKey));
    cacheRefreshes.set(refreshKey, pending);
  }
  return cachedResponse(cached.data);
}

/* ---------- Interfaccia ---------- */
const $ = (id) => document.getElementById(id);
const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function show(view) {
  $("view-login").hidden = view !== "login";
  $("view-setup").hidden = view !== "setup";
  $("view-settings").hidden = view !== "settings";
  $("view-home").hidden = view !== "home";
  $("avatar").hidden = view !== "home" && view !== "setup" && view !== "settings";
  $("settings-button").hidden = view !== "home";
  $("status").textContent = "";
}

function showHome(promptColors = false) {
  show("home");
  Home.load();
  if (promptColors) Settings.promptColorSetup(() => showHome());
}

// Dopo l'accesso: se manca l'orario dell'anno in corso parte il setup, altrimenti la home
async function enter(profileResponse = null) {
  let me = null;
  try {
    const res = profileResponse || await api("/api/me");
    if (!res.ok) throw new Error(`Profilo non disponibile (${res.status}).`);
    me = await res.json();
  } catch (e) {
    if (e instanceof LoginError) return showLogin(e.message);
    if (await restoreOfflineHome()) return;
    return showLogin("Server non raggiungibile. Riprova quando la connessione è disponibile.");
  }
  if (me.cache_scope) {
    try {
      await setCacheScope(me.cache_scope);
      await dbSet(cacheKey(me.cache_scope, "/api/me"), { data: me });
    } catch (error) {
      cacheScope = null;
      console.error("Impossibile inizializzare la cache locale per questo account.", error);
    }
  }
  if (me && me.setup_needed) {
    show("setup");
    Setup.start(me.first_name || titleCase((me.name || "").split(" ")[0]), showHome);
  } else {
    showHome(!!me?.color_setup_pending);
  }
}

async function restoreOfflineHome() {
  try {
    const scope = await dbGet("api-cache-scope");
    if (!scope) return false;
    const db = await openDb();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!keys.some((key) => typeof key === "string" && key.startsWith(`api-cache:${scope}:/api/events?`))) {
      return false;
    }
    cacheScope = scope;
    showHome();
    return true;
  } catch (error) {
    console.error("Impossibile ripristinare la sessione offline dalla cache locale.", error);
    return false;
  }
}

function showLogin(message = "") {
  const err = $("login-error");
  err.textContent = message;
  err.hidden = !message;
  show("login");
}

window.addEventListener("bv-api-cache-error", ({ detail }) => {
  if (detail.path === "/api/timetable" || detail.path === "/api/setup/timetable") {
    $("status").textContent = "Dati salvati mostrati; impossibile aggiornarli dal server.";
  }
});

async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  await dbClear();
  $("password").value = "";
  showLogin();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("login-btn");
  btn.disabled = true;
  btn.textContent = "Accesso in corso…";
  $("login-error").hidden = true;
  try {
    const username = $("username").value.trim();
    const password = $("password").value;
    await postLogin(username, password);
    if ($("remember").checked) await saveCredentials(username, password);
    else await dbClear();
    const previousScope = await dbGet("api-cache-scope");
    if (previousScope) {
      await clearApiCache(previousScope);
      await dbDelete("api-cache-scope");
    }
    cacheScope = null;
    $("password").value = "";
    await enter();
  } catch (err) {
    showLogin(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Accedi";
  }
});

$("avatar").addEventListener("click", () => {
  if (confirm("Uscire da questo dispositivo? Le credenziali salvate verranno cancellate.")) logout();
});

$("settings-button").addEventListener("click", () => Settings.open(showHome));

// WebCrypto esiste solo su HTTPS o localhost: altrimenti niente salvataggio delle credenziali
if (!window.crypto?.subtle) {
  $("remember").checked = false;
  $("remember").disabled = true;
  document.querySelector(".hint").textContent =
    "Connessione non sicura (HTTP): le credenziali non possono essere salvate e dovrai accedere ogni volta. Apri il sito in HTTPS per attivare il salvataggio.";
}

/* ---------- Avvio ---------- */
(async function init() {
  try {
    const res = await fetch("/api/me");
    if (res.ok) return enter(res);
  } catch {
    if (await restoreOfflineHome()) return;
    $("status").textContent = "Server non raggiungibile.";
    return;
  }
  // Nessuna sessione valida: prova il rinnovo silenzioso, altrimenti mostra il form
  try {
    await silentLogin();
    await enter();
  } catch (e) {
    showLogin(e.message);
  }
})();
