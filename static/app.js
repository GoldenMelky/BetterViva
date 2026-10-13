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
const dbClear = () => kv("readwrite", (s) => s.clear());

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

// Da usare per TUTTE le chiamate future (eventi, ecc.): su 401 rinnova e riprova una volta
async function api(path, options = {}) {
  let res = await fetch(path, options);
  if (res.status === 401) {
    await silentLogin();
    res = await fetch(path, options);
  }
  return res;
}

/* ---------- Interfaccia ---------- */
const $ = (id) => document.getElementById(id);
const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function show(view) {
  $("view-login").hidden = view !== "login";
  $("view-setup").hidden = view !== "setup";
  $("view-home").hidden = view !== "home";
  $("avatar").hidden = view !== "home" && view !== "setup";
  $("status").textContent = "";
}

function showHome() {
  show("home");
  Home.load();
}

// Dopo l'accesso: se manca l'orario dell'anno in corso parte il setup, altrimenti la home
async function enter() {
  let me = null;
  try {
    const res = await api("/api/me");
    if (res.ok) me = await res.json();
  } catch (e) {
    if (e instanceof LoginError) return showLogin(e.message);
  }
  if (me && me.setup_needed) {
    show("setup");
    Setup.start(me.first_name || titleCase((me.name || "").split(" ")[0]), showHome);
  } else {
    showHome();
  }
}

function showLogin(message = "") {
  const err = $("login-error");
  err.textContent = message;
  err.hidden = !message;
  show("login");
}

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
    if (res.ok) return enter();
  } catch {
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
