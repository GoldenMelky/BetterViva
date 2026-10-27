"use strict";

/* Calendario mensile di verifiche e interrogazioni, scorribile in entrambe le direzioni. */
const Calendar = (() => {
  const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    verifica: SVG('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'),
    interrogazione: SVG('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>'),
  };
  const NAME = { verifica: "Verifica", interrogazione: "Interrogazione" };
  const MONTH_BATCH = 2;
  const monthData = new Map();
  const monthRequests = new Map();
  let monthOffsets = [];
  let loadingMore = false;
  let initialized = false;

  const $ = (id) => document.getElementById(id);
  const today = new Date();
  const monthDate = (offset) => new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function requestMonth(offset, refresh = false) {
    const month = monthDate(offset);
    const id = monthKey(month);
    if (!refresh && monthData.has(id)) return Promise.resolve(monthData.get(id));
    if (monthRequests.has(id)) return monthRequests.get(id);
    const query = `${id}-01`;
    const pending = api(`/api/calendar?month=${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Risposta calendario ${response.status}`);
        const data = await response.json();
        monthData.set(id, data);
        return data;
      })
      .finally(() => monthRequests.delete(id));
    monthRequests.set(id, pending);
    return pending;
  }

  function preserveScroll(renderMonths) {
    const scroll = $("cal-scroll");
    const visible = [...$("cal-months").children].find((month) => month.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top);
    const anchorId = visible?.dataset.month;
    const anchorTop = visible ? visible.getBoundingClientRect().top - scroll.getBoundingClientRect().top : 0;
    renderMonths();
    if (!anchorId) return;
    const anchor = [...$("cal-months").children].find((month) => month.dataset.month === anchorId);
    if (anchor) scroll.scrollTop += anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchorTop;
  }

  function renderMonth(offset) {
    const month = monthDate(offset);
    const id = monthKey(month);
    const data = monthData.get(id);
    if (!data) return null;
    const section = document.createElement("section");
    section.className = "calendar-month";
    section.dataset.month = id;

    const title = document.createElement("h3");
    title.textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    section.append(title);

    const weekdays = document.createElement("div");
    weekdays.className = "cal-week";
    weekdays.setAttribute("aria-hidden", "true");
    WEEKDAYS.forEach((weekday) => {
      const label = document.createElement("span");
      label.textContent = weekday;
      weekdays.append(label);
    });
    section.append(weekdays);

    const grid = document.createElement("div");
    grid.className = "cal-days";
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - (first.getDay() + 6) % 7);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const end = new Date(last);
    end.setDate(last.getDate() + (6 - (last.getDay() + 6) % 7));
    const byDay = {};
    data.events.forEach((event) => (byDay[event.date] ||= []).push(event));
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 7)) {
      const week = document.createElement("div");
      week.className = "cal-days-row";
      for (let day = 0; day < 7; day++) {
        const d = new Date(date);
        d.setDate(d.getDate() + day);
        const dayKey = key(d), tests = byDay[dayKey] || [];
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cd" + (dayKey < data.today ? " past" : "") + (dayKey === data.today ? " today" : "");
        cell.setAttribute("aria-label", `${d.getDate()} ${MONTHS[d.getMonth()]}${tests.length
          ? `: ${tests.map((event) => `${NAME[event.kind] || event.kind}${event.subject ? ` di ${event.subject}` : ""}`).join(", ")}`
          : ""}`);
        const number = document.createElement("span");
        number.className = "n";
        number.textContent = d.getDate();
        cell.append(number);
        if (tests.length) {
          const kinds = [...new Set(tests.map((event) => event.kind))];
          const icons = document.createElement("span");
          icons.className = "ic";
          icons.innerHTML = kinds.map((kind) => ICONS[kind] || "").join("");
          cell.append(icons);
          cell.title = tests.map((event) => `${NAME[event.kind] || event.kind}${event.subject ? ` di ${event.subject}` : ""}`).join(", ");
        }
        cell.addEventListener("click", () => EventSheet.showDay(dayKey, tests));
        week.append(cell);
      }
      grid.append(week);
    }
    section.append(grid);
    return section;
  }

  function renderMonths() {
    const months = $("cal-months");
    months.replaceChildren(...monthOffsets.map(renderMonth).filter(Boolean));
    $("cal").hidden = !months.childElementCount;
  }

  async function loadOffsets(offsets, prepend = false) {
    const unique = offsets.filter((offset) => !monthOffsets.includes(offset));
    if (!unique.length) return;
    const scroll = $("cal-scroll");
    monthOffsets = (prepend ? [...unique, ...monthOffsets] : [...monthOffsets, ...unique]).sort((a, b) => a - b);
    const results = await Promise.allSettled(unique.map((offset) => requestMonth(offset)));
    results.filter((result) => result.status === "rejected")
      .forEach((result) => console.error("Impossibile caricare un mese del calendario.", result.reason));
    monthOffsets = monthOffsets.filter((offset) => monthData.has(monthKey(monthDate(offset))));
    if (!monthOffsets.some((offset) => monthData.has(monthKey(monthDate(offset))))) {
      return;
    }
    preserveScroll(renderMonths);
  }

  async function loadMore(direction) {
    if (loadingMore || !initialized) return;
    loadingMore = true;
    const edge = direction < 0 ? Math.min(...monthOffsets) : Math.max(...monthOffsets);
    const offsets = Array.from({ length: MONTH_BATCH }, (_, index) => edge + direction * (index + 1));
    try {
      await loadOffsets(offsets, direction < 0);
    } finally {
      loadingMore = false;
    }
  }

  async function load() {
    if (!initialized) {
      initialized = true;
      monthOffsets = [];
      await loadOffsets([-MONTH_BATCH, -1, 0, 1, MONTH_BATCH]);
      if (!monthOffsets.length) initialized = false;
      return;
    }
    try {
      await requestMonth(0, true);
      preserveScroll(renderMonths);
    } catch (error) {
      console.error("Impossibile aggiornare il calendario del mese corrente.", error);
    }
  }

  $("cal-scroll").addEventListener("scroll", () => {
    const scroll = $("cal-scroll");
    if (scroll.scrollTop < 80) void loadMore(-1);
    if (scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 80) void loadMore(1);
  }, { passive: true });

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (!detail.path.startsWith("/api/calendar")) return;
    const url = new URL(detail.path, location.origin);
    const requestedMonth = url.searchParams.get("month");
    const id = requestedMonth?.slice(0, 7) || monthKey(monthDate(0));
    monthData.set(id, detail.data);
    preserveScroll(renderMonths);
  });

  return { load };
})();
