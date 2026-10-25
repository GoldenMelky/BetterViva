"use strict";

/* Setup iniziale obbligatorio (utente senza orario salvato per l'anno in corso).
   Passi: 0 benvenuto -> 1 materie (nome + laboratorio) -> 2.. orario, un giorno per volta.
   Tutto è precompilato con la proposta del backend (GET /api/setup/timetable);
   il server rivalida ogni cosa. Testi sempre con textContent, mai innerHTML. */
const Setup = (() => {
  const DAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
  const NONE = "";                       // valore di "Nessuna lezione"
  const MAX_NAME = 40;
  const COLORS = [
    ["red", "Rosso", "#A8342B"], ["green", "Verde", "#399456"],
    ["blue", "Blu", "#3478B9"], ["yellow", "Giallo", "#B69A31"],
    ["brown", "Marrone", "#93653D"], ["purple", "Viola", "#8854AA"],
    ["orange", "Arancione", "#C16C2C"], ["teal", "Turchese", "#2D898B"],
    ["pink", "Rosa", "#A44D70"],
  ];
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    left: "M19 12H5M11 6l-6 6 6 6",
    right: "M5 12h14M13 6l6 6-6 6",
    down: "M6 9l6 6 6-6",
    check: "M5 12.5l4.5 4.5L19 7.5",
    edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  };

  let data = null;                       // proposta del backend
  let savedConfiguration = null;
  let subjects = [];                     // [{id, name, short, lab, teachers}]
  let config = {};                       // id -> {name, lab, color}
  let picks = {};                        // "wd-h" -> "" | "<id>" | "<id>:lab"
  let flagged = new Set();               // celle incerte (status != ok): mostrate con "?"
  let step = 0;                          // 0 benvenuto, 1 materie, 2.. giorni
  let firstName = "";
  let onDone = () => {};
  let mode = "initial";                 // initial, subjects, timetable
  let openColorMenu = null;
  let dirty = false;
  let proposalUpdate = null, proposalRevision = 0;
  let timetableUpdate = null, timetableRevision = 0;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const icon = (name) => {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG, "path"); p.setAttribute("d", ICONS[name]);
    svg.append(p);
    return svg;
  };
  const button = (cls, label, onClick, ...children) => {
    const b = el("button", cls); b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    children.forEach((c) => b.append(c));
    b.addEventListener("click", onClick);
    return b;
  };
  const errorBox = () => { const p = el("p", "error"); p.id = "setup-error"; p.hidden = true; p.setAttribute("role", "alert"); return p; };
  const cellKey = (wd, h) => `${wd}-${h}`;
  const nameOf = (s) => (config[s.id].name || "").trim() || s.short || s.name;
  const labName = (s) => `Lab ${nameOf(s).toLowerCase()}`;
  const colorName = (value) => COLORS.find(([key]) => key === value)?.[1] || "Colore";

  function closeColorMenu(restoreFocus = false) {
    if (!openColorMenu) return;
    const { menu, trigger } = openColorMenu;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    openColorMenu = null;
    if (restoreFocus) trigger.focus();
  }

  document.addEventListener("click", (event) => {
    if (openColorMenu && !openColorMenu.container.contains(event.target)) closeColorMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openColorMenu) {
      event.preventDefault();
      closeColorMenu(true);
    }
  });

  /* ---------- Avvio ---------- */
  function start(name, done) {
    firstName = name || "";
    onDone = done;
    mode = "initial";
    step = 0;
    data = null;
    savedConfiguration = null;
    dirty = false;
    render();
  }

  async function loadSavedConfiguration(done) {
    firstName = "";
    onDone = done;
    step = -1;
    dirty = false;
    render();
    try {
      await loadProposal();
      const savedRevision = timetableRevision;
      const res = await api("/api/timetable");
      if (!res.ok) throw new Error("Impossibile leggere l'orario salvato.");
      savedConfiguration = savedRevision === timetableRevision ? await res.json() : timetableUpdate;
      applySavedConfiguration(savedConfiguration);
      return true;
    } catch (error) {
      if (error instanceof LoginError) return showLogin(error.message);
      const root = $("setup-body");
      root.replaceChildren(
        el("h1", null, "Modifica l'orario"),
        el("p", "error", error.message || "Impossibile caricare l'orario."),
        button("primary", "Torna alle impostazioni", done),
      );
      return false;
    }
  }

  function applySavedConfiguration(saved) {
    const savedSubjects = saved.subjects || {};
    subjects.forEach((s) => {
      const current = savedSubjects[String(s.id)] || {};
      config[s.id] = {
        name: current.name || saved.names?.[String(s.id)] || s.short || s.name,
        lab: !!current.lab,
        color: current.color || "",
      };
    });

    const savedCells = new Map((saved.cells || []).map((c) => [cellKey(c.weekday, c.hpos), c]));
    const days = [...new Set([...data.days, ...(saved.cells || []).map((c) => c.weekday)])].sort((a, b) => a - b);
    const slots = Math.max(data.slots, ...(saved.cells || []).map((c) => c.hpos), 1);
    const proposed = new Map(data.cells.map((c) => [cellKey(c.weekday, c.hpos), c]));
    data.days = days;
    data.slots = slots;
    data.cells = days.flatMap((wd) => Array.from({ length: slots }, (_, i) => {
      const h = i + 1, k = cellKey(wd, h);
      const cell = proposed.get(k) || { weekday: wd, hpos: h, candidates: [], status: "empty" };
      const current = savedCells.get(k);
      return { ...cell, subject_id: current?.subject_id ?? null, subject: current?.subject ?? null, lab: !!current?.lab };
    }));
    picks = {};
    data.cells.forEach((c) => { picks[cellKey(c.weekday, c.hpos)] = c.subject_id == null ? NONE : `${c.subject_id}${c.lab ? ":lab" : ""}`; });
    flagged = new Set();
  }

  async function editSubjects(done) {
    mode = "subjects";
    if (await loadSavedConfiguration(done)) {
      step = 1;
      render();
    }
  }

  async function editTimetable(done) {
    mode = "timetable";
    if (await loadSavedConfiguration(done)) {
      step = 2;
      render();
    }
  }

  async function loadProposal() {
    const revision = proposalRevision;
    const res = await api("/api/setup/timetable");
    if (!res.ok) throw new Error(res.status);
    data = revision === proposalRevision ? await res.json() : proposalUpdate;
    subjects = data.subjects;
    config = {};
    subjects.forEach((s) => { config[s.id] = { name: s.short || s.name, lab: !!s.lab, color: "" }; });
    picks = {};
    flagged = new Set();
    data.cells.forEach((c) => {
      const k = cellKey(c.weekday, c.hpos);
      picks[k] = c.subject_id == null ? NONE : String(c.subject_id) + (c.lab ? ":lab" : "");
      if (c.status !== "ok") flagged.add(k);
    });
  }

  /* ---------- Rendering ---------- */
  function render() {
    const root = $("setup-body");
    root.replaceChildren();
    window.scrollTo(0, 0);
    if (step === -1) {
      root.append(el("h1", null, "Modifica l'orario"), el("p", "status", "Carico i dati…"));
      return;
    }
    if (step === 0) return renderWelcome(root);
    if (step === 1) return renderSubjects(root);
    return renderDay(root, step - 2);
  }

  function renderWelcome(root) {
    const err = errorBox();
    const go = el("button", "primary", "Inizia"); go.type = "button";
    const nav = el("div", "nav"); nav.append(go);
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = "Carico la proposta…"; err.hidden = true;
      try {
        await loadProposal();
        step = 1; render();
      } catch (e) {
        if (e instanceof LoginError) return showLogin(e.message);
        err.textContent = "Non riesco a leggere le lezioni da ClasseViva. Riprova tra poco.";
        err.hidden = false;
        go.disabled = false; go.textContent = "Riprova";
      }
    });
    root.append(
      el("h1", "welcome", `Ciao ${firstName}`.trim() + ","),
      el("p", "welcome-sub", "grazie per usare BetterViva"),
      el("p", "hint", "Prepariamo insieme materie e orario. Ti proponiamo già tutto noi: devi solo controllare."),
      err, nav,
    );
  }

  function renderSubjects(root) {
    const lead = el("p", "lead");
    lead.append(el("b", null, "Personalizza"), " le materie: rinominale, scegli un colore e segna quelle con laboratorio");
    const cols = el("div", "cols");
    cols.append(el("span", null, "Lab?"), el("span", null, "Materia · colore"), el("span"));

    const list = el("div", "card rows");
    list.append(cols);
    subjects.forEach((s) => {
      const row = el("div", "subj");

      const box = el("label", "labbox");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = config[s.id].lab;
      cb.setAttribute("aria-label", `${nameOf(s)}: ha il laboratorio`);
      cb.addEventListener("change", () => { config[s.id].lab = cb.checked; dirty = true; });
      const mark = el("i"); mark.append(icon("check"));
      box.append(cb, mark);

      const subject = el("div", "subject-config");
      const name = el("span", "name", nameOf(s));
      name.title = s.name;
      const edit = button("round ghost", `Rinomina ${s.name}`, () => {
        const input = el("input"); input.type = "text"; input.maxLength = MAX_NAME; input.value = config[s.id].name;
        const done = () => { config[s.id].name = input.value; name.textContent = nameOf(s); input.replaceWith(name); dirty = true; };
        input.addEventListener("input", () => { dirty = true; });
        input.addEventListener("blur", done);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
        name.replaceWith(input); input.focus(); input.select();
      }, icon("edit"));

      const colorPicker = el("div", "subject-color-picker");
      const trigger = button("subject-color-trigger", `Scegli il colore per ${nameOf(s)}`, () => {
        if (openColorMenu?.trigger === trigger) {
          closeColorMenu();
          return;
        }
        closeColorMenu();
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        openColorMenu = { container: colorPicker, menu, trigger };
        const selected = menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]');
        selected?.focus();
      });
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const currentSwatch = el("span", "color-swatch");
      const currentName = el("span", "color-current-name", colorName(config[s.id].color));
      currentSwatch.style.setProperty("--swatch", COLORS.find(([key]) => key === config[s.id].color)?.[2] || "var(--muted)");
      trigger.append(currentSwatch, currentName, icon("down"));

      const menu = el("div", "subject-color-options");
      menu.hidden = true;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", `Colori per ${nameOf(s)}`);
      const addColorOption = (value, label, sample) => {
        const option = button("subject-color-option", null, () => {
          config[s.id].color = value;
          dirty = true;
          currentName.textContent = label;
          currentSwatch.style.setProperty("--swatch", sample || "var(--muted)");
          menu.querySelectorAll('[role="option"]').forEach((item) => {
            item.setAttribute("aria-selected", String(item === option));
          });
          closeColorMenu(true);
        });
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String((config[s.id].color || "") === value));
        option.append(el("span", "color-swatch"), el("span", null, label));
        option.firstChild.style.setProperty("--swatch", sample || "var(--muted)");
        option.addEventListener("keydown", (event) => {
          const options = [...menu.querySelectorAll('[role="option"]')];
          const index = options.indexOf(option);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length].focus();
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            options[event.key === "Home" ? 0 : options.length - 1].focus();
          }
        });
        menu.append(option);
      };
      addColorOption("", "Nessun colore", null);
      COLORS.forEach(([value, label, sample]) => addColorOption(value, label, sample));
      colorPicker.append(trigger, menu);
      subject.append(name, colorPicker);
      row.append(box, subject, edit);
      list.append(row);
    });
    const back = () => {
      if (mode !== "initial") onDone();
      else { step = 0; render(); }
    };
    const next = mode === "subjects"
      ? saveSubjects
      : () => { step = 2; render(); };
    const nextLabel = mode === "subjects" ? "Salva" : "Configura l'orario";
    root.append(el("h1", null, mode === "initial" ? "Configura le materie" : "Modifica le materie"),
      lead, list, navBar(back, nextLabel, next));
  }

  function optionsFor(wd, h) {
    const cell = data.cells.find((c) => c.weekday === wd && c.hpos === h);
    const cand = cell ? cell.candidates : [];
    const byId = new Map(subjects.map((s) => [s.id, s]));
    const entries = (s) => [[String(s.id), nameOf(s)]].concat(config[s.id].lab ? [[`${s.id}:lab`, labName(s)]] : []);
    const add = (parent, list) => list.forEach((s) => entries(s).forEach(([v, t]) => {
      const o = new Option(t, v); o.dataset.base = t; parent.append(o);
    }));

    const sel = el("select");
    const none = new Option("Nessuna lezione", NONE); none.dataset.base = "Nessuna lezione"; sel.append(none);
    const probable = cand.map((id) => byId.get(id)).filter(Boolean);
    const rest = subjects.filter((s) => !cand.includes(s.id));
    if (probable.length) {
      const g = el("optgroup"); g.label = "Più probabili"; add(g, probable); sel.append(g);
      const g2 = el("optgroup"); g2.label = "Tutte le materie"; add(g2, rest); sel.append(g2);
    } else {
      add(sel, rest);
    }
    return sel;
  }

  // Una scelta non più valida (es. tolto il laboratorio al passo 1) torna alla materia semplice
  function sanitize(value) {
    if (value.endsWith(":lab")) {
      const id = Number(value.slice(0, -4));
      return config[id]?.lab ? value : String(id);
    }
    return value;
  }

  function renderDay(root, idx) {
    const wd = data.days[idx], total = data.days.length;
    const prev = button("round", "Giorno precedente", () => { step--; render(); }, icon("left"));
    const next = button("round", "Giorno successivo", () => { step++; render(); }, icon("right"));
    prev.disabled = idx === 0; next.disabled = idx === total - 1;
    const nav = el("div", "daynav"); nav.append(prev, el("span", null, DAYS[wd]), next);

    const list = el("div", "hours");
    for (let h = 1; h <= data.slots; h++) {
      const k = cellKey(wd, h);
      const row = el("div", "hour");
      row.append(el("span", "num", `${h}°`));
      const wrap = el("div", "sel");
      const sel = optionsFor(wd, h);
      picks[k] = sanitize(picks[k] ?? NONE);
      sel.value = picks[k];
      if (sel.value !== picks[k]) { sel.value = NONE; picks[k] = NONE; }   // voce non presente
      const mark = () => {                       // "Matematica?" = proposta da confermare
        [...sel.options].forEach((o) => { o.textContent = o.dataset.base; });
        if (flagged.has(k)) sel.selectedOptions[0].textContent += "?";
      };
      mark();
      sel.setAttribute("aria-label", `${DAYS[wd]}, ${h}ª ora`);
      sel.addEventListener("change", () => { picks[k] = sel.value; flagged.delete(k); mark(); dirty = true; });
      wrap.append(sel, icon("down"));
      row.append(wrap);
      list.append(row);
    }
    const last = idx === total - 1;
    root.append(el("h1", null, mode === "initial" ? "Configura l'orario" : "Modifica l'orario"),
      el("p", "lead", "Verifica che l'orario sia corretto"), nav, list,
      navBar(() => {
        if (mode === "timetable" && idx === 0) onDone();
        else { step--; render(); }
      }, last ? "Salva" : "Avanti", last ? save : () => { step++; render(); }));
  }

  function navBar(onBack, label, onNext) {
    const bar = el("div", "nav");
    const pill = el("button", "pill"); pill.type = "button";
    pill.append(el("span", null, label), icon("right"));
    pill.addEventListener("click", onNext);
    bar.append(button("round", "Indietro", onBack, icon("left")), pill);
    return bar;
  }

  /* ---------- Salvataggio ---------- */
  async function save(ev) {
    const btn = ev.currentTarget;
    let err = $("setup-error");
    if (!err) { err = errorBox(); $("setup-body").insertBefore(err, $("setup-body").querySelector(".nav")); }
    btn.disabled = true; btn.firstChild.textContent = "Salvo…"; err.hidden = true;

    const body = { subjects: {}, cells: [] };
    subjects.forEach((s) => {
      const name = (config[s.id].name || "").trim();
      body.subjects[s.id] = {
        name: name === s.name ? null : name || null,
        lab: !!config[s.id].lab,
        color: config[s.id].color || null,
      };
    });
    for (const wd of data.days) {
      for (let h = 1; h <= data.slots; h++) {
        const v = sanitize(picks[cellKey(wd, h)] ?? NONE);
        const lab = v.endsWith(":lab");
        const id = v === NONE ? null : Number(lab ? v.slice(0, -4) : v);
        body.cells.push({ weekday: wd, hpos: h, subject_id: id, lab });
      }
    }
    try {
      const res = await api("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.detail === "string" ? j.detail : "Impossibile salvare l'orario.");
      }
      onDone();
    } catch (e) {
      if (e instanceof LoginError) return showLogin(e.message);
      err.textContent = e.message || "Impossibile salvare l'orario. Riprova.";
      err.hidden = false;
      btn.disabled = false; btn.firstChild.textContent = "Salva";
    }
  }

  async function saveSubjects(ev) {
    const btn = ev.currentTarget;
    let err = $("setup-error");
    if (!err) { err = errorBox(); $("setup-body").insertBefore(err, $("setup-body").querySelector(".nav")); }
    btn.disabled = true; btn.firstChild.textContent = "Salvo…"; err.hidden = true;

    const body = { subjects: {} };
    subjects.forEach((s) => {
      const name = (config[s.id].name || "").trim();
      body.subjects[s.id] = {
        name: name === s.name ? null : name || null,
        lab: !!config[s.id].lab,
        color: config[s.id].color || null,
      };
    });
    try {
      const res = await api("/api/subjects", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(typeof result.detail === "string" ? result.detail : "Impossibile salvare le materie.");
      }
      onDone();
    } catch (error) {
      if (error instanceof LoginError) return showLogin(error.message);
      err.textContent = error.message || "Impossibile salvare le materie. Riprova.";
      err.hidden = false;
      btn.disabled = false; btn.firstChild.textContent = "Salva";
    }
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (dirty) return;
    if (detail.path === "/api/setup/timetable") {
      proposalUpdate = detail.data;
      proposalRevision++;
      data = detail.data;
      subjects = data.subjects;
      if (savedConfiguration) applySavedConfiguration(savedConfiguration);
      else {
        config = {};
        subjects.forEach((s) => { config[s.id] = { name: s.short || s.name, lab: !!s.lab, color: "" }; });
      }
    } else if (detail.path === "/api/timetable") {
      timetableUpdate = detail.data;
      timetableRevision++;
      if (!savedConfiguration || !data) return;
      savedConfiguration = detail.data;
      applySavedConfiguration(savedConfiguration);
    } else {
      return;
    }
    if (step >= 0) render();
  });

  return { start, editSubjects, editTimetable };
})();
