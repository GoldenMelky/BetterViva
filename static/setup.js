"use strict";

/* Setup iniziale obbligatorio (utente senza orario salvato per l'anno in corso).
   Passi: 0 benvenuto -> 1 materie (nome + laboratorio) -> 2.. orario, un giorno per volta.
   Tutto è precompilato con la proposta del backend (GET /api/setup/timetable);
   il server rivalida ogni cosa. Testi sempre con textContent, mai innerHTML. */
const Setup = (() => {
  const DAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
  const NONE = "";                       // valore di "Nessuna lezione"
  const MAX_NAME = 40;
  const SVG = "http://www.w3.org/2000/svg";
  const ICONS = {
    left: "M19 12H5M11 6l-6 6 6 6",
    right: "M5 12h14M13 6l6 6-6 6",
    down: "M6 9l6 6 6-6",
    check: "M5 12.5l4.5 4.5L19 7.5",
    edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  };

  let data = null;                       // proposta del backend
  let subjects = [];                     // [{id, name, short, lab, teachers}]
  let config = {};                       // id -> {name, lab}
  let picks = {};                        // "wd-h" -> "" | "<id>" | "<id>:lab"
  let flagged = new Set();               // celle incerte (status != ok): mostrate con "?"
  let step = 0;                          // 0 benvenuto, 1 materie, 2.. giorni
  let firstName = "";
  let onDone = () => {};

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

  /* ---------- Avvio ---------- */
  function start(name, done) {
    firstName = name || "";
    onDone = done;
    step = 0;
    data = null;
    render();
  }

  async function loadProposal() {
    const res = await api("/api/setup/timetable");
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    subjects = data.subjects;
    config = {};
    subjects.forEach((s) => { config[s.id] = { name: s.short || s.name, lab: !!s.lab }; });
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
    lead.append(el("b", null, "Rinomina"), " le materie e segna quelle con laboratorio");
    const cols = el("div", "cols");
    cols.append(el("span", null, "Lab?"), el("span", null, "Materia"), el("span"));

    const list = el("div", "card rows");
    list.append(cols);
    subjects.forEach((s) => {
      const row = el("div", "subj");

      const box = el("label", "labbox");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = config[s.id].lab;
      cb.setAttribute("aria-label", `${nameOf(s)}: ha il laboratorio`);
      cb.addEventListener("change", () => { config[s.id].lab = cb.checked; });
      const mark = el("i"); mark.append(icon("check"));
      box.append(cb, mark);

      const name = el("span", "name", nameOf(s));
      name.title = s.name;
      const edit = button("round ghost", `Rinomina ${s.name}`, () => {
        const input = el("input"); input.type = "text"; input.maxLength = MAX_NAME; input.value = config[s.id].name;
        const done = () => { config[s.id].name = input.value; name.textContent = nameOf(s); input.replaceWith(name); };
        input.addEventListener("blur", done);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
        name.replaceWith(input); input.focus(); input.select();
      }, icon("edit"));

      row.append(box, name, edit);
      list.append(row);
    });
    root.append(el("h1", null, "Configura le materie"), lead, list,
      navBar(() => { step = 0; render(); }, "Configura l'orario", () => { step = 2; render(); }));
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
      sel.addEventListener("change", () => { picks[k] = sel.value; flagged.delete(k); mark(); });
      wrap.append(sel, icon("down"));
      row.append(wrap);
      list.append(row);
    }
    const last = idx === total - 1;
    root.append(el("h1", null, "Configura l'orario"),
      el("p", "lead", "Verifica che l'orario sia corretto"), nav, list,
      navBar(() => { step--; render(); }, last ? "Salva" : "Avanti", last ? save : () => { step++; render(); }));
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
      body.subjects[s.id] = { name: name === s.name ? null : name || null, lab: !!config[s.id].lab };
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

  return { start };
})();
