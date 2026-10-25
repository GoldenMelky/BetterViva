"use strict";

/* Home: selettore dei giorni + eventi del giorno, in due viste collegate. */
const Home = (() => {
  const SLOT = 96;                       // larghezza di una voce del selettore (px)
  const SMALL = 13 / 24;                 // scala delle voci non centrali
  const WINDOW_DAYS = 42;
  const WINDOW_SHIFT = 14;
  const INITIAL_PAST = 14;
  const WINDOW_EDGE = 7;
  const MUTED = [134, 62, 62], WHITE = [255, 255, 255];
  const RELATIVE = ["Ieri", "Oggi", "Domani"];
  const WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
  const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const KIND = { verifica: "Verifica", interrogazione: "Interrogazione" };
  const SUBJECT_COLORS = new Set(["red", "green", "blue", "yellow", "brown", "purple", "orange", "teal", "pink"]);
  const startDay = () => new Date().getHours() < 12 ? 0 : 1;
  const MODE_KEY = "bv_home_mode";
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  let sel, panels, list, toggle;
  let items = [], sections = [], secDay = [], doneRefs = new Map(), eventsById = new Map();
  let windowStart = null, eventData = [], timetableData = null, homeData = null, shifting = false;
  let loading = false, pendingEvents = null, pendingTimetable = null, hasPendingTimetable = false;
  let mode = "orario", driver = null, timer = null;
  let touching = false, glideId = 0;     // dito appoggiato / animazione del selettore in corso
  const SETTLE_MS = 120;

  const mix = (t) => `rgb(${MUTED.map((m, i) => Math.round(m + (WHITE[i] - m) * t)).join(",")})`;
  const clamp = (n) => Math.max(0, Math.min(items.length - 1, n));
  const isoDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shiftDate = (d, days) => { const out = new Date(d); out.setDate(out.getDate() + days); return out; };
  const dayOffset = (from, to) => Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 864e5);
  const dateAt = (index) => shiftDate(windowStart, index);

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
  function listSnap(idx, smooth = false) {
    if (!sections.length) return;
    const k = secDay.findIndex((d) => d >= idx);
    const top = sections[k < 0 ? sections.length - 1 : k].offsetTop;
    if (smooth) list.scrollTo({ top, behavior: "smooth" }); else list.scrollTop = top;
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

  function colorSubject(node, subjectId, subjectConfig) {
    const color = subjectConfig?.[String(subjectId)]?.color;
    if (SUBJECT_COLORS.has(color)) node.dataset.color = color;
  }

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

  function eventRow(e, compact = false) {
    const row = document.createElement("div"); row.className = "ev-row";
    if (compact) row.classList.add("ev-row-compact");
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
  function fillPanel(panel, events, lessons, subjectConfig) {
    const used = new Set();
    const addEventBadges = (heading, matching) => {
      [...new Set(matching.map((event) => event.kind).filter(Boolean))]
        .forEach((kind) => heading.append(line("span", "badge", KIND[kind] || kind)));
    };
    const makeClickable = (box, event) => {
      if (!event) return;
      box.classList.add("event-clickable");
      box.tabIndex = 0;
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", `${event.subject || "Evento"}: apri i dettagli`);
      const open = () => EventSheet.showEvent(event);
      box.addEventListener("click", (click) => {
        if (click.target.closest("button, .ev")) return;
        open();
      });
      box.addEventListener("keydown", (key) => {
        if (key.target !== box || (key.key !== "Enter" && key.key !== " ")) return;
        key.preventDefault();
        open();
      });
    };
    lessons.forEach((l) => {
      const box = document.createElement("div"); box.className = "event";
      colorSubject(box, l.id, subjectConfig);
      const heading = line("h2", "", "");
      heading.append(line("span", "event-hour", `${l.hpos}°`), line("span", "event-subject", l.name));
      box.append(heading);
      const matching = events.filter((e) => !used.has(e) && e.subject_id === l.id);
      makeClickable(box, matching.find((e) => e.text || isHomework(e)));
      addEventBadges(heading, matching);
      // gli eventi della materia stanno sotto la sua prima ora del giorno
      matching.forEach((e) => {
        if (used.has(e) || e.subject_id !== l.id) return;
        used.add(e);
        if (hasRow(e)) box.append(eventRow(e, true));
      });
      panel.append(box);
    });
    // eventi senza ora (giorno senza orario o materia non in orario)
    events.filter((e) => !used.has(e)).forEach((e) => {
      const box = document.createElement("div"); box.className = "event";
      colorSubject(box, e.subject_id, subjectConfig);
      const heading = line("h2", "", e.subject || "Evento");
      addEventBadges(heading, [e]);
      box.append(heading);
      makeClickable(box, e.text || isHomework(e) ? e : null);
      if (hasRow(e)) box.append(eventRow(e, true));
      panel.append(box);
    });
    if (!panel.children.length) panel.append(line("p", "empty", "Nessun evento"));
  }

  /* ---- vista eventi: elenco verticale, con l'ora se la materia è in orario ---- */
  function fillDay(sec, d, relativeDay, events, lessons, subjectConfig) {
    if (!events.length) return false;
    const head = document.createElement("h2"); head.className = "dayhead";
    if (relativeDay >= -1 && relativeDay <= 1) {
      head.append(line("strong", "", RELATIVE[relativeDay + 1]));
    } else {
      head.append(line("strong", "", WEEKDAYS[d.getDay()]), document.createTextNode(`${d.getDate()} ${MONTHS[d.getMonth()]}`));
    }
    sec.append(head);

    const first = new Map();
    lessons.forEach((l) => { if (!first.has(l.id)) first.set(l.id, l); });
    events
      .map((e) => ({ e, l: first.get(e.subject_id) }))
      .sort((a, b) => (a.l ? a.l.hpos : 99) - (b.l ? b.l.hpos : 99))
      .forEach(({ e, l }) => {
        const card = document.createElement("div"); card.className = "evcard";
        colorSubject(card, e.subject_id, subjectConfig);
        const title = document.createElement("div"); title.className = "evtitle";
        const subject = line("h3", "", l ? l.name : e.subject || "Evento");
        if (l) subject.append(line("span", "ev-hour", `${l.hpos}° ora`));
        title.append(subject);
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

  /* ---- sincronizzazione selettore ⇄ vista ----
     Regole:
     - chi viene toccato è il driver: solo lui mantiene lo snap nativo, l'altro segue senza snap;
     - lo "stop" (settle) non parte mai col dito appoggiato, solo dopo touchend + scroll fermo;
     - a riposo si riabilita prima lo snap e SOLO DOPO si scrivono le posizioni esatte
       (altrimenti il browser si "riaggancia" al target vecchio: lo scatto al rilascio);
     - i click sul giorno non usano scrollTo smooth + snap (overshoot) ma un'animazione rAF
       che muove selettore e vista nello stesso frame. */
  const scrollers = () => [sel, panels, list];
  const setSnap = (el, on) => { el.style.scrollSnapType = on ? "" : "none"; };
  const leadEl = (src) => (src === "sel" ? sel : view().el());
  const followEl = (src) => (src === "sel" ? view().el() : sel);
  const position = (src) => (src === "sel" ? sel.scrollLeft / SLOT : view().get());

  function cancelGlide() { if (glideId) { cancelAnimationFrame(glideId); glideId = 0; } }

  function arm() {                       // (ri)avvia l'attesa dello stop, mai a dito appoggiato
    clearTimeout(timer);
    if (!touching) timer = setTimeout(settle, SETTLE_MS);
  }

  function onScroll(src) {
    if (driver !== src) return;          // ignora gli scroll provocati dal follower (o dall'animazione)
    const p = position(src);
    if (src === "sel") view().set(p);
    else sel.scrollLeft = p * SLOT;
    paint(p);
    arm();
  }

  // A riposo sul giorno idx. writeView=false: la vista è quella che l'utente sta leggendo, non la tocco.
  function rest(idx, writeView) {
    clearTimeout(timer); cancelGlide();
    driver = null;
    scrollers().forEach((el) => setSnap(el, true));
    void sel.offsetWidth;                // applica lo snap prima di scrivere le posizioni
    sel.scrollLeft = idx * SLOT;
    if (writeView) view().snap(idx, true);
    paint(idx);
    if (idx <= WINDOW_EDGE) void shiftWindow(-1);
    else if (idx >= WINDOW_DAYS - WINDOW_EDGE - 1) void shiftWindow(1);
  }

  function settle() {                    // gesto finito e scroll fermo
    if (!driver || driver === "glide" || touching) return;
    const src = driver;
    const idx = clamp(Math.round(position(src)));
    if (src === "sel") rest(idx, true);
    else glide(idx, false);              // la vista resta dov'è, il selettore la raggiunge dolcemente
  }

  // Anima il selettore (e, se followView, anche la vista) fino al giorno `to`, un frame alla volta.
  function glide(to, followView) {
    clearTimeout(timer); cancelGlide();
    const from = sel.scrollLeft / SLOT;
    const dist = Math.abs(to - from);
    if (dist < 0.02) { rest(to, followView); return; }
    driver = "glide";
    scrollers().forEach((el) => setSnap(el, false));
    const dur = Math.min(420, 160 + 70 * Math.sqrt(dist));
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const p = from + (to - from) * (1 - Math.pow(1 - t, 3));   // easeOutCubic: arriva senza sbavature
      sel.scrollLeft = p * SLOT;
      if (followView) view().set(p);
      paint(p);
      if (t < 1) glideId = requestAnimationFrame(step);
      else { glideId = 0; rest(to, followView); }
    };
    glideId = requestAnimationFrame(step);
  }

  function take(src) {                   // chi inizia a toccare diventa il driver
    cancelGlide(); clearTimeout(timer);
    if (driver === src) return;
    driver = src;
    setSnap(leadEl(src), true);
    setSnap(followEl(src), false);
  }

  const goTo = (i) => glide(clamp(i), true);

  function applyMode(next, save = true) {
    const idx = items.length ? clamp(Math.round(sel.scrollLeft / SLOT)) : startDay();
    clearTimeout(timer); cancelGlide(); driver = null;
    scrollers().forEach((el) => setSnap(el, true));
    mode = next;
    panels.hidden = mode !== "orario";
    list.hidden = mode !== "eventi";
    toggle.dataset.mode = mode;
    toggle.setAttribute("aria-checked", String(mode === "eventi"));
    toggle.setAttribute("aria-label", mode === "eventi" ? "Vista eventi (tocca per l'orario)" : "Vista orario (tocca per gli eventi)");
    if (items.length) { view().snap(idx); paint(idx); }
    if (save) { try { localStorage.setItem(MODE_KEY, mode); } catch { /* preferenza non salvata */ } }
  }

  function render(data, tt, selectedDate = null) {
    homeData = data;
    const today = isoDate(data.today);
    const byDay = {};
    eventsById = new Map();
    data.events.forEach((e) => { (byDay[e.date] ||= []).push(e); eventsById.set(e.id, e); });
    eventData = data.events;

    const selected = selectedDate || (items.length ? dateAt(clamp(Math.round(sel.scrollLeft / SLOT))) : shiftDate(today, startDay()));
    const keep = Math.max(0, Math.min(WINDOW_DAYS - 1, dayOffset(windowStart, selected)));
    sel.replaceChildren(); panels.replaceChildren(); list.replaceChildren();
    items = []; sections = []; secDay = []; doneRefs = new Map();
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = dateAt(i), relativeDay = dayOffset(today, d);
      const labels = relativeDay >= -1 && relativeDay <= 1
        ? [RELATIVE[relativeDay + 1]] : [String(d.getDate()), WEEKDAYS[d.getDay()]];

      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "day";
      labels.forEach((l) => { const s = document.createElement("span"); s.textContent = l; btn.append(s); });
      btn.addEventListener("click", () => goTo(i));
      sel.append(btn); items.push(btn);

      const panel = document.createElement("div");
      panel.className = "panel";
      const events = byDay[key(d)] || [], lessons = lessonsOf(tt, d);
      fillPanel(panel, events, lessons, tt?.subjects);
      panels.append(panel);

      const sec = document.createElement("section");
      sec.className = "evday";
      if (fillDay(sec, d, relativeDay, events, lessons, tt?.subjects)) { // i giorni senza eventi non entrano nell'elenco
        list.append(sec); sections.push(sec); secDay.push(i);
      }
    }
    if (!sections.length) list.append(line("p", "evnone", "Nessun evento"));
    driver = null;
    sel.scrollLeft = keep * SLOT;
    view().snap(keep);
    paint(keep);
  }

  async function shiftWindow(direction) {
    if (shifting || !items.length || !windowStart) return;
    shifting = true;
    const currentEnd = dateAt(WINDOW_DAYS - 1);
    const nextStart = shiftDate(windowStart, direction * WINDOW_SHIFT);
    const fetchStart = direction < 0 ? nextStart : shiftDate(currentEnd, 1);
    const nextEnd = shiftDate(nextStart, WINDOW_DAYS - 1);
    try {
      const res = await api(`/api/events?start=${key(fetchStart)}&days=${WINDOW_SHIFT - 1}`);
      if (!res.ok) throw new Error(res.status);
      const chunk = await res.json();
      if (driver || touching) return;    // l'utente ha ripreso a scorrere: render() ora farebbe saltare tutto; riproverà al prossimo stop
      const selected = dateAt(clamp(Math.round(sel.scrollLeft / SLOT)));   // posizione di adesso, non di prima del fetch
      eventData = [...eventData, ...chunk.events].filter((event) => event.date >= key(nextStart) && event.date <= key(nextEnd));
      windowStart = nextStart;
      render({ today: chunk.today, events: eventData }, timetableData, selected);
      document.getElementById("status").textContent = "";
    } catch (e) {
      if (e instanceof LoginError) showLogin(e.message);
      else document.getElementById("status").textContent = "Impossibile caricare altri eventi. Riprova.";
    } finally {
      shifting = false;
    }
  }

  async function load() {
    const status = document.getElementById("status");
    if (!items.length) status.textContent = "Caricamento…";   // agli aggiornamenti successivi niente lampeggio
    if (!windowStart) windowStart = shiftDate(new Date(), -INITIAL_PAST);
    loading = true;
    pendingEvents = null; pendingTimetable = null; hasPendingTimetable = false;
    const selected = items.length ? dateAt(clamp(Math.round(sel.scrollLeft / SLOT))) : null;
    try {
      const [res, ttRes] = await Promise.all([
        api(`/api/events?start=${key(windowStart)}&days=${WINDOW_DAYS - 1}`), api("/api/timetable"),
      ]);
      if (!res.ok) throw new Error(res.status);
      // orario non disponibile (404 o errore): la home mostra comunque gli eventi
      timetableData = hasPendingTimetable ? pendingTimetable : ttRes.ok ? await ttRes.json() : null;
      const data = pendingEvents || await res.json();
      loading = false;
      render(data, timetableData, selected);
      Calendar.load();   // non blocca la home: se fallisce il calendario resta nascosto
      status.textContent = "";
    } catch (e) {
      loading = false;
      if (e instanceof LoginError) showLogin(e.message);
      else status.textContent = "Impossibile caricare gli eventi. Riprova tra poco.";
    }
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (detail.path === `/api/events?start=${key(windowStart)}&days=${WINDOW_DAYS - 1}`) {
      if (loading) { pendingEvents = detail.data; return; }
      const selected = items.length ? dateAt(clamp(Math.round(sel.scrollLeft / SLOT))) : null;
      render(detail.data, timetableData, selected);
      document.getElementById("status").textContent = "";
    } else if (detail.path === "/api/timetable") {
      if (loading) { pendingTimetable = detail.data; hasPendingTimetable = true; return; }
      timetableData = detail.data;
      if (homeData) {
        const selected = items.length ? dateAt(clamp(Math.round(sel.scrollLeft / SLOT))) : null;
        render(homeData, timetableData, selected);
      }
      document.getElementById("status").textContent = "";
    }
  });

  window.addEventListener("bv-api-cache-error", ({ detail }) => {
    if (detail.path.startsWith("/api/events?") || detail.path === "/api/timetable") {
      document.getElementById("status").textContent = "Dati salvati mostrati; impossibile aggiornarli dal server.";
    }
  });

  function init() {
    sel = document.getElementById("days");
    panels = document.getElementById("panels");
    list = document.getElementById("evlist");
    toggle = document.getElementById("mode-toggle");

    for (const [el, src] of [[sel, "sel"], [panels, "view"], [list, "view"]]) {
      el.addEventListener("scroll", () => { if (src === "sel" || el === view().el()) onScroll(src); }, { passive: true });
      el.addEventListener("touchstart", () => { touching = true; take(src); }, { passive: true });
      el.addEventListener("wheel", () => { take(src); arm(); }, { passive: true });
    }
    // con lo scroll nativo i pointer event vengono cancellati: per la fine del gesto servono i touch event
    const lift = (e) => { if (e.touches.length === 0) { touching = false; arm(); } };
    window.addEventListener("touchend", lift, { passive: true });
    window.addEventListener("touchcancel", lift, { passive: true });
    toggle.addEventListener("click", () => applyMode(mode === "orario" ? "eventi" : "orario"));
    window.addEventListener("resize", () => { if (items.length) view().snap(Math.round(sel.scrollLeft / SLOT)); });

    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch { /* storage non disponibile */ }
    applyMode(saved === "eventi" ? "eventi" : "orario", false);
  }

  document.addEventListener("DOMContentLoaded", init);
  return { load, isHomework, toggleDone };
})();
