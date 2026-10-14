"use strict";

/* Home: selettore dei giorni + eventi del giorno, in due viste collegate. */
const Home = (() => {
  const SLOT = 96;                       // larghezza di una voce del selettore (px)
  const SMALL = 13 / 24;                 // scala delle voci non centrali
  const MUTED = [134, 62, 62], WHITE = [255, 255, 255];
  const RELATIVE = ["Oggi", "Domani", "Dopodomani"];
  const WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
  const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const KIND = { verifica: "Verifica", interrogazione: "Interrogazione" };
  const startDay = () => new Date().getHours() < 12 ? 0 : 1;
  const MODE_KEY = "bv_home_mode";
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  let sel, panels, list, toggle;
  let items = [], sections = [], secDay = [], doneRefs = new Map(), eventsById = new Map();
  let mode = "orario", driver = null, timer = null;

  const mix = (t) => `rgb(${MUTED.map((m, i) => Math.round(m + (WHITE[i] - m) * t)).join(",")})`;
  const clamp = (n) => Math.max(0, Math.min(items.length - 1, n));
  const isoDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /* ---- le due viste: come leggere/impostare la posizione ----
     p = giorno del selettore (anche frazionario). Nella vista eventi i giorni senza eventi non hanno
     sezione: sections[k] è il giorno secDay[k], e tra due sezioni p si interpola tra i loro giorni. */
  function listPos() {
    if (!sections.length) return 0;
    const st = list.scrollTop, n = sections.length;
    let k = 0;
    while (k < n - 1 && sections[k + 1].offsetTop <= st) k++;
    if (k === n - 1) return secDay[k];
    const a = sections[k].offsetTop, b = sections[k + 1].offsetTop;
    return secDay[k] + (b > a ? (st - a) / (b - a) : 0) * (secDay[k + 1] - secDay[k]);
  }
  function listSet(p) {
    if (!sections.length) return;
    const n = sections.length;
    let k = 0;
    while (k < n - 1 && secDay[k + 1] <= p) k++;
    if (k === n - 1 || p <= secDay[k]) { list.scrollTop = sections[k].offsetTop; return; }
    const f = (p - secDay[k]) / (secDay[k + 1] - secDay[k]);
    list.scrollTop = sections[k].offsetTop + f * (sections[k + 1].offsetTop - sections[k].offsetTop);
  }
  // a riposo su un giorno: l'elenco mostra quel giorno, o il primo successivo che ha eventi
  function listSnap(idx) {
    if (!sections.length) return;
    const k = secDay.findIndex((d) => d >= idx);
    list.scrollTop = sections[k < 0 ? sections.length - 1 : k].offsetTop;
  }
  const panelsSet = (p) => { panels.scrollLeft = p * panels.clientWidth; };
  const views = {
    orario: { el: () => panels, get: () => panels.scrollLeft / (panels.clientWidth || 1), set: panelsSet, snap: panelsSet },
    eventi: { el: () => list, get: listPos, set: listSet, snap: listSnap },
  };
  const view = () => views[mode];

  /* ---- orario del giorno: [{hpos, id, name}] in ordine di ora ---- */
  function lessonsOf(tt, d) {
    if (!tt) return [];
    const wd = (d.getDay() + 6) % 7;                       // 0 = lunedì, come nel backend
    return tt.cells
      .filter((c) => c.weekday === wd && c.subject_id != null)
      .sort((a, b) => a.hpos - b.hpos)
      .map((c) => ({ hpos: c.hpos, id: c.subject_id, name: c.label || c.subject || "Lezione" }));
  }

  function line(tag, cls, text) { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; }

  /* ---- riga di un evento: testo (apre la scheda) + checkbox se è un compito ---- */
  function eventLine(e) {
    const p = line("p", "ev", e.text || "");
    p.tabIndex = 0; p.setAttribute("role", "button");
    const open = () => EventSheet.showEvent(e);
    p.addEventListener("click", open);
    p.addEventListener("keydown", (k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); open(); } });
    return p;
  }

  function paintDone(e) {
    (doneRefs.get(e.id) || []).forEach(({ row, chk }) => {
      row.classList.toggle("done", !!e.done);
      if (chk) {
        chk.setAttribute("aria-checked", String(!!e.done));
        chk.setAttribute("aria-label", `${e.done ? "Segna da fare" : "Segna come svolto"}: ${e.subject || "compito"}`);
      }
    });
  }

  // Ritorna il nuovo stato (true = svolto), o null se il salvataggio fallisce (lo stato torna com'era).
  async function toggleDone(ev) {
    const e = eventsById.get(ev.id) || ev;
    if (e.saving) return e.done;
    const want = !e.done;
    e.saving = true; e.done = want; paintDone(e);
    try {
      const res = await api(`/api/events/${e.id}/done`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: want }),
      });
      if (!res.ok) throw new Error(res.status);
      return want;
    } catch (err) {
      e.done = !want; paintDone(e);
      if (err instanceof LoginError) { Sheet.close(); showLogin(err.message); }
      else {
        const status = document.getElementById("status");
        status.textContent = "Impossibile salvare. Riprova.";
        setTimeout(() => { if (status.textContent === "Impossibile salvare. Riprova.") status.textContent = ""; }, 3000);
      }
      return null;
    } finally {
      e.saving = false;
    }
  }

  const isHomework = (e) => Array.isArray(e.source) && e.source.includes("homework");

  function eventRow(e) {
    const row = document.createElement("div"); row.className = "ev-row";
    row.append(eventLine(e));
    let chk = null;
    if (!e.kind) {
      chk = document.createElement("button");
      chk.type = "button"; chk.className = "chk"; chk.innerHTML = ICON_CHECK;
      chk.setAttribute("role", "checkbox");
      chk.addEventListener("click", () => toggleDone(e));
      row.append(chk);
    }
    if (!doneRefs.has(e.id)) doneRefs.set(e.id, []);
    doneRefs.get(e.id).push({ row, chk });
    paintDone(e);
    return row;
  }

  const hasRow = (e) => e.text || isHomework(e);

  /* ---- vista orario ---- */
  function fillPanel(panel, events, lessons) {
    const used = new Set();
    lessons.forEach((l) => {
      const box = document.createElement("div"); box.className = "event";
      box.append(line("h2", "", `${l.hpos}° ${l.name}`));
      // gli eventi della materia stanno sotto la sua prima ora del giorno
      events.forEach((e) => {
        if (used.has(e) || e.subject_id !== l.id) return;
        used.add(e);
        if (hasRow(e)) box.append(eventRow(e));
      });
      panel.append(box);
    });
    // eventi senza ora (giorno senza orario o materia non in orario)
    events.filter((e) => !used.has(e)).forEach((e) => {
      const box = document.createElement("div"); box.className = "event";
      box.append(line("h2", "", e.subject || "Evento"));
      if (hasRow(e)) box.append(eventRow(e));
      panel.append(box);
    });
    if (!panel.children.length) panel.append(line("p", "empty", "Nessun evento"));
  }

  /* ---- vista eventi: elenco verticale, con l'ora se la materia è in orario ---- */
  function fillDay(sec, d, i, events, lessons) {
    if (!events.length) return false;
    const head = document.createElement("h2"); head.className = "dayhead";
    head.append(line("strong", "", WEEKDAYS[d.getDay()]), document.createTextNode(`${d.getDate()} ${MONTHS[d.getMonth()]}`));
    if (i < RELATIVE.length) head.append(line("span", "badge", RELATIVE[i]));
    sec.append(head);

    const first = new Map();
    lessons.forEach((l) => { if (!first.has(l.id)) first.set(l.id, l); });
    events
      .map((e) => ({ e, l: first.get(e.subject_id) }))
      .sort((a, b) => (a.l ? a.l.hpos : 99) - (b.l ? b.l.hpos : 99))
      .forEach(({ e, l }) => {
        const card = document.createElement("div"); card.className = "evcard";
        const title = document.createElement("div"); title.className = "evtitle";
        title.append(line("h3", "", l ? `${l.hpos}° ${l.name}` : e.subject || "Evento"));
        if (e.kind) title.append(line("span", "badge", KIND[e.kind] || e.kind));
        card.append(title);
        if (hasRow(e)) card.append(eventRow(e));
        sec.append(card);
      });
    return true;
  }

  function paint(p) {
    items.forEach((el, i) => {
      const t = Math.max(0, 1 - Math.abs(i - p));
      el.style.transform = `scale(${SMALL + (1 - SMALL) * t})`;
      el.style.color = mix(t);
    });
  }

  const position = (src) => (src === "sel" ? sel.scrollLeft / SLOT : view().get());

  function onScroll(src) {
    if (driver !== src) return;          // ignora gli scroll provocati dal follower
    const p = position(src);
    if (src === "sel") view().set(p);
    else sel.scrollLeft = p * SLOT;
    paint(p);
    clearTimeout(timer);
    timer = setTimeout(settle, 140);
  }

  function settle() {
    if (!driver) return;
    const idx = clamp(Math.round(position(driver)));
    if (driver === "sel") view().snap(idx);
    else sel.scrollTo({ left: idx * SLOT, behavior: "instant" });
    sel.style.scrollSnapType = panels.style.scrollSnapType = list.style.scrollSnapType = "";
    driver = null;
    paint(idx);
  }

  function take(src) {                   // chi inizia a toccare diventa il driver
    if (driver && driver !== src) settle();
    driver = src;
    (src === "sel" ? view().el() : sel).style.scrollSnapType = "none";
  }

  function goTo(i) {
    take("sel");
    sel.scrollTo({ left: i * SLOT, behavior: "smooth" });
  }

  function applyMode(next, save = true) {
    const idx = items.length ? clamp(Math.round(sel.scrollLeft / SLOT)) : startDay();
    clearTimeout(timer); driver = null;
    sel.style.scrollSnapType = panels.style.scrollSnapType = list.style.scrollSnapType = "";
    mode = next;
    panels.hidden = mode !== "orario";
    list.hidden = mode !== "eventi";
    toggle.dataset.mode = mode;
    toggle.setAttribute("aria-checked", String(mode === "eventi"));
    toggle.setAttribute("aria-label", mode === "eventi" ? "Vista eventi (tocca per l'orario)" : "Vista orario (tocca per gli eventi)");
    if (items.length) { view().snap(idx); paint(idx); }
    if (save) { try { localStorage.setItem(MODE_KEY, mode); } catch { /* preferenza non salvata */ } }
  }

  function render(data, tt) {
    const today = isoDate(data.today);
    const byDay = {};
    eventsById = new Map();
    data.events.forEach((e) => { (byDay[e.date] ||= []).push(e); eventsById.set(e.id, e); });

    const keep = items.length ? clamp(Math.round(sel.scrollLeft / SLOT)) : startDay();
    sel.replaceChildren(); panels.replaceChildren(); list.replaceChildren();
    items = []; sections = []; secDay = []; doneRefs = new Map();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const labels = i < RELATIVE.length ? [RELATIVE[i]] : [String(d.getDate()), WEEKDAYS[d.getDay()]];

      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "day";
      labels.forEach((l) => { const s = document.createElement("span"); s.textContent = l; btn.append(s); });
      btn.addEventListener("click", () => goTo(i));
      sel.append(btn); items.push(btn);

      const panel = document.createElement("div");
      panel.className = "panel";
      const events = byDay[key(d)] || [], lessons = lessonsOf(tt, d);
      fillPanel(panel, events, lessons);
      panels.append(panel);

      const sec = document.createElement("section");
      sec.className = "evday";
      if (fillDay(sec, d, i, events, lessons)) {      // i giorni senza eventi non entrano nell'elenco
        list.append(sec); sections.push(sec); secDay.push(i);
      }
    }
    if (!sections.length) list.append(line("p", "evnone", "Nessun evento"));
    driver = null;
    sel.scrollLeft = keep * SLOT;
    view().snap(keep);
    paint(keep);
  }

  async function load() {
    const status = document.getElementById("status");
    if (!items.length) status.textContent = "Caricamento…";   // agli aggiornamenti successivi niente lampeggio
    try {
      const [res, ttRes] = await Promise.all([api("/api/events?days=14"), api("/api/timetable")]);
      if (!res.ok) throw new Error(res.status);
      // orario non disponibile (404 o errore): la home mostra comunque gli eventi
      render(await res.json(), ttRes.ok ? await ttRes.json() : null);
      Calendar.load();   // non blocca la home: se fallisce il calendario resta nascosto
      status.textContent = "";
    } catch (e) {
      if (e instanceof LoginError) showLogin(e.message);
      else status.textContent = "Impossibile caricare gli eventi. Riprova tra poco.";
    }
  }

  function init() {
    sel = document.getElementById("days");
    panels = document.getElementById("panels");
    list = document.getElementById("evlist");
    toggle = document.getElementById("mode-toggle");

    for (const [el, src] of [[sel, "sel"], [panels, "view"], [list, "view"]]) {
      el.addEventListener("scroll", () => { if (src === "sel" || el === view().el()) onScroll(src); }, { passive: true });
      ["touchstart", "pointerdown", "wheel"].forEach((ev) =>
        el.addEventListener(ev, () => take(src), { passive: true }));
    }
    toggle.addEventListener("click", () => applyMode(mode === "orario" ? "eventi" : "orario"));
    window.addEventListener("resize", () => { if (items.length) view().snap(Math.round(sel.scrollLeft / SLOT)); });

    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { /* storage non disponibile */ }
    applyMode(saved === "eventi" ? "eventi" : "orario", false);
  }

  document.addEventListener("DOMContentLoaded", init);
  return { load, isHomework, toggleDone };
})();
