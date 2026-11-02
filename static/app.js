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
let currentView = null;
let appHistoryInitialized = false;

window.addEventListener("offline", () => {
  syncFailed = true;
  renderSyncStatus();
  showConnectionToast("Sei offline. Controlla la connessione.");
});

window.addEventListener("online", renderSyncStatus);

function show(view) {
  $("status").textContent = "";
  currentView = view;
  window.dispatchEvent(new CustomEvent("bv-view-change", { detail: view }));
  if (!appHistoryInitialized) {
    history.replaceState({ bvApp: true, view }, "");
    appHistoryInitialized = true;
  }
}

function navigateTo(view) {
  if (currentView !== view) history.pushState({ bvApp: true, view }, "");
  show(view);
}

function notifySettingsOpen(onBack) {
  window.dispatchEvent(new CustomEvent("bv-open-settings", { detail: { onBack } }));
}

function openSettings(onBack) {
  navigateTo("settings");
  notifySettingsOpen(onBack);
}

function replaceView(view) {
  history.replaceState({ bvApp: true, view }, "");
  appHistoryInitialized = true;
  show(view);
}

function showHome(promptColors = false) {
  replaceView("home");
  Home.load();
  if (promptColors === true) Settings.promptColorSetup(() => showHome());
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
    window.BetterViva.startSetup(me.first_name || titleCase((me.name || "").split(" ")[0]), showHome);
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
  window.dispatchEvent(new CustomEvent("bv-login-error", { detail: message }));
  replaceView("login");
}

function appBack() {
  if (Sheet.handleBack()) return;
  if (currentView === "setup" && window.BetterVivaSetup?.back()) return;
  if (currentView === "settings") return showHome();
  if (currentView === "home") return history.back();
  if (history.state?.bvApp) history.back();
  else showHome();
}

function restoreView(view) {
  if (view === "home") showHome();
  else if (view === "grades") show("grades");
  else if (view === "settings") { show("settings"); notifySettingsOpen(appBack); }
  else if (view === "setup") show("setup");
  else showLogin();
}

window.addEventListener("popstate", (event) => {
  if (Sheet.handleBack()) return;
  if (currentView === "setup" && window.BetterVivaSetup?.back()) {
    history.pushState({ bvApp: true, view: "setup" }, "");
    return;
  }
  if (currentView === "grades") {
    const gradeBack = new CustomEvent("bv-grade-back", { detail: { handled: false } });
    window.dispatchEvent(gradeBack);
    if (gradeBack.detail.handled) return;
  }
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

async function logout() {
  await requestWithStatus(() => fetch("/api/logout", { method: "POST" })).catch(() => {});
  await dbClear();
  window.dispatchEvent(new CustomEvent("bv-clear-login-password"));
  showLogin();
}

window.BetterViva = {
  api,
  isLoginError: (error) => error instanceof LoginError,
  showLogin,
  goBack: appBack,
  goHome: () => showHome(),
  goGrades() {
    navigateTo("grades");
  },
  goSettings: () => openSettings(appBack),
  logout() {
    if (confirm("Uscire da questo dispositivo? Le credenziali salvate verranno cancellate.")) {
      void logout();
    }
  },
  showEventDay(day, events) {
    EventSheet.showDay(day, events);
  },
  openGrade(grade) {
    const el = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const value = Number(grade.decimalValue);
    const color = grade.canceled || grade.noAverage || grade.decimalValue == null || !Number.isFinite(value)
      ? "blue"
      : value >= 6 ? "green" : value >= 5 ? "orange" : "red";
    const date = typeof grade.evtDate === "string"
      ? grade.evtDate.split("-").reverse().join("/")
      : "";
    const fallbackTitle = [date, grade.componentDesc].filter(Boolean).join(" - ");
    const details = el("div", "grade-sheet-details");
    details.append(el("h2", "sheet-title", grade.subjectName || grade.subjectDesc || "Voto"));
    if (fallbackTitle) details.append(el("p", "sheet-meta", fallbackTitle));
    const heading = el("div", "grade-sheet-heading");
    heading.append(el("span", `grade-value ${color}`, grade.displayValue || "—"), details);
    const nodes = [heading];
    if (grade.notesForFamily) nodes.push(el("p", "sheet-text", grade.notesForFamily));
    if (grade.teacherName) nodes.push(el("p", "sheet-meta", grade.teacherName));
    Sheet.open(...nodes);
  },
  async login(username, password, remember) {
    await postLogin(username, password);
    if (remember) await saveCredentials(username, password);
    else await dbClear();
    const previousScope = await dbGet("api-cache-scope");
    if (previousScope) {
      await clearApiCache(previousScope);
      await dbDelete("api-cache-scope");
    }
    cacheScope = null;
    await enter();
  },
  openSettings,
  openSetup(mode, onDone) {
    navigateTo("setup");
    window.dispatchEvent(new CustomEvent("bv-open-setup", {
      detail: { mode, firstName: "", onDone },
    }));
  },
  startSetup(firstName, onDone) {
    replaceView("setup");
    window.dispatchEvent(new CustomEvent("bv-open-setup", {
      detail: { mode: "initial", firstName, onDone },
    }));
  },
};

/* ---------- Avvio ---------- */
(async function init() {
  if (!navigator.onLine) {
    syncFailed = true;
    renderSyncStatus();
    showConnectionToast("Sei offline. Controlla la connessione.");
  }
  try {
    const res = await requestWithStatus(() => fetch("/api/me"));
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
