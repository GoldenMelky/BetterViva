"use strict";

/* Setup iniziale obbligatorio (utente senza orario salvato per l'anno in corso).
   Passi: 1 materie -> 2 orario -> 3 tema (segnaposto).
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
    info: "M12 8h.01M11 12h1v4h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  };

  let data = null;                       // proposta del backend
  let savedConfiguration = null;
  let subjects = [];                     // [{id, name, short, lab, teachers}]
  let config = {};                       // id -> {name, lab, color}
  let picks = {};                        // "wd-h" -> "" | "<id>" | "<id>:lab"
  let flagged = new Set();               // celle incerte (status != ok): mostrate con "?"
  let step = 1;
  let selectedDay = 1;
  let dayCounts = {};
  let onDone = () => {};
  let mode = "initial";                 // initial, subjects, timetable
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

    // FISSA LE DIMENSIONI DI BASE DELL'ICONA
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");

    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", ICONS[name]);
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
  const subjectColor = (value) => COLORS.find(([key]) => key === value)?.[2] || "#6ea8ff";

  /* ---------- Avvio ---------- */
  function start(_name, done) {
    onDone = done;
    mode = "initial";
    step = -1;
    data = null;
    savedConfiguration = null;
    dirty = false;
    render();
    loadProposal().then(() => {
      if (mode !== "initial") return;
      initializeDayCounts();
      selectedDay = data.days[0] ?? 1;
      step = 1;
      render();
    }).catch((error) => {
      if (error instanceof LoginRequired) return showLogin(error.message);
      step = 0;
      render();
    });
  }

  function initializeDayCounts() {
    dayCounts = {};
    data.days.forEach((wd) => {
      const last = data.cells
        .filter((cell) => cell.weekday === wd)
        .reduce((max, cell) => cell.subject_id != null || cell.status !== "empty" ? Math.max(max, cell.hpos) : max, 0);
      dayCounts[wd] = last;
    });
  }

  async function loadSavedConfiguration(done) {
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
      initializeDayCounts();
      return true;
    } catch (error) {
      if (error instanceof LoginRequired) return showLogin(error.message);
      const root = $("setup-body");
      const content = el("div", "ob-body");
      content.append(el("p", "error", error.message || "Impossibile caricare l'orario."));
      renderShell(root, content, navBar(done, "Torna alle impostazioni", done));
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
      selectedDay = data.days[0] ?? 1;
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
    subjects.forEach((s, index) => {
      config[s.id] = { name: s.short || s.name, lab: !!s.lab, color: COLORS[index % COLORS.length][0] };
    });
    picks = {};
    flagged = new Set();
    data.cells.forEach((c) => {
      const k = cellKey(c.weekday, c.hpos);
      picks[k] = c.subject_id == null ? NONE : String(c.subject_id) + (c.lab ? ":lab" : "");
      if (c.status !== "ok") flagged.add(k);
    });
    initializeDayCounts();
  }

  /* ---------- Rendering ---------- */
  function render() {
    const root = $("setup-body");
    root.replaceChildren();
    window.scrollTo(0, 0);
    if (step === -1) {
      renderShell(root, el("p", "setup-status", "Carico la configurazione…"));
      return;
    }
    if (step === 0) {
      const content = el("div", "ob-body");
      const err = errorBox();
      err.textContent = "Non riesco a leggere le materie e le lezioni da ClasseViva. Riprova tra poco.";
      err.hidden = false;
      const retry = button("setup-retry", null, () => {
        step = -1;
        render();
        loadProposal().then(() => {
          initializeDayCounts();
          selectedDay = data.days[0] ?? 1;
          step = 1;
          render();
        }).catch((error) => {
          if (error instanceof LoginRequired) return showLogin(error.message);
          step = 0;
          render();
        });
      }, el("span", null, "Riprova"));
      content.append(err, retry);
      renderShell(root, content);
      return;
    }

    const content = el("div", "ob-body");
    const footer = navBar(
      () => {
        if (mode === "initial" && step === 1) return logout();
        if (mode !== "initial" && step === 1) return onDone();
        if (mode === "timetable" && step === 2) return onDone();
        step--;
        render();
      },
      mode === "subjects" ? "Salva" : mode === "timetable" ? "Salva" : step === 3 ? "Termina" : "Continua",
      mode === "subjects" ? saveSubjects
        : mode === "timetable" ? save
          : step === 3 ? save
            : () => { step++; render(); },
    );
    if (step === 1) renderSubjects(content);
    else if (step === 2) renderDay(content);
    else renderTheme(content);
    renderShell(root, content, footer);
  }

  function renderShell(root, content, footer = null) {
    const shell = el("div", "setup-screen");
    const header = el("header", "ob-head");
    const top = el("div", "ob-top");
    const logo = el("span", "setup-logo");
    const mark = document.createElementNS(SVG, "svg");
    mark.setAttribute("viewBox", "0 0 24 24");
    mark.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(SVG, "path");
    shape.setAttribute("d", "M6 4h7a4 4 0 0 1 1.6 7.67A4.5 4.5 0 0 1 13.5 20H6z");
    shape.setAttribute("fill", "#c4251c");
    const tick = document.createElementNS(SVG, "path");
    tick.setAttribute("d", "m9 12.5 2 2 4-4.5");
    tick.setAttribute("fill", "none");
    tick.setAttribute("stroke", "#fff");
    tick.setAttribute("stroke-width", "2.2");
    tick.setAttribute("stroke-linecap", "round");
    tick.setAttribute("stroke-linejoin", "round");
    mark.append(shape, tick);
    logo.append(mark);
    top.append(logo, el("b", null, "Configurazione"));
    if (step >= 1 && step <= 3) top.append(el("span", "ob-count", `${step} di 3`));
    header.append(top);
    if (step >= 1 && step <= 3) {
      const titles = [
        ["Le tue materie", "Rinominale, segna quelle con il laboratorio e scegli un colore."],
        ["Il tuo orario", "Controlla le materie di ogni ora. Ogni giorno può avere un numero di ore diverso."],
        ["Scegli il tema", "Personalizza l'aspetto di BetterViva."],
      ];
      const [title, subtitle] = titles[step - 1];
      header.append(el("h1", null, title), el("p", null, subtitle));
      const progress = el("div", "ob-steps");
      progress.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 3; i++) {
        const segment = el("i");
        segment.classList.toggle("on", i < step);
        progress.append(segment);
      }
      header.append(progress);
    } else {
      header.append(el("h1", null, mode === "initial" ? "Prepariamo BetterViva" : "Modifica l'orario"));
    }
    shell.append(header, content);
    if (footer) shell.append(footer);
    root.append(shell);
  }

  function renderSubjects(root) {
    const note = el("div", "setup-note");
    note.append(icon("info"));
    const noteText = el("p");
    noteText.append("Abbiamo trovato ", el("b", null, `${subjects.length} materie`),
      " nel registro. Usa nomi brevi che riconosci al volo; tocca il colore per cambiarlo.");
    note.append(noteText);
    root.append(note);

    if (!subjects.length) {
      root.append(el("p", "setup-empty", "Non sono state trovate materie nel registro."));
      return;
    }

    subjects.forEach((s, index) => {
      const card = el("article", "subject-card");
      card.style.setProperty("--subject-color", subjectColor(config[s.id].color));
      card.classList.toggle("is-open", index === 0);

      const row = el("div", "subject-card-row");
      const colorButton = button("subject-initials", `Scegli il colore per ${nameOf(s)}`, () => {
        const opening = !card.classList.contains("is-open");
        root.querySelectorAll(".subject-card.is-open").forEach((other) => {
          other.classList.remove("is-open");
          other.querySelector(".subject-initials").setAttribute("aria-expanded", "false");
        });
        card.classList.toggle("is-open", opening);
        colorButton.setAttribute("aria-expanded", String(opening));
      }, el("span", null, (nameOf(s).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "?").toUpperCase()));
      colorButton.setAttribute("aria-expanded", String(index === 0));

      const field = el("div", "subject-name-field");
      const name = el("input", "subject-name");
      name.type = "text";
      name.maxLength = MAX_NAME;
      name.value = config[s.id].name;
      name.autocomplete = "off";
      name.spellcheck = false;
      name.setAttribute("aria-label", `Nome per ${s.name}`);
      name.title = s.name;
      name.addEventListener("input", () => {
        config[s.id].name = name.value;
        colorButton.firstChild.textContent = (nameOf(s).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "?").toUpperCase();
        colorButton.setAttribute("aria-label", `Scegli il colore per ${nameOf(s)}`);
        lab.setAttribute("aria-label", `Laboratorio per ${nameOf(s)}`);
        palette.setAttribute("aria-label", `Colore di ${nameOf(s)}`);
        dirty = true;
      });
      field.append(name, el("small", null, `Dal registro: ${s.name}`));

      const lab = button("lab-switch", `Laboratorio per ${nameOf(s)}`, () => {
        config[s.id].lab = !config[s.id].lab;
        lab.setAttribute("aria-checked", String(config[s.id].lab));
        dirty = true;
      });
      lab.setAttribute("role", "switch");
      lab.setAttribute("aria-checked", String(config[s.id].lab));
      lab.append(el("span", "lab-track"), el("span", null, "Lab"));
      row.append(colorButton, field, lab);
      card.append(row);

      const palette = el("div", "subject-palette");
      palette.setAttribute("role", "radiogroup");
      palette.setAttribute("aria-label", `Colore di ${nameOf(s)}`);
      COLORS.forEach(([value, label, sample]) => {
        const swatch = button("subject-swatch", label, () => {
          config[s.id].color = value;
          card.style.setProperty("--subject-color", sample);
          palette.querySelectorAll('[role="radio"]').forEach((option) => {
            option.setAttribute("aria-checked", String(option === swatch));
          });
          dirty = true;
        }, icon("check"));
        swatch.setAttribute("role", "radio");
        swatch.setAttribute("aria-checked", String(config[s.id].color === value));
        swatch.style.setProperty("--swatch-color", sample);
        palette.append(swatch);
      });
      card.append(palette);
      root.append(card);
    });
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

  function renderDay(root) {
    const wd = selectedDay;
    const count = dayCounts[wd] || 0;
    const uncertain = [...flagged].filter((key) => {
      const [day, hour] = key.split("-").map(Number);
      return hour <= (dayCounts[day] || 0);
    });
    if (uncertain.length) {
      const note = el("div", "setup-note setup-note-warn");
      note.append(icon("info"));
      const copy = el("p");
      copy.append("Abbiamo ricostruito l'orario dalle lezioni dell'ultimo mese, ma non siamo sicuri di ",
        el("b", null, `${uncertain.length} ${uncertain.length === 1 ? "ora" : "ore"}`), " (in giallo).");
      note.append(copy);
      root.append(note);
    }

    const days = el("div", "setup-days");
    days.setAttribute("role", "tablist");
    days.setAttribute("aria-label", "Giorni della settimana");
    data.days.forEach((day) => {
      const dayUncertain = [...flagged].some((key) => Number(key.split("-")[0]) === day);
      const tab = button("setup-day", null, () => {
        selectedDay = day;
        render();
      }, el("span", "setup-day-label", (DAYS[day] || "").slice(0, 3)),
      el("b", null, String(dayCounts[day] || 0)));
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(day === wd));
      tab.setAttribute("aria-label", `${DAYS[day]}, ${dayCounts[day] || 0} ${dayCounts[day] === 1 ? "ora" : "ore"}${dayUncertain ? ", da verificare" : ""}`);
      days.append(tab);
    });
    root.append(days);

    const dayHead = el("div", "setup-day-head");
    const heading = el("div");
    heading.append(el("h2", null, DAYS[wd] || ""), el("p", null, `${count} ${count === 1 ? "lezione" : "lezioni"}`));
    const countControl = el("div", "hour-count");
    const decrease = button("hour-count-button", "Meno ore", () => {
      if (!dayCounts[wd]) return;
      const key = cellKey(wd, dayCounts[wd]);
      picks[key] = NONE;
      flagged.delete(key);
      dayCounts[wd]--;
      dirty = true;
      render();
    }, el("span", null, "−"));
    decrease.disabled = count === 0;
    const output = el("output", null, `${count} ${count === 1 ? "ora" : "ore"}`);
    const increase = button("hour-count-button", "Più ore", () => {
      if (dayCounts[wd] >= 10) return;
      dayCounts[wd]++;
      data.slots = Math.max(data.slots, dayCounts[wd]);
      dirty = true;
      render();
    }, el("span", null, "+"));
    increase.disabled = count >= 10;
    countControl.append(decrease, output, increase);
    dayHead.append(heading, countControl);
    root.append(dayHead);

    const list = el("div", "setup-hours");
    for (let h = 1; h <= count; h++) {
      const key = cellKey(wd, h);
      const row = el("div", "setup-hour");
      const value = sanitize(picks[key] ?? NONE);
      picks[key] = value;
      const id = value.endsWith(":lab") ? Number(value.slice(0, -4)) : Number(value);
      const subject = subjects.find((item) => item.id === id);
      row.style.setProperty("--subject-color", subjectColor(subject ? config[subject.id].color : ""));
      row.classList.toggle("is-uncertain", flagged.has(key));
      row.append(el("span", "setup-hour-number", `${h}°`));

      const wrap = el("div", "setup-hour-select");
      const select = optionsFor(wd, h);
      select.className = "setup-select";
      select.value = value;
      if (select.value !== value) {
        select.value = NONE;
        picks[key] = NONE;
      }
      const mark = () => {
        [...select.options].forEach((option) => { option.textContent = option.dataset.base; });
        if (flagged.has(key) && select.selectedOptions[0]) select.selectedOptions[0].textContent += " · da verificare";
      };
      mark();
      select.setAttribute("aria-label", `${DAYS[wd]}, ${h}ª ora`);
      select.addEventListener("change", () => {
        picks[key] = select.value;
        flagged.delete(key);
        dirty = true;
        render();
      });
      wrap.append(select, icon("down"));
      row.append(wrap);
      if (flagged.has(key)) row.append(el("span", "setup-hour-warning", "Da verificare"));
      list.append(row);
    }
    if (!count) list.append(el("p", "setup-empty", "Nessuna lezione. Aggiungi le ore con il pulsante +."));
    root.append(list);


  }

  function renderTheme(root) {
    const preview = el("div", "theme-preview");
    const previewHead = el("div", "theme-preview-head");
    const logo = el("span", "setup-logo");
    const mark = document.createElementNS(SVG, "svg");
    mark.setAttribute("viewBox", "0 0 24 24");
    mark.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(SVG, "path");
    shape.setAttribute("d", "M6 4h7a4 4 0 0 1 1.6 7.67A4.5 4.5 0 0 1 13.5 20H6z");
    shape.setAttribute("fill", "#c4251c");
    const tick = document.createElementNS(SVG, "path");
    tick.setAttribute("d", "m9 12.5 2 2 4-4.5");
    tick.setAttribute("fill", "none");
    tick.setAttribute("stroke", "#fff");
    tick.setAttribute("stroke-width", "2.2");
    tick.setAttribute("stroke-linecap", "round");
    tick.setAttribute("stroke-linejoin", "round");
    mark.append(shape, tick);
    logo.append(mark);
    previewHead.append(logo, el("b", null, "BetterViva"), el("span", "theme-preview-avatar"));
    preview.append(previewHead);
    const lessonList = el("div", "theme-preview-body");
    subjects.slice(0, 2).forEach((subject, index) => {
      const lesson = el("div", "theme-preview-lesson");
      lesson.style.setProperty("--subject-color", subjectColor(config[subject.id].color));
      lesson.append(el("span", "setup-hour-number", `${index + 1}°`),
        el("b", null, nameOf(subject)),
        index === 1 && config[subject.id].lab ? el("span", "theme-lab-tag", "LAB") : el("span"));
      lessonList.append(lesson);
    });
    preview.append(lessonList);
    root.append(preview);

    const appearance = el("div", "theme-section");
    appearance.append(el("h2", null, "Aspetto"), el("span", null, "Scuro"));
    root.append(appearance);
    const modes = el("div", "theme-modes");
    [["Scuro", "dark"], ["Chiaro", "light"], ["Automatico", "auto"]].forEach(([label, mode]) => {
      const option = el("div", "theme-mode");
      option.setAttribute("aria-label", `${label}, anteprima`);
      option.append(el("span", `theme-mini ${mode}`), el("b", null, label));
      if (mode === "dark") option.classList.add("is-selected");
      modes.append(option);
    });
    root.append(modes);

    const accent = el("div", "theme-section theme-accent-heading");
    accent.append(el("h2", null, "Colore principale"), el("span", null, "Rosso"));
    root.append(accent);
    const colors = el("div", "theme-colors");
    ["#e5382c", "#f0732a", "#e63e7d", "#8a5cf0", "#2f7bf0", "#1fa971"].forEach((color, index) => {
      const swatch = el("span", "theme-color");
      swatch.style.setProperty("--theme-color", color);
      if (index === 0) swatch.append(icon("check"));
      colors.append(swatch);
    });
    root.append(colors, el("p", "theme-placeholder", "Potrai cambiare tema in qualsiasi momento dal menu."));
  }

  function navBar(onBack, label, onNext) {
    const bar = el("div", "ob-foot");
    const back = button("btn ghost", null, onBack, el("span", null, "Indietro"));
    const next = button("btn", null, onNext, el("span", null, label), icon("right"));
    bar.append(back, next);
    return bar;
  }

  /* ---------- Salvataggio ---------- */
  async function save(ev) {
    const btn = ev.currentTarget;
    let err = $("setup-error");
    if (!err) { err = errorBox(); $("setup-body").querySelector(".ob-body").append(err); }
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
      if (e instanceof LoginRequired) return showLogin(e.message);
      err.textContent = e.message || "Impossibile salvare l'orario. Riprova.";
      err.hidden = false;
      btn.disabled = false; btn.firstChild.textContent = "Salva";
    }
  }

  async function saveSubjects(ev) {
    const btn = ev.currentTarget;
    let err = $("setup-error");
    if (!err) { err = errorBox(); $("setup-body").querySelector(".ob-body").append(err); }
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
      if (error instanceof LoginRequired) return showLogin(error.message);
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
        subjects.forEach((s, index) => {
          config[s.id] = { name: s.short || s.name, lab: !!s.lab, color: COLORS[index % COLORS.length][0] };
        });
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

  function back() {
    if (mode === "initial") {
      if (step > 1) { step--; render(); }
      else if (step === 1) logout();
      return true;
    }
    return false;
  }

  return { start, editSubjects, editTimetable, back };
})();
