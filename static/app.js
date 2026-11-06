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
  Notifications.clear();
  appDataPrefetchStarted = false;
  apiRefreshStarted.clear();
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
// Errore di una richiesta di login (rete, 429, 5xx, credenziali rifiutate).
// `invalid` è vero solo se il server ha risposto 401 (credenziali rifiutate).
class LoginError extends Error {
  constructor(message, invalid = false) { super(message); this.invalid = invalid; }
}
// La sessione non è rinnovabile: serve il form di login. Si lancia SOLO per un
// 401 sul login o se non ci sono credenziali salvate, mai per errori del server.
class LoginRequired extends Error {}

let syncRequests = 0;
let syncFailed = false;
let lastSyncAt = null;
let connectionToastTimer = null;

function showConnectionToast(message) {
  const toast = $("connection-toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(connectionToastTimer);
  connectionToastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

function renderSyncStatus() {
  const status = $("sync-status");
  if (!navigator.onLine || syncFailed) {
    status.textContent = "Impossibile connettersi al server.";
  } else if (syncRequests) {
    status.textContent = "Aggiornamento…";
  } else if (lastSyncAt) {
    status.textContent = `Aggiornato alle ${new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit", minute: "2-digit",
    }).format(lastSyncAt)}`;
  } else {
    status.textContent = "Aggiornamento…";
  }
}

async function requestWithStatus(request) {
  if (syncRequests === 0) syncFailed = false;
  syncRequests++;
  renderSyncStatus();
  try {
    const response = await request();
    if (response.ok || response.status < 500) lastSyncAt = new Date();
    else {
      syncFailed = true;
      showConnectionToast(navigator.onLine
        ? "Impossibile connettersi al server."
        : "Sei offline. Controlla la connessione.");
    }
    return response;
  } catch (error) {
    syncFailed = true;
    showConnectionToast(navigator.onLine
      ? "Impossibile connettersi al server."
      : "Sei offline. Controlla la connessione.");
    throw error;
  } finally {
    syncRequests--;
    renderSyncStatus();
  }
}

async function postLogin(username, password) {
  let res;
  try {
    res = await requestWithStatus(() => fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }));
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
    if (!cred) throw new LoginRequired(""); // nessuna credenziale salvata: mostra il form
    try {
      return await postLogin(cred.username, cred.password);
    } catch (e) {
      if (e.invalid) { // 401 sul login: password cambiata, serve un nuovo accesso
        await dbClear();
        throw new LoginRequired("Le credenziali salvate non sono più valide. Accedi di nuovo.");
      }
      throw e; // rete / 429 / 5xx: NON è un rifiuto, non si passa dal login
    }
  })().finally(() => { renewing = null; });
  return renewing;
}

let cacheScope = null;
const cacheRefreshes = new Map();
const cacheMisses = new Map();
const apiRefreshStarted = new Set();
const cacheVersions = new Map();
const cacheKey = (scope, path) => `api-cache:${scope}:${path}`;
const cacheVersionKey = (scope, path) => `${scope}:${path}`;

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
  if (previous !== scope) apiRefreshStarted.clear();
  await dbSet("api-cache-scope", scope);
  cacheScope = scope;
}

function cachedResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadCachedProfile() {
  try {
    const scope = await dbGet("api-cache-scope");
    if (!scope) return null;
    const cached = await dbGet(cacheKey(scope, "/api/me"));
    return cached?.data?.cache_scope === scope ? cached.data : null;
  } catch (error) {
    console.error("Impossibile leggere il profilo dalla cache locale.", error);
    return null;
  }
}

// API requests renew an expired session once. GET responses are cached per account.
async function fetchApi(path, options) {
  return requestWithStatus(async () => {
    let res = await fetch(path, options);
    if (res.status === 401) {
      await silentLogin();
      res = await fetch(path, options);
    }
    return res;
  });
}

function emitCacheEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function sameJsonValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && sameJsonValue(left[key], right[key]));
}

function cachePathsAffectedByMutation(path) {
  if (/^\/api\/noticeboard\/[^/]+\/\d+\/read$/.test(path)) return ["/api/noticeboard"];
  if (/^\/api\/events\/[0-9a-f]{12}\/(?:done|kind)$/.test(path)) return ["/api/events"];
  if (path === "/api/setup") {
    return ["/api/me", "/api/events", "/api/timetable", "/api/setup/timetable"];
  }
  if (path === "/api/subjects") {
    return ["/api/me", "/api/events", "/api/timetable", "/api/setup/timetable", "/api/grades"];
  }
  if (path === "/api/settings/grade-average-mode") return ["/api/me", "/api/grades"];
  if (path === "/api/settings/color-prompt-dismissed") return ["/api/me"];
  return [];
}

function invalidateApiCache(paths, scope = cacheScope) {
  if (!scope) return;
  for (const path of paths) {
    const key = cacheVersionKey(scope, path);
    cacheVersions.set(key, (cacheVersions.get(key) || 0) + 1);
    apiRefreshStarted.delete(`${scope}:${path}`);
  }
}

function refreshCachedApi(path, scope, options = {}, force = false) {
  if (!scope) return Promise.resolve();
  const refreshKey = `${scope}:${path}`;
  if (cacheRefreshes.has(refreshKey)) return cacheRefreshes.get(refreshKey);
  if (!force && apiRefreshStarted.has(refreshKey)) return Promise.resolve();

  apiRefreshStarted.add(refreshKey);
  const versionKey = cacheVersionKey(scope, path);
  const version = cacheVersions.get(versionKey) || 0;
  let succeeded = false;
  const pending = (async () => {
    const response = await fetchApi(path, options);
    if (!response.ok) throw new Error(`Risposta API ${response.status}`);
    const data = await response.clone().json();
    if (scope !== cacheScope || version !== (cacheVersions.get(versionKey) || 0)) return;
    const previous = await dbGet(cacheKey(scope, path));
    await dbSet(cacheKey(scope, path), { data });
    if (!sameJsonValue(previous?.data, data)) {
      emitCacheEvent("bv-api-cache-update", { path, previous: previous?.data || null, data });
    }
    succeeded = true;
  })()
    .catch((error) => emitCacheEvent("bv-api-cache-error", { path, error }))
    .finally(() => {
      cacheRefreshes.delete(refreshKey);
      if (!succeeded) apiRefreshStarted.delete(refreshKey);
      if (scope === cacheScope && version !== (cacheVersions.get(versionKey) || 0)) {
        api(path, options).catch((error) => {
          console.error("Impossibile riaggiornare la cache API dopo una modifica.", error);
        });
      }
    });
  cacheRefreshes.set(refreshKey, pending);
  return pending;
}

async function cacheSuccessfulResponse(path, response, scope, version) {
  if (!response.ok) return response;
  let data;
  try {
    data = await response.clone().json();
  } catch (error) {
    console.error("Impossibile salvare la risposta API nella cache locale.", error);
    return response;
  }
  if (scope === cacheScope) {
    if (version !== (cacheVersions.get(cacheVersionKey(scope, path)) || 0)) return null;
    try {
      const previous = await dbGet(cacheKey(scope, path));
      await dbSet(cacheKey(scope, path), { data });
      if (!previous || !sameJsonValue(previous.data, data)) {
        emitCacheEvent("bv-api-cache-update", { path, previous: previous?.data || null, data });
      }
    }
    catch (error) {
      console.error("Impossibile salvare la risposta API nella cache locale.", error);
    }
  }
  return response;
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") {
    const response = await fetchApi(path, options);
    if (response.ok) {
      invalidateApiCache(cachePathsAffectedByMutation(path));
    }
    return response;
  }

  const scope = cacheScope;
  if (!scope || !path.startsWith("/api/")) {
    return fetchApi(path, options);
  }

  let cached = null;
  try { cached = await dbGet(cacheKey(scope, path)); }
  catch (error) { console.error("Impossibile leggere la cache API locale.", error); }

  if (!cached) {
    const refreshKey = `${scope}:${path}`;
    if (!cacheMisses.has(refreshKey)) {
      const version = cacheVersions.get(cacheVersionKey(scope, path)) || 0;
      const pending = (async () => {
        const response = await fetchApi(path, options);
        const cachedResponse = await cacheSuccessfulResponse(path, response, scope, version);
        return { response: cachedResponse || response, retry: cachedResponse === null };
      })();
      cacheMisses.set(refreshKey, pending);
    }
    const pending = cacheMisses.get(refreshKey);
    let result;
    try { result = await pending; }
    finally {
      if (cacheMisses.get(refreshKey) === pending) cacheMisses.delete(refreshKey);
    }
    if (result.retry) return api(path, options);
    if (result.response.ok) apiRefreshStarted.add(refreshKey);
    return result.response.clone();
  }

  refreshCachedApi(path, scope, options);
  return cachedResponse(cached.data);
}

async function refreshCachedApiEndpoints() {
  const scope = cacheScope;
  if (!scope) return;
  try {
    const db = await openDb();
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const prefix = `api-cache:${scope}:`;
    const paths = keys
      .filter((key) => typeof key === "string" && key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((path) => path.startsWith("/api/")
        && !/^\/api\/noticeboard\/[^/]+\/\d+\/content$/.test(path));
    await Promise.all(paths.map((path) => refreshCachedApi(path, scope, {}, true)));
  } catch (error) {
    console.error("Impossibile riaggiornare gli endpoint API al ritorno nell’app.", error);
  }
  await Notifications.refreshBadge();
}

/* ---------- Interfaccia ---------- */
const $ = (id) => document.getElementById(id);
const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
let debugMode = new URLSearchParams(location.search).get("debug") === "1";
let currentView = null;
let appHistoryInitialized = false;
let currentProfile = null;
let profileSheetAction = null;

window.addEventListener("bv-sheet-close", () => {
  const action = profileSheetAction;
  profileSheetAction = null;
  action?.();
});

window.addEventListener("bv-enable-debug-mode", () => {
  debugMode = true;
  $("menu-debug").hidden = false;
});

window.addEventListener("offline", () => {
  syncFailed = true;
  renderSyncStatus();
  showConnectionToast("Sei offline. Controlla la connessione.");
});

window.addEventListener("online", renderSyncStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshCachedApiEndpoints();
});

const avatarViews = new Set(["home", "grades", "noticeboard", "setup", "settings","debug"]);
const menuViews = new Set(["home", "grades", "noticeboard", "settings", "debug"]);

function profileInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0])
    .toLocaleUpperCase("it-IT");
}

function openProfile() {
  const content = $("profile-sheet-template").content.cloneNode(true);
  const profile = currentProfile || {};
  const name = profile.name || "Informazione non disponibile";
  const initials = profileInitials(profile.name);
  content.querySelector(".profile-initials").textContent = initials;
  content.querySelector(".profile-name").textContent = name;
  content.querySelectorAll("[data-profile]").forEach((field) => {
    const key = field.dataset.profile;
    const value = key === "class_name"
      ? profile.class_name || profile.class_desc || profile.classroom
      : profile[key];
    field.textContent = value || "Non disponibile";
  });
  content.querySelector(".profile-settings").addEventListener("click", () => {
    profileSheetAction = () => {
      navigateTo("settings");
      Settings.open(appBack);
    };
    Sheet.close();
  });
  content.querySelector(".profile-logout").addEventListener("click", () => {
    if (!confirm("Uscire da questo dispositivo? Le credenziali salvate verranno cancellate.")) return;
    profileSheetAction = logout;
    Sheet.close();
  });
  content.querySelector(".profile-name").id = "profile-title";
  Sheet.open(content);
  document.querySelector(".sheet").setAttribute("aria-labelledby", "profile-title");
}

function show(view) {
  document.body.classList.toggle("auth-flow", view === "login" || view === "setup");
  $("view-login").hidden = view !== "login";
  $("view-setup").hidden = view !== "setup";
  $("view-settings").hidden = view !== "settings";
  $("view-home").hidden = view !== "home";
  $("view-grades").hidden = view !== "grades";
  $("view-noticeboard").hidden = view !== "noticeboard";
  $("view-debug").hidden = view !== "debug";
  $("avatar").hidden = !avatarViews.has(view);
  $("mode-toggle").hidden = view !== "home";
  $("feedback-button").hidden = !avatarViews.has(view);
  $("notifications-button").hidden = !avatarViews.has(view);
  $("menu-debug").hidden = !debugMode;
  $("back-button").hidden = ["home","login","setup"].includes(view);
  $("menu-button").hidden = !menuViews.has(view);
  $("app-menu").hidden = true;
  $("menu-button").setAttribute("aria-expanded", "false");
  $("status").textContent = "";
  currentView = view;
  Notifications.refreshBadge();
  if (!appHistoryInitialized) {
    history.replaceState({ bvApp: true, view }, "");
    appHistoryInitialized = true;
  }
}

function navigateTo(view) {
  if (currentView !== view) history.pushState({ bvApp: true, view }, "");
  show(view);
}

function replaceView(view) {
  history.replaceState({ bvApp: true, view }, "");
  appHistoryInitialized = true;
  show(view);
}

function showHome(promptColors = false) {
  replaceView("home");
  Home.load();
  prefetchSecondaryData();
  if (promptColors === true) Settings.promptColorSetup(() => showHome());
}

let appDataPrefetchStarted = false;
function prefetchSecondaryData() {
  if (appDataPrefetchStarted || !cacheScope) return;
  appDataPrefetchStarted = true;
  for (const path of ["/api/grades", "/api/noticeboard"]) {
    api(path).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || `Impossibile aggiornare ${path}.`);
      }
      await response.json();
    }).catch((error) => {
      console.error(`Impossibile precaricare ${path}.`, error);
      emitCacheEvent("bv-api-cache-error", { path, error });
      if (error instanceof LoginRequired) showLogin(error.message);
    });
  }
}

// Dopo l'accesso: se manca l'orario dell'anno in corso parte il setup, altrimenti la home
async function enter(profileResponse = null) {
  let me = null;
  try {
    const res = profileResponse || await fetchApi("/api/me");
    if (!res.ok) throw new Error(`Profilo non disponibile (${res.status}).`);
    me = await res.json();
  } catch (e) {
    if (e instanceof LoginRequired) return showLogin(e.message);
    if (await restoreOfflineHome()) return;
    // Errore del server o di rete: non è un rifiuto, quindi niente schermata di login
    // a meno che l'utente non ci sia già (accesso appena fatto dal form).
    const msg = "Server non raggiungibile. Riprova quando la connessione è disponibile.";
    if (currentView === "login") return showLogin(msg);
    $("status").textContent = msg;
    return;
  }
  currentProfile = me;
  $("avatar").textContent = profileInitials(me.name);
  $("avatar").setAttribute("aria-label", `Apri il profilo di ${me.name || "utente"}`);
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
    replaceView("setup");
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
    if (!keys.includes(`api-cache:${scope}:/api/events`)) {
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
  currentProfile = null;
  $("avatar").textContent = "";
  $("password").type = "password";
  $("password-toggle").setAttribute("aria-pressed", "false");
  $("password-toggle").setAttribute("aria-label", "Mostra password");
  const err = $("login-error");
  err.textContent = message;
  err.hidden = !message;
  replaceView("login");
}

function appBack() {
  if (Sheet.close()) return;
  if (currentView === "setup" && Setup.back()) return;
  if (currentView === "debug") return showHome();
  if (currentView === "settings") return showHome();
  if (currentView === "home") return history.back();
  if (history.state?.bvApp) history.back();
  else showHome();
}

function restoreView(view) {
  if (view === "home") showHome();
  else if (view === "grades") Grades.open();
  else if (view === "noticeboard") Noticeboard.open();
  else if (view === "settings") Settings.open(appBack);
  else if (view === "debug" && debugMode) {
    show("debug");
    Notifications.refreshDebugPanel();
  }
  else if (view === "setup") show("setup");
  else showLogin();
}

window.addEventListener("popstate", (event) => {
  if (Sheet.handleBack()) return;
  if (currentView === "setup" && Setup.back()) {
    history.pushState({ bvApp: true, view: "setup" }, "");
    return;
  }
  if (currentView === "grades" && Grades.handleBack()) return;
  const view = event.state?.bvApp ? event.state.view : null;
  if (currentView === "settings" && view === "grades") return showHome();
  if (view) return restoreView(view);
  if (currentView === "setup") {
    history.pushState({ bvApp: true, view: "setup" }, "");
    return;
  }
  if (currentView !== "home") showHome();
});

window.addEventListener("bv-api-cache-error", ({ detail }) => {
  if (detail.path === "/api/timetable" || detail.path === "/api/setup/timetable") {
    $("status").textContent = "Dati salvati mostrati; impossibile aggiornarli dal server.";
  }
});

window.addEventListener("bv-notification-open", ({ detail }) => {
  if (detail?.view === "home") {
    showHome();
    Home.openEventById(detail.eventId).then((opened) => {
      if (!opened && detail.event) EventSheet.showEvent(detail.event);
      else if (!opened) Home.goToDate(detail.date);
    }).catch((error) => {
      console.error("Impossibile aprire l’evento dalla notifica.", error);
      $("status").textContent = "Impossibile aprire questo evento.";
    });
  } else if (detail?.view === "grades") {
    navigateTo("grades");
    Grades.open().then(() => Grades.openGradeByIdentity(detail.gradeIdentity, detail.grade))
      .catch((error) => {
        console.error("Impossibile aprire il voto dalla notifica.", error);
        $("status").textContent = "Impossibile aprire questo voto.";
      });
  } else if (detail?.view === "noticeboard") {
    navigateTo("noticeboard");
    Noticeboard.open().then(() => Noticeboard.openEntryByIdentity(detail.evtCode, detail.pubId))
      .then((opened) => {
        if (!opened) $("status").textContent = "Questo avviso non è più disponibile.";
      }).catch((error) => {
        console.error("Impossibile aprire l’avviso dalla notifica.", error);
        $("status").textContent = "Impossibile aprire questo avviso.";
      });
  }
});

async function logout() {
  await requestWithStatus(() => fetch("/api/logout", { method: "POST" })).catch(() => {});
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

$("password-toggle").addEventListener("click", (event) => {
  const input = $("password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  event.currentTarget.setAttribute("aria-pressed", String(visible));
  event.currentTarget.setAttribute("aria-label", visible ? "Nascondi password" : "Mostra password");
});

$("avatar").addEventListener("click", openProfile);

$("back-button").addEventListener("click", appBack);
$("feedback-button").addEventListener("click", () => {
  $("feedback-dialog").showModal();
  $("feedback-message").focus();
});
$("feedback-close").addEventListener("click", () => $("feedback-dialog").close());
$("feedback-dialog").addEventListener("close", () => {
  $("feedback-form").reset();
  $("feedback-status").textContent = "";
});
$("feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const send = $("feedback-send");
  const status = $("feedback-status");
  send.disabled = true;
  status.classList.remove("success");
  status.textContent = "Invio in corso…";
  try {
    const response = await fetchApi("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: $("feedback-message").value }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || "Impossibile inviare il feedback. Riprova.");
    $("feedback-message").value = "";
    status.classList.add("success");
    status.textContent = "Grazie! Il tuo feedback è stato inviato.";
  } catch (error) {
    status.textContent = error instanceof LoginError
      ? "Sessione scaduta. Accedi di nuovo."
      : error.message || "Impossibile inviare il feedback. Riprova.";
  } finally {
    send.disabled = false;
  }
});
$("menu-button").addEventListener("click", () => {
  const menu = $("app-menu");
  menu.hidden = !menu.hidden;
  $("menu-button").setAttribute("aria-expanded", String(!menu.hidden));
});
$("menu-home").addEventListener("click", () => showHome());
$("menu-grades").addEventListener("click", () => {
  navigateTo("grades");
  Grades.open();
});
$("menu-noticeboard").addEventListener("click", () => {
  navigateTo("noticeboard");
  Noticeboard.open();
});
$("menu-settings").addEventListener("click", () => {
  navigateTo("settings");
  Settings.open(appBack);
});
$("menu-debug").addEventListener("click", () => {
  if (!debugMode) return;
  navigateTo("debug");
  Notifications.refreshDebugPanel();
});

// WebCrypto esiste solo su HTTPS o localhost: altrimenti niente salvataggio delle credenziali
if (!window.crypto?.subtle) {
  $("remember").checked = false;
  $("remember").disabled = true;
  document.querySelector(".hint").textContent =
    "Connessione non sicura (HTTP): le credenziali non possono essere salvate e dovrai accedere ogni volta. Apri il sito in HTTPS per attivare il salvataggio.";
}

/* ---------- Avvio ---------- */
(async function init() {
  if (!navigator.onLine) {
    syncFailed = true;
    renderSyncStatus();
    showConnectionToast("Sei offline. Controlla la connessione.");
  }
  const profileRequest = requestWithStatus(() => fetch("/api/me")).then(
    (response) => ({ response }),
    (error) => ({ error }),
  );
  const cachedProfile = await loadCachedProfile();
  if (cachedProfile) await enter(cachedResponse(cachedProfile));

  try {
    const result = await profileRequest;
    if ("error" in result) throw result.error;
    const res = result.response;
    if (res.ok) {
      if (cachedProfile) {
        const freshProfile = await res.clone().json().catch(() => null);
        if (freshProfile
          && freshProfile.cache_scope === cachedProfile.cache_scope
          && freshProfile.setup_needed === cachedProfile.setup_needed
          && freshProfile.color_setup_pending === cachedProfile.color_setup_pending) {
          try {
            await dbSet(cacheKey(freshProfile.cache_scope, "/api/me"), { data: freshProfile });
          } catch (error) {
            console.error("Impossibile aggiornare il profilo nella cache locale.", error);
          }
          return;
        }
      }
      return enter(res);
    }
    if (res.status !== 401) throw new Error(`Profilo non disponibile (${res.status}).`);
  } catch {
    if (cachedProfile && currentView === "home") return;
    if (await restoreOfflineHome()) return;
    $("status").textContent = "Server non raggiungibile.";
    return;
  }
  // Sessione rifiutata (401): prova il rinnovo silenzioso, altrimenti mostra il form
  try {
    await silentLogin();
    await enter();
  } catch (e) {
    if (e instanceof LoginRequired) return showLogin(e.message);
    // login non riuscito per rete/429/5xx: non è un rifiuto delle credenziali
    if (await restoreOfflineHome()) return;
    $("status").textContent = e.message || "Server non raggiungibile.";
  }
})();
