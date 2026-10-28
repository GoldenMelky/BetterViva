"use strict";

/* Calendario del mese: una cella per giorno, con un'icona per ogni tipo di prova
   (verifica = foglio, interrogazione = fumetto). I dati arrivano da /api/calendar.
   Toccando un giorno si apre la scheda con le prove di quel giorno (sheet.js). */
const Calendar = (() => {
  const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    verifica: SVG('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'),
    interrogazione: SVG('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>'),
  };
  const NAME = { verifica: "Verifica", interrogazione: "Interrogazione" };
  let loading = false, pendingData = null;

  const isoDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function render(data) {
    const grid = document.getElementById("cal-grid");
    const byDay = {};
    data.events.forEach((e) => (byDay[e.date] ||= []).push(e));

    const start = isoDate(data.start), end = isoDate(data.end);
    const days = Math.round((end - start) / 864e5) + 1;   // il round assorbe il cambio d'ora
    grid.replaceChildren();
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = key(d), tests = byDay[k] || [];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cd" + (k < data.today ? " past" : "") + (k === data.today ? " today" : "");
      const n = document.createElement("span");
      n.className = "n"; n.textContent = d.getDate();
      cell.append(n);

      if (tests.length) {
        const kinds = [...new Set(tests.map((e) => e.kind))];
        const ic = document.createElement("span");
        ic.className = "ic";
        ic.innerHTML = kinds.map((kind) => ICONS[kind] || "").join("");   // stringhe fisse del codice, mai dati del server
        cell.append(ic);
        const what = tests.map((e) => `${NAME[e.kind] || e.kind}${e.subject ? " di " + e.subject : ""}`).join(", ");
        cell.title = what;
        cell.setAttribute("aria-label", `${d.getDate()} ${MONTHS[d.getMonth()]}: ${what}`);
      }
      cell.addEventListener("click", () => EventSheet.showDay(k, tests));
      grid.append(cell);
    }
    document.getElementById("cal").hidden = false;
  }

  async function load() {
    loading = true;
    pendingData = null;
    try {
      const res = await api("/api/calendar");
      if (!res.ok) throw new Error(`Risposta calendario ${res.status}`);
      render(pendingData || await res.json());
    } catch (error) {
      console.error("Impossibile caricare il calendario.", error);
    } finally {
      loading = false;
    }
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (detail.path !== "/api/calendar") return;
    if (loading) pendingData = detail.data;
    else render(detail.data);
  });

  return { load };
})();
