"use strict";

/* Bottom sheet generico (Sheet) e le due schede per verifiche e interrogazioni (EventSheet):
   - showDay: i giorni del calendario, con la lista delle prove e "Non è una verifica?";
   - showEvent: un evento della home, per leggerlo per intero e segnarlo come prova (o toglierlo). */
const Sheet = (() => {
  let backdrop, sheet, body, hideTimer = null, historyEntry = false;

  function build() {
    if (backdrop) return;
    backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop"; backdrop.hidden = true;
    sheet = document.createElement("div");
    sheet.className = "sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.tabIndex = -1;
    const handle = document.createElement("div"); handle.className = "sheet-handle";
    handle.append(document.createElement("span"));
    body = document.createElement("div"); body.className = "sheet-body";
    sheet.append(handle, body); backdrop.append(sheet); document.body.append(backdrop);

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) close(); });

    // trascinando la maniglia verso il basso la scheda si chiude
    let startY = null;
    handle.addEventListener("pointerdown", (e) => { startY = e.clientY; handle.setPointerCapture(e.pointerId); sheet.style.transition = "none"; });
    handle.addEventListener("pointermove", (e) => {
      if (startY !== null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
    });
    const end = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY; startY = null;
      sheet.style.transition = ""; sheet.style.transform = "";
      if (dy > 80) close();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function open(...nodes) {
    build();
    clearTimeout(hideTimer);
    if (backdrop.hidden) {
      history.pushState({ ...(history.state || {}), bvSheet: true }, "");
      historyEntry = true;
    }
    body.replaceChildren(...nodes);
    backdrop.hidden = false;
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => { backdrop.classList.add("open"); sheet.focus({ preventScroll: true }); });
  }

  function update(...nodes) { body.replaceChildren(...nodes); }

  function close(fromHistory = false) {
    if (!backdrop || backdrop.hidden) return;
    if (!fromHistory && historyEntry) {
      historyEntry = false;
      history.back();
      return;
    }
    historyEntry = false;
    backdrop.classList.remove("open");
    document.body.classList.remove("sheet-open");
    hideTimer = setTimeout(() => { backdrop.hidden = true; }, 220);
  }

  function handleBack() {
    if (!backdrop || backdrop.hidden) return false;
    close(true);
    return true;
  }

  return { open, update, close, handleBack };
})();

const EventSheet = (() => {
  const NAME = { verifica: "Verifica", interrogazione: "Interrogazione" };
  const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON_CAL = SVG('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>');
  const ICON_TRASH = SVG('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function button(label, cls, onClick) {
    const b = h("button", `btn ${cls || ""}`.trim(), label);
    b.type = "button"; b.addEventListener("click", onClick);
    return b;
  }
  const badge = (kind) => h("span", "badge", NAME[kind] || kind);
  const fmtDate = (iso) => iso.split("-").reverse().join("/");     // 2026-10-12 -> 12/10/2026

  async function setKind(id, kind) {
    const res = await api(`/api/events/${id}/kind`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
    });
    if (!res.ok) throw new Error(res.status);
    Home.load();     // aggiorna in background home e calendario dietro la scheda
  }

  /* ---- giorno del calendario ---- */
  function showDay(day, events) {
    let list = events.slice(), confirming = null, error = "";

    function entry(e) {
      if (confirming === e.id) {
        const box = h("div", "confirm");
        box.append(h("p", "confirm-q", e.kind === "interrogazione" ? "Non è un'interrogazione?" : "Non è una verifica?"));
        if (error) box.append(h("p", "confirm-err", error));
        const row = h("div", "btn-row");
        const remove = button("Rimuovi", "", async () => {
          remove.disabled = true;
          try {
            await setKind(e.id, null);
            list = list.filter((x) => x.id !== e.id); confirming = null; error = "";
          } catch { error = "Impossibile salvare. Riprova."; }
          draw();
        });
        row.append(remove, button("Annulla", "ghost", () => { confirming = null; error = ""; draw(); }));
        box.append(row);
        return box;
      }
      const item = h("div", "t-entry");
      const top = h("div", "t-top");
      const trash = h("button", "icon-btn"); trash.type = "button"; trash.innerHTML = ICON_TRASH;
      trash.setAttribute("aria-label", `Rimuovi: ${NAME[e.kind] || e.kind} di ${e.subject}`);
      trash.addEventListener("click", () => { confirming = e.id; error = ""; draw(); });
      top.append(h("span", "t-title", e.subject || "Evento"), badge(e.kind), trash);
      item.append(top);
      if (e.teacher) item.append(h("p", "sheet-meta", e.teacher));
      if (e.text) item.append(h("p", "t-text", e.text));
      return item;
    }

    function nodes() {
      const head = h("div", "sheet-date"); head.innerHTML = ICON_CAL; head.append(h("span", "", fmtDate(day)));
      const out = [head];
      if (!list.length) out.push(h("p", "sheet-empty", "Nessuna verifica o interrogazione"));
      list.forEach((e) => out.push(entry(e)));
      return out;
    }
    const draw = () => Sheet.update(...nodes());
    Sheet.open(...nodes());
  }

  /* ---- singolo evento ---- */
  function showEvent(ev) {
    const e = { ...ev };
    let marking = false, kind = "verifica", error = "", busy = false;

    function view() {
      const title = h("h2", "sheet-title"); title.append(h("span", "", e.subject || "Evento"));
      if (e.kind) title.append(badge(e.kind));
      const nodes = [title];
      if (e.teacher) nodes.push(h("p", "sheet-meta", e.teacher));
      if (e.text) nodes.push(h("p", "sheet-text", e.text));

      const actions = h("div", "sheet-actions");
      const save = async (value, after) => {
        busy = true; error = ""; redraw();
        try { await setKind(e.id, value); e.kind = value; after(); }
        catch { error = "Impossibile salvare. Riprova."; }
        busy = false; redraw();
      };

      if (!marking && Home.isHomework(e) && !e.kind) {
        const doneBtn = button(e.done ? "Segna da fare" : "Segna come completato", e.done ? "ghost" : "", async () => {
          doneBtn.disabled = true; error = "";
          const state = await Home.toggleDone(e);
          if (state === null) error = "Impossibile salvare. Riprova.";
          else e.done = state;
          redraw();
        });
        doneBtn.disabled = busy;
        actions.append(doneBtn);
      }

      if (marking) {
        const sel = h("select", "kind-select"); sel.setAttribute("aria-label", "Tipo di prova");
        Object.entries(NAME).forEach(([v, label]) => { const o = h("option", "", label); o.value = v; o.selected = v === kind; sel.append(o); });
        sel.addEventListener("change", () => { kind = sel.value; });
        const row = h("div", "btn-row");
        const ok = button("Conferma", "", () => save(kind, () => { marking = false; }));
        const no = button("Annulla", "ghost", () => { marking = false; error = ""; redraw(); });
        ok.disabled = no.disabled = busy;
        row.append(ok, no); actions.append(sel, row);
      } else if (e.kind) {
        const b = button(`Rimuovi ${e.kind}`, "", () => save(null, () => { e.kind = null; }));
        b.disabled = busy; actions.append(b);
      } else {
        actions.append(button("Segna come verifica/interrogazione", "", () => { marking = true; kind = "verifica"; error = ""; redraw(); }));
      }
      if (error) actions.append(h("p", "confirm-err", error));
      nodes.push(actions);
      return nodes;
    }
    const redraw = () => Sheet.update(...view());
    Sheet.open(...view());
  }

  return { showDay, showEvent };
})();
