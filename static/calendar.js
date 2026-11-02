"use strict";

/* Il calendario riusa gli eventi annuali della home e mostra solo le prove. */
const Calendar = (() => {
  const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    verifica: SVG('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'),
    interrogazione: SVG('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>'),
  };
  const NAME = { verifica: "Verifica", interrogazione: "Interrogazione" };
  let scroll, months, positionedYear = null, renderedData = null;

  const isoDate = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const key = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

  function goToToday(smooth = true) {
    if (!scroll || !renderedData) return;
    const first = isoDate(renderedData.start), today = isoDate(renderedData.today);
    const monthIndex = (today.getFullYear() - first.getFullYear()) * 12 + today.getMonth() - first.getMonth();
    const left = monthIndex * scroll.clientWidth;
    if (smooth) scroll.scrollTo({ left, behavior: "smooth" });
    else scroll.scrollLeft = left;
  }

  function render(data) {
    if (!scroll) {
      scroll = document.getElementById("cal-scroll");
      months = document.getElementById("cal-months");
    }
    if (data === renderedData) return;

    const byDay = new Map();
    data.events.filter((event) => NAME[event.kind]).forEach((event) => {
      if (!byDay.has(event.date)) byDay.set(event.date, []);
      byDay.get(event.date).push(event);
    });

    const first = isoDate(data.start), last = isoDate(data.end), today = data.today;
    const yearChanged = positionedYear !== data.start;
    const previousMonth = yearChanged ? null : Math.round(scroll.scrollLeft / (scroll.clientWidth || 1));
    months.replaceChildren();

    for (let month = new Date(first.getFullYear(), first.getMonth(), 1);
      month <= last;
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
      const monthSection = document.createElement("section");
      monthSection.className = "cal-month";
      const heading = document.createElement("h3");
      heading.textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
      monthSection.append(heading);

      const grid = document.createElement("div");
      grid.className = "cal-grid";
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const firstOffset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
      const weekCount = Math.ceil((firstOffset + daysInMonth) / 7);
      for (let week = 0; week < weekCount; week++) {
        const row = document.createElement("div");
        row.className = "cal-row";
        for (let weekday = 0; weekday < 7; weekday++) {
          const dayNumber = week * 7 + weekday - firstOffset + 1;
          if (dayNumber < 1 || dayNumber > daysInMonth) {
            const empty = document.createElement("span");
            empty.className = "cd-empty";
            row.append(empty);
            continue;
          }

          const day = new Date(month.getFullYear(), month.getMonth(), dayNumber);
          const dayKey = key(day), tests = byDay.get(dayKey) || [];
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "cd" + (dayKey < today ? " past" : "") + (dayKey === today ? " today" : "");
          const number = document.createElement("span");
          number.className = "n";
          number.textContent = String(dayNumber);
          cell.append(number);

          if (tests.length) {
            const kinds = [...new Set(tests.map((event) => event.kind))];
            const icons = document.createElement("span");
            icons.className = "ic";
            icons.innerHTML = kinds.map((kind) => ICONS[kind]).join("");
            cell.append(icons);
            const description = tests.map((event) => `${NAME[event.kind]}${event.subject ? ` di ${event.subject}` : ""}`).join(", ");
            cell.title = description;
            cell.setAttribute("aria-label", `${dayNumber} ${MONTHS[day.getMonth()]}: ${description}`);
          } else {
            cell.setAttribute("aria-label", `${dayNumber} ${MONTHS[day.getMonth()]}`);
          }
          cell.addEventListener("click", () => EventSheet.showDay(dayKey, tests));
          row.append(cell);
        }
        grid.append(row);
      }
      monthSection.append(grid);
      months.append(monthSection);
    }

    document.getElementById("cal").hidden = false;
    renderedData = data;
    if (yearChanged) {
      positionedYear = data.start;
      requestAnimationFrame(() => goToToday(false));
    } else if (previousMonth !== null) {
      requestAnimationFrame(() => { scroll.scrollLeft = previousMonth * scroll.clientWidth; });
    }
  }

  return { load: render, goToToday };
})();
