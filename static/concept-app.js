"use strict";

(() => {
  const app = document.getElementById("app");
  const sheetBody = document.getElementById("sheetBody");
  const SVG_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0f0607" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>';
  const COLORS = {
    red: "var(--red)", green: "var(--green)", blue: "var(--blue)", yellow: "var(--amber)",
    brown: "var(--orange)", purple: "var(--purple)", orange: "var(--orange)",
    teal: "var(--cyan)", pink: "var(--pink)",
  };
  const KIND_LABEL = { compito: "Compito", verifica: "Verifica", interrogazione: "Interrogazione" };
  const FILTERS = ["tutti", "compito", "verifica", "interrogazione"];
  const PERIOD_ALL = "__all__";

  let eventsData = null;
  let timetableData = null;
  let gradesData = null;
  let profile = null;
  let selectedDate = null;
  let days = [];
  let eventFilter = "tutti";
  let calendarOpen = false;
  let calendarDate = null;
  let selectedPeriod = PERIOD_ALL;
  let selectedSubjectId = null;
  let activePlaceholder = null;
  let homeLoad = null;
  let gradesLoad = null;
  let renderingGradePages = false;
  let pendingNotificationDate = null;
  let toastTimer = null;

  const node = (tag, cls = "", text) => {
    const result = document.createElement(tag);
    if (cls) result.className = cls;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const button = (text, cls, handler, label = "") => {
    const result = node("button", cls, text);
    result.type = "button";
    if (label) result.setAttribute("aria-label", label);
    result.addEventListener("click", handler);
    return result;
  };
  const dateFromKey = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const result = new Date(year, month - 1, day);
    return Number.isNaN(result.getTime()) ? null : result;
  };
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dayLabel = (value, options = { weekday: "long" }) => {
    const date = dateFromKey(value);
    return date ? new Intl.DateTimeFormat("it-IT", options).format(date) : "";
  };
  const subjectConfig = (id) => timetableData?.subjects?.[String(id)] || {};
  const subjectName = (id, fallback = "") => {
    const config = subjectConfig(id);
    return fallback || config.name || config.subject || "Lezione";
  };
  const subjectColor = (id) => COLORS[subjectConfig(id).color] || "var(--blue)";
  const averageColor = (average) => average == null ? "var(--dim)"
    : Number(average) < 6 ? "var(--bad)"
      : Number(average) < 7 ? "var(--ok)" : "var(--green)";
  const currentDate = () => dateFromKey(eventsData?.today) || new Date();
  const eventKind = (event) => event.kind || "compito";
  const isHomework = (event) => !event.kind;

  function setStatus(message) {
    const status = document.getElementById("status");
    if (status) status.textContent = message;
    const toast = document.getElementById("connection-toast");
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = !message;
    if (message) toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  async function loadJson(path, optional = false) {
    const response = await window.BetterViva.api(path);
    if (optional && !response.ok) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Impossibile caricare ${path}.`);
    }
    return response.json();
  }

  async function loadHome() {
    if (homeLoad) return homeLoad;
    homeLoad = Promise.all([
      loadJson("/api/events"),
      loadJson("/api/timetable", true),
    ]).then(([events, timetable]) => {
      eventsData = events;
      timetableData = timetable;
      calendarDate = dateFromKey(events.today) || new Date();
      const daysWithData = new Set((events.events || []).map((event) => event.date));
      days = schoolDays(events, timetable, daysWithData);
      selectedDate = days.find((date) => date === events.today) || days[0] || events.today;
      if (pendingNotificationDate) {
        includeDate(pendingNotificationDate);
        selectedDate = pendingNotificationDate;
        pendingNotificationDate = null;
      }
      renderHome();
      setStatus("");
    }).catch((error) => {
      setStatus(error.message || "Impossibile caricare gli eventi. Riprova.");
      const pager = document.getElementById("pager");
      const message = node("div", "empty");
      message.append(node("p", "", "Impossibile caricare gli eventi."), button("Riprova", "calc-btn", () => loadHome().catch(() => {})));
      pager.replaceChildren(message);
      throw error;
    }).finally(() => { homeLoad = null; });
    return homeLoad;
  }

  function schoolDays(data, timetable, eventDays) {
    const start = dateFromKey(data.today);
    const end = dateFromKey(data.end);
    if (!start || !end) return [];
    const weekdays = new Set((timetable?.cells || []).map((cell) => cell.weekday));
    const result = [];
    for (let date = start; date <= end && result.length < 8; date.setDate(date.getDate() + 1)) {
      const weekday = (date.getDay() + 6) % 7;
      const key = dateKey(date);
      if (weekdays.has(weekday) || eventDays.has(key)) result.push(key);
    }
    if (!result.length) result.push(data.today);
    return result;
  }

  function includeDate(value) {
    if (days.includes(value)) return;
    const nextDays = [...new Set([...days, value])].sort();
    const index = nextDays.indexOf(value);
    const offset = Math.max(0, Math.min(Math.max(0, index - 3), nextDays.length - 8));
    days = nextDays.slice(offset, offset + 8);
  }

  function eventsForDay(date) {
    return (eventsData?.events || []).filter((event) => event.date === date);
  }

  function lessonsForDay(date) {
    const selected = dateFromKey(date);
    if (!selected || !timetableData) return [];
    const weekday = (selected.getDay() + 6) % 7;
    return (timetableData.cells || [])
      .filter((cell) => cell.weekday === weekday && cell.subject_id != null)
      .sort((left, right) => left.hpos - right.hpos);
  }

  function createEventCard(event, compact = false) {
    const card = node("article", `${compact ? "task" : "ev"}${event.done ? " done" : ""}`);
    card.style.setProperty("--c", subjectColor(event.subject_id));
    const body = node("div", compact ? "" : "ev-body");
    if (!compact) {
      const top = node("div", "ev-top");
      top.append(
        node("h4", "", event.subject || subjectName(event.subject_id)),
        node("small", "", event.hpos ? `${event.hpos}ª ora` : ""),
      );
      const tag = node("span", `tag ${eventKind(event)}`, KIND_LABEL[eventKind(event)] || "Evento");
      top.append(tag);
      body.append(top, node("p", "", event.text || "Nessun dettaglio"));
      card.append(body);
    } else {
      const text = node("div", "");
      const tag = node("span", `tag ${eventKind(event)}`, KIND_LABEL[eventKind(event)] || "Evento");
      text.append(tag, node("p", "", event.text || "Nessun dettaglio"));
      body.append(text);
      card.append(body);
    }

    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${event.subject || "Evento"}: ${event.text || KIND_LABEL[eventKind(event)] || "Apri dettagli"}`);
    const open = () => EventSheet.showEvent(event);
    card.addEventListener("click", (click) => {
      if (click.target.closest("button")) return;
      open();
    });
    card.addEventListener("keydown", (key) => {
      if (key.target === card && (key.key === "Enter" || key.key === " ")) {
        key.preventDefault();
        open();
      }
    });

    if (isHomework(event)) {
      const check = button("", "check", async () => {
        const result = await Home.toggleDone(event);
        if (result !== null) {
          event.done = result;
          card.classList.toggle("done", result);
          check.setAttribute("aria-pressed", String(result));
          check.setAttribute("aria-label", result ? "Segna come da fare" : "Segna come svolto");
        } else {
          setStatus("Impossibile salvare. Riprova.");
        }
      }, event.done ? "Segna come da fare" : "Segna come svolto");
      check.innerHTML = SVG_CHECK;
      check.setAttribute("aria-pressed", String(!!event.done));
      card.append(check);
    }
    return card;
  }

  function renderDay(date) {
    const page = node("div", "page");
    page.setAttribute("aria-label", `${dayLabel(date)} ${date}`);
    const events = eventsForDay(date);
    const lessons = lessonsForDay(date);
    const head = node("div", "day-head");
    const heading = node("div", "");
    const relative = date === eventsData.today ? "Oggi"
      : date === shiftDateKey(eventsData.today, 1) ? "Domani"
        : dayLabel(date);
    const dateText = dayLabel(date, { weekday: "long", day: "numeric", month: "long" });
    heading.append(node("h2", "", relative), node("p", "", dateText));
    const testCount = events.filter((event) => !isHomework(event)).length;
    head.append(heading, node("span", "status",
      testCount ? `${testCount} ${testCount === 1 ? "verifica" : "verifiche"}`
        : events.length ? `${events.length} ${events.length === 1 ? "impegno" : "impegni"}` : "Nessun impegno"));
    page.append(head);

    const lessonList = node("div", "lessons");
    const attached = new Set();
    for (const lesson of lessons) {
      const card = node("article", "lesson");
      card.style.setProperty("--c", subjectColor(lesson.subject_id));
      const label = lesson.label || lesson.subject || subjectName(lesson.subject_id);
      const info = node("div", "lesson-body");
      const title = node("div", "lesson-title");
      title.append(node("h3", "", label));
      info.append(title);
      const meta = node("div", "meta", `${lesson.hpos}ª ora`);
      card.append(node("div", "num", `${lesson.hpos}°`), info);
      info.append(meta);
      const matches = events.filter((event) => event.subject_id === lesson.subject_id
        && !attached.has(event.id));
      for (const event of matches) {
        attached.add(event.id);
        info.append(createEventCard(event, true));
      }
      lessonList.append(card);
    }
    for (const event of events) {
      if (!attached.has(event.id)) lessonList.append(createEventCard(event, true));
    }
    if (!lessonList.childElementCount) {
      lessonList.append(node("p", "empty",
        timetableData ? "Nessuna lezione o evento in questo giorno." : "Configura il tuo orario per vedere le lezioni."));
    }
    page.append(lessonList);
    return page;
  }

  function shiftDateKey(key, amount) {
    const date = dateFromKey(key);
    if (!date) return "";
    date.setDate(date.getDate() + amount);
    return dateKey(date);
  }

  function renderDayChips() {
    const chips = document.getElementById("chips");
    chips.replaceChildren();
    days.forEach((date, index) => {
      const selected = date === selectedDate;
      const dateObject = dateFromKey(date);
      const events = eventsForDay(date);
      const chip = button("", "chip", () => {
        document.getElementById("pager").scrollTo({
          left: document.getElementById("pager").clientWidth * index,
          behavior: "smooth",
        });
      }, `${dayLabel(date)} ${dateObject?.getDate() || ""}`);
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", String(selected));
      chip.append(
        node("small", "", date === eventsData.today ? "Oggi" : dayLabel(date, { weekday: "short" })),
        node("b", "", String(dateObject?.getDate() || "")),
      );
      const dots = node("span", "dots");
      events.slice(0, 3).forEach((event) => {
        const dot = node("i", event.kind ? "t" : "");
        dots.append(dot);
      });
      chip.append(dots);
      chips.append(chip);
    });
    const active = chips.querySelector(".chip[aria-selected='true']");
    if (active) chips.scrollTo({ left: active.offsetLeft - chips.clientWidth / 2 + active.clientWidth / 2, behavior: "smooth" });
  }

  function renderOrario() {
    renderDayChips();
    const pager = document.getElementById("pager");
    pager.replaceChildren(...days.map((date) => renderDay(date)));
    const index = Math.max(0, days.indexOf(selectedDate));
    pager.scrollLeft = index * pager.clientWidth;
  }

  function renderFilters() {
    const filters = document.getElementById("filters");
    filters.replaceChildren();
    FILTERS.forEach((filter) => {
      const count = filter === "tutti" ? (eventsData.events || []).length
        : (eventsData.events || []).filter((event) => eventKind(event) === filter).length;
      const item = button("", "", () => {
        eventFilter = filter;
        renderFilters();
        renderGroups();
      });
      item.setAttribute("aria-pressed", String(eventFilter === filter));
      item.append(
        document.createTextNode(filter === "tutti" ? "Tutti" : KIND_LABEL[filter]),
        node("span", "", String(count)),
      );
      filters.append(item);
    });
  }

  function renderCalendar() {
    const cal = document.getElementById("cal");
    const current = calendarDate || currentDate();
    const year = current.getFullYear(), month = current.getMonth();
    const first = new Date(year, month, 1);
    const count = new Date(year, month + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const todayRow = Math.floor((offset + currentDate().getDate() - 1) / 7);
    const dates = new Map();
    (eventsData.events || []).forEach((event) => {
      dates.set(event.date, [...(dates.get(event.date) || []), event]);
    });
    const tests = (eventsData.events || []).filter((event) => !isHomework(event)
      && event.date >= eventsData.today).length;

    cal.classList.toggle("open", calendarOpen);
    const header = node("div", "cal-head");
    const title = node("h3", "");
    title.append(document.createTextNode(new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(first)));
    title.append(node("small", "", `${tests} ${tests === 1 ? "verifica o interrogazione" : "verifiche e interrogazioni"}`));
    const toggle = button("", "cal-toggle", () => {
      calendarOpen = !calendarOpen;
      renderCalendar();
    });
    toggle.setAttribute("aria-expanded", String(calendarOpen));
    toggle.append(
      document.createTextNode(calendarOpen ? "Settimana" : "Mese"),
      document.createRange().createContextualFragment('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'),
    );
    header.append(title, toggle);

    const grid = node("div", "cal-grid");
    ["L", "M", "M", "G", "V", "S", "D"].forEach((day) => grid.append(node("div", "wd", day)));
    for (let index = 0; index < offset; index++) grid.append(node("div", "cal-day"));
    for (let day = 1; day <= count; day++) {
      const key = dateKey(new Date(year, month, day));
      const dayEvents = dates.get(key) || [];
      const row = Math.floor((offset + day - 1) / 7);
      const classes = ["cal-day"];
      if (key < eventsData.today) classes.push("past");
      if (key === eventsData.today) classes.push("today");
      if (dayEvents.length) classes.push("has");
      if (row !== todayRow) classes.push("out-week");
      const cell = dayEvents.length
        ? button("", classes.join(" "), () => goToEventDay(key), `${day} ${dayLabel(key, { month: "long" })}, ${dayEvents.length} eventi`)
        : node("div", classes.join(" "));
      cell.append(node("span", "", String(day)));
      const dots = node("span", "d");
      dayEvents.slice(0, 3).forEach((event) => dots.append(node("i", event.kind ? "t" : "")));
      cell.append(dots);
      grid.append(cell);
    }
    cal.replaceChildren(header, grid);
  }

  function renderGroups() {
    const groups = document.getElementById("groups");
    const events = (eventsData.events || []).filter((event) => event.date >= eventsData.today
      && (eventFilter === "tutti" || eventKind(event) === eventFilter));
    const byDate = new Map();
    events.forEach((event) => byDate.set(event.date, [...(byDate.get(event.date) || []), event]));
    groups.replaceChildren();
    [...byDate.keys()].sort().forEach((date) => {
      const entries = byDate.get(date).sort((left, right) => (left.hpos || 99) - (right.hpos || 99));
      const section = node("section", "group");
      section.id = `g-${date}`;
      const head = node("div", "group-head");
      const relative = date === eventsData.today ? "Oggi"
        : date === shiftDateKey(eventsData.today, 1) ? "Domani"
          : dayLabel(date);
      head.append(node("h3", "", relative), node("span", "", dayLabel(date, { day: "numeric", month: "long" })));
      const assessments = entries.filter((event) => !isHomework(event)).length;
      if (assessments) head.append(node("em", "", `${assessments} ${assessments === 1 ? "verifica" : "verifiche"}`));
      section.append(head);
      entries.forEach((event) => section.append(createEventCard(event)));
      groups.append(section);
    });
    if (!groups.childElementCount) groups.append(node("div", "empty", "Nessun evento in arrivo"));
  }

  function goToEventDay(date) {
    if (eventFilter !== "tutti" && !eventsForDay(date).some((event) => eventKind(event) === eventFilter)) {
      eventFilter = "tutti";
      renderFilters();
      renderGroups();
    }
    const target = document.getElementById(`g-${date}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderHome() {
    if (!eventsData) return;
    renderOrario();
    renderFilters();
    renderCalendar();
    renderGroups();
  }

  async function loadGrades() {
    if (gradesLoad) return gradesLoad;
    gradesLoad = loadJson("/api/grades").then((data) => {
      gradesData = data;
      renderGrades();
      setStatus("");
    }).catch((error) => {
      setStatus(error.message || "Impossibile caricare i voti.");
      const root = document.getElementById("vOvScroll");
      const message = node("div", "vempty");
      message.append(node("b", "", "Impossibile caricare i voti"),
        button("Riprova", "calc-btn", () => loadGrades().catch(() => {})));
      root.replaceChildren(message);
      throw error;
    }).finally(() => { gradesLoad = null; });
    return gradesLoad;
  }

  function periodItems() {
    const periods = gradesData?.periods || [];
    return [
      { key: PERIOD_ALL, label: "Anno", fullLabel: "Tutto l’anno", stats: gradesData?.overall },
      ...periods.map((period) => ({
        key: String(period.periodPos),
        label: period.periodLabel,
        fullLabel: period.periodLabel,
        stats: period,
      })),
    ];
  }

  function currentGradeStats() {
    return periodItems().find((item) => item.key === selectedPeriod)?.stats || gradesData?.overall;
  }

  function formatGrade(value) {
    if (value == null || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(number) : String(value);
  }

  function dateLabel(value) {
    const date = dateFromKey(value);
    return date ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "";
  }

  function makeRing(value) {
    const ring = node("div", "ring");
    const color = averageColor(value);
    const progress = value == null ? 0 : Math.max(0, Math.min(10, Number(value)));
    ring.style.setProperty("--g", color);
    ring.style.setProperty("--off", String(251.33 * (1 - progress / 10)));
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", `Media ${formatGrade(value)}`);
    ring.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="t" cx="50" cy="50" r="40"></circle><circle class="v" cx="50" cy="50" r="40"></circle></svg>';
    ring.append(node("strong", "", formatGrade(value)));
    return ring;
  }

  function gradePeriodTabs(mini = false) {
    const items = periodItems();
    const tabs = node("div", `ptabs${mini ? " mini" : ""}`);
    const index = Math.max(0, items.findIndex((item) => item.key === selectedPeriod));
    tabs.dataset.p = String(Math.min(2, index));
    tabs.style.setProperty("--from", String(index));
    tabs.style.gridTemplateColumns = `repeat(${items.length}, minmax(0, 1fr))`;
    const pill = node("span", "pill");
    pill.setAttribute("aria-hidden", "true");
    pill.style.width = `calc((100% - ${mini ? 6 : 8}px) / ${items.length})`;
    tabs.append(pill);
    items.forEach((item, itemIndex) => {
      const tab = button(mini ? `${itemIndex ? item.label.match(/\d+/)?.[0] || item.label : "Anno"}` : item.fullLabel,
        "", () => {
          selectedPeriod = item.key;
          if (!(currentGradeStats()?.subjects || []).some((subject) => (
            String(subject.subjectId) === String(selectedSubjectId)
          ))) selectedSubjectId = null;
          renderGrades();
        });
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(item.key === selectedPeriod));
      tabs.append(tab);
    });
    return tabs;
  }

  function gradeSubjectName(subject) {
    return subject.subjectName || subject.subjectDesc || "Materia";
  }

  function renderGradeOverview(root, stats) {
    const subjects = stats?.subjects || [];
    const summary = node("div", "sum");
    summary.append(makeRing(stats?.average));
    const body = node("div", "sum-body");
    body.append(node("h2", "", "Media generale"));
    const grades = subjects.flatMap((subject) => subject.grades || []);
    const dates = grades.map((grade) => grade.evtDate).filter(Boolean).sort();
    body.append(node("p", "", dates.length ? `Dal ${dateLabel(dates[0])} al ${dateLabel(dates.at(-1))}` : "Nessun voto disponibile"));
    const statsRow = node("div", "stats");
    statsRow.append(
      node("span", "stat", `${grades.length} voti`),
      node("span", "stat", `${subjects.length} materie`),
    );
    body.append(statsRow);
    summary.append(body);
    root.append(gradePeriodTabs(), summary);

    const low = subjects.filter((subject) => Number(subject.average) < 6).length;
    const heading = node("div", "sec-head");
    heading.append(node("h3", "", "Materie"));
    heading.append(low ? node("em", "", `${low} ${low === 1 ? "insufficienza" : "insufficienze"}`)
      : node("span", "", "Tocca per i dettagli"));
    root.append(heading);
    if (!subjects.length) {
      const empty = node("div", "vempty");
      empty.append(node("b", "", "Nessun voto in questo periodo"),
        document.createTextNode("Appena saranno inseriti nuovi voti, li vedrai qui."));
      root.append(empty);
      return;
    }
    subjects.forEach((subject, index) => {
      const average = subject.average == null ? null : Number(subject.average);
      const latest = [...(subject.grades || [])].sort((a, b) => String(b.evtDate || "").localeCompare(String(a.evtDate || "")))[0];
      const row = button("", "srow", () => {
        selectedSubjectId = subject.subjectId;
        renderGrades();
      }, `${gradeSubjectName(subject)}, media ${formatGrade(average)}`);
      row.style.setProperty("--c", averageColor(average));
      row.style.setProperty("--g", averageColor(average));
      row.style.setProperty("--i", String(index));
      const initials = gradeSubjectName(subject).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      row.append(node("span", "num", initials));
      const rowBody = node("span", "srow-body");
      rowBody.append(
        node("span", "srow-name", gradeSubjectName(subject)),
        node("span", "srow-meta", `${(subject.grades || []).length} voti · ultimo ${formatGrade(latest?.displayValue ?? latest?.decimalValue)}`),
      );
      const bar = node("span", "bar");
      const fill = node("i", "");
      fill.style.setProperty("--p", String(Math.max(0, Math.min(100, Number(average || 0) * 10))));
      bar.append(fill);
      rowBody.append(bar);
      row.append(rowBody, node("span", "srow-avg", formatGrade(average)));
      row.append(document.createRange().createContextualFragment('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>'));
      root.append(row);
    });
  }

  function openGrade(grade) {
    BetterViva.navigateTo("grades");
    Grades.open().then(() => Grades.openGradeByIdentity(null, grade)).catch((error) => {
      console.error("Impossibile aprire il dettaglio del voto.", error);
      setStatus("Impossibile aprire questo voto.");
    });
  }

  function renderGradeDetail(root, subject) {
    const summary = node("div", "hero");
    summary.style.setProperty("--c", subjectColor(subject.subjectId));
    summary.append(makeRing(subject.average));
    const body = node("div", "hero-body");
    body.append(node("h2", "", gradeSubjectName(subject)));
    body.append(node("p", "", subject.teacherName || ""));
    body.append(node("p", "", `${(subject.grades || []).length} ${(subject.grades || []).length === 1 ? "voto" : "voti"}`));
    body.append(button("Calcola voto", "calc-btn", async () => {
      try {
        const opened = await Grades.openCalculatorForSubject(subject.subjectId,
          selectedPeriod === PERIOD_ALL ? null : Number(selectedPeriod));
        if (!opened) setStatus("Impossibile calcolare la media di questa materia.");
      } catch (error) {
        setStatus(error.message || "Impossibile aprire il calcolo del voto.");
      }
    }));
    summary.append(body);
    root.append(summary);

    const sorted = [...(subject.grades || [])].sort((left, right) => (
      String(right.evtDate || "").localeCompare(String(left.evtDate || ""))
      || Number(right.displaPos || 0) - Number(left.displaPos || 0)
    ));
    if (sorted.length > 1) {
      const trend = node("div", "trend-card");
      trend.append(node("h3", "", "ANDAMENTO"));
      const graph = node("div", "trend");
      [...sorted].reverse().forEach((grade) => {
        const item = node("div", "");
        item.style.setProperty("--g", averageColor(grade.decimalValue));
        const bar = node("i", "");
        bar.style.setProperty("--r", String(Math.max(0, Number(grade.decimalValue || 0) / 10)));
        item.append(bar, node("span", "", formatGrade(grade.displayValue ?? grade.decimalValue)));
        graph.append(item);
      });
      trend.append(graph);
      root.append(trend);
    }
    const heading = node("div", "list-head");
    heading.append(node("h3", "", "Voti"), gradePeriodTabs(true));
    root.append(heading);
    if (!sorted.length) {
      const empty = node("div", "vempty");
      empty.append(node("b", "", "Nessun voto"),
        document.createTextNode(`Non ci sono ancora voti di ${gradeSubjectName(subject)} in questo periodo.`));
      root.append(empty);
      return;
    }
    sorted.forEach((grade, index) => {
      const row = button("", "grow", () => openGrade(grade), `${formatGrade(grade.displayValue ?? grade.decimalValue)} ${grade.componentDesc || ""}`);
      row.style.setProperty("--g", averageColor(grade.decimalValue));
      row.style.setProperty("--i", String(index));
      row.append(node("span", "gbadge", formatGrade(grade.displayValue ?? grade.decimalValue)));
      const detail = node("span", "grow-body");
      detail.append(node("b", "", grade.notesForFamily || grade.componentDesc || "Voto"));
      const meta = node("small", "");
      if (grade.componentDesc) meta.append(node("span", `tag ${String(grade.componentDesc).toLowerCase()}`, grade.componentDesc));
      meta.append(document.createTextNode(dateLabel(grade.evtDate)));
      detail.append(meta);
      row.append(detail);
      root.append(row);
    });
  }

  function renderGrades() {
    if (!gradesData) return;
    const root = document.getElementById("vOvScroll");
    const overview = document.getElementById("vOverview");
    const detail = document.getElementById("vDetail");
    const subject = (currentGradeStats()?.subjects || []).find((item) => (
      String(item.subjectId) === String(selectedSubjectId)
    ));
    if (selectedSubjectId != null && subject) {
      overview.hidden = true;
      detail.hidden = false;
      const strip = document.getElementById("strip");
      strip.replaceChildren(button("", "back", () => {
        selectedSubjectId = null;
        renderGrades();
      }, "Tutte le materie"));
      strip.lastChild.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>';
      const subjects = currentGradeStats()?.subjects || [];
      subjects.forEach((item, index) => {
        const active = String(item.subjectId) === String(selectedSubjectId);
        const tab = button("", "stab", () => {
          document.getElementById("vPager").scrollTo({
            left: document.getElementById("vPager").clientWidth * index,
            behavior: "smooth",
          });
        });
        tab.style.setProperty("--c", subjectColor(item.subjectId));
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(active));
        tab.dataset.subjectIndex = String(index);
        if (!active) tab.append(node("i", ""));
        tab.append(document.createTextNode(gradeSubjectName(item)));
        strip.append(tab);
      });
      const pager = document.getElementById("vPager");
      renderingGradePages = true;
      pager.replaceChildren(...subjects.map((item) => {
        const page = node("div", "page");
        page.setAttribute("role", "tabpanel");
        page.setAttribute("aria-label", gradeSubjectName(item));
        renderGradeDetail(page, item);
        return page;
      }));
      pager.scrollLeft = pager.clientWidth * Math.max(0,
        subjects.findIndex((item) => String(item.subjectId) === String(selectedSubjectId)));
      requestAnimationFrame(() => { renderingGradePages = false; });
      return;
    }
    selectedSubjectId = null;
    overview.hidden = false;
    detail.hidden = true;
    root.replaceChildren();
    renderGradeOverview(root, currentGradeStats());
  }

  function showConceptSheet(title, content) {
    const heading = node("h3", "", title);
    Sheet.open(heading, content);
  }

  function closeSheetThen(action) {
    if (!Sheet.close()) {
      action();
      return;
    }
    window.addEventListener("bv-sheet-close", action, { once: true });
  }

  function openFeedback() {
    const form = node("form", "concept-feedback");
    const mood = node("div", "mood");
    mood.setAttribute("role", "group");
    mood.setAttribute("aria-label", "Valutazione");
    ["Male", "Così così", "Bene", "Ottimo"].forEach((value, index) => {
      const option = button(value, "", () => {
        mood.querySelectorAll("button").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === option));
        });
      });
      option.setAttribute("aria-pressed", String(index === 2));
      mood.append(option);
    });
    const label = node("label", "", "Cosa possiamo migliorare?");
    label.htmlFor = "concept-feedback-message";
    const textarea = node("textarea", "");
    textarea.id = "concept-feedback-message";
    textarea.maxLength = 2000;
    textarea.required = true;
    textarea.placeholder = "Scrivi qui il tuo suggerimento…";
    label.append(textarea);
    const status = node("p", "feedback-status", "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const send = button("Invia", "primary", async () => {
      if (!form.reportValidity() || send.disabled) return;
      send.disabled = true;
      status.textContent = "Invio in corso…";
      const rating = mood.querySelector('[aria-pressed="true"]')?.textContent || "Bene";
      const message = `[Valutazione: ${rating}]\n${textarea.value.trim()}`;
      try {
        await BetterViva.submitFeedback(message);
        status.classList.add("success");
        status.textContent = "Grazie! Il tuo feedback è stato inviato.";
        textarea.value = "";
      } catch (error) {
        status.textContent = error.message || "Impossibile inviare il feedback. Riprova.";
      } finally {
        send.disabled = false;
      }
    });
    form.append(mood, label, status, send);
    form.addEventListener("submit", (event) => event.preventDefault());
    showConceptSheet("Invia un feedback", form);
    textarea.focus();
  }

  function openMenu() {
    const menu = node("nav", "menu-grid");
    menu.setAttribute("aria-label", "Menu principale");
    const entries = [
      ...[
        ["home", "Home", "Orario ed eventi", "var(--red)", '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>'],
        ["voti", "Voti", "Medie e calcolo", "var(--green)", '<path d="M4 19V5m0 14h16M8 16v-4m4 4V8m4 8V6"/>'],
        ["bacheca", "Bacheca", "Circolari e avvisi", "var(--blue)", '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'],
        ["note", "Note", "Annotazioni", "var(--amber)", '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h6M8 13h8M8 17h5"/>'],
        ["assenze", "Assenze", "Ritardi e giustifiche", "var(--pink)", '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M10 14l4 4M14 14l-4 4"/>'],
        ["argomenti", "Argomenti", "Lezioni svolte", "var(--cyan)", '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>'],
        ["colloqui", "Colloqui", "Prenota un incontro", "var(--purple)", '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'],
        ["materiale", "Materiale", "File dei docenti", "var(--orange)", '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>'],
      ].map(([key, title, description, color, icon]) => ({ key, title, description, color, icon })),
    ];
    const account = node("div", "menu-user");
    account.append(node("div", "avatar", initials(profileName())), node("div", ""));
    account.lastChild.append(node("b", "", profileName()), node("small", "", "BetterViva"));
    menu.append(account);
    entries.forEach((entry) => {
      const item = button("", "tile", () => {
        closeSheetThen(() => openSection(entry.key));
      });
      item.style.setProperty("--c", entry.color);
      const icon = node("span", "ic");
      icon.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${entry.icon}</svg>`;
      const labels = node("span", "");
      labels.append(node("b", "", entry.title), node("small", "", entry.description));
      item.append(icon, labels);
      if (entry.key === "bacheca") {
        const unread = Noticeboard.unreadCount();
        if (unread) item.append(node("span", "count", String(unread)));
      }
      menu.append(item);
    });
    showConceptSheet("Menu", menu);
  }

  function initials(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part[0]).join("").toUpperCase() || "BV";
  }

  function profileName() {
    return profile?.name || profile?.first_name || "BetterViva";
  }

  function openProfile() {
    const box = node("div", "profile-sheet");
    box.append(node("div", "avatar", initials(profileName())), node("h3", "", profileName()));
    box.append(button("Impostazioni", "primary", () => {
      closeSheetThen(() => Settings.open(() => BetterViva.showHome()));
    }));
    box.append(button("Esci da questo dispositivo", "secondary", async () => {
      if (!confirm("Uscire da questo dispositivo? Le credenziali salvate verranno cancellate.")) return;
      closeSheetThen(() => BetterViva.logout());
    }));
    showConceptSheet("Profilo", box);
  }

  function showPlaceholder(key) {
    const menu = [
      ["note", "Note", "Annotazioni"], ["assenze", "Assenze", "Ritardi e giustifiche"],
      ["argomenti", "Argomenti", "Lezioni svolte"], ["colloqui", "Colloqui", "Prenota un incontro"],
      ["materiale", "Materiale", "File dei docenti"],
    ].find(([item]) => item === key);
    if (!menu) return;
    activePlaceholder = key;
    app.dataset.screen = key;
    document.getElementById("view-home").hidden = true;
    document.getElementById("view-grades").hidden = true;
    document.getElementById("view-noticeboard").hidden = true;
    document.getElementById("view-settings").hidden = true;
    document.getElementById("view-setup").hidden = true;
    document.getElementById("view-login").hidden = true;
    const view = document.getElementById("view-stub");
    view.hidden = false;
    const content = node("div", "stub");
    const icon = node("div", "ic");
    icon.style.setProperty("--c", "var(--muted)");
    icon.append(document.createRange().createContextualFragment('<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18"/></svg>'));
    content.append(icon, node("h2", "", menu[1]));
    content.append(node("p", "", `${menu[2]}.\nQuesta sezione arriverà presto.`));
    view.replaceChildren(content);
  }

  function openSection(key) {
    activePlaceholder = null;
    if (key === "home") {
      BetterViva.showHome();
      return;
    }
    if (key === "voti") {
      BetterViva.navigateTo("grades");
      selectedSubjectId = null;
      Grades.open().then(loadGrades).catch(() => {});
      return;
    }
    if (key === "bacheca") {
      BetterViva.navigateTo("noticeboard");
      Noticeboard.open();
      return;
    }
    showPlaceholder(key);
  }

  function openHomeMode(view) {
    const tab = app.querySelector(`[data-view="${view}"]`);
    if (!tab) return;
    app.querySelectorAll(".seg button[data-view]").forEach((item) => {
      item.setAttribute("aria-selected", String(item === tab));
    });
    app.querySelector("#seg").dataset.view = view;
    document.getElementById("view-orario").hidden = view !== "orario";
    document.getElementById("view-eventi").hidden = view !== "eventi";
  }

  document.getElementById("pager").addEventListener("scroll", () => {
    const pager = document.getElementById("pager");
    const index = Math.max(0, Math.min(days.length - 1, Math.round(pager.scrollLeft / (pager.clientWidth || 1))));
    const date = days[index];
    if (!date || date === selectedDate) return;
    selectedDate = date;
    document.querySelectorAll("#chips .chip").forEach((chip, chipIndex) => {
      chip.setAttribute("aria-selected", String(chipIndex === index));
    });
    const active = document.querySelector("#chips .chip[aria-selected='true']");
    if (active) document.getElementById("chips").scrollTo({
      left: active.offsetLeft - document.getElementById("chips").clientWidth / 2 + active.clientWidth / 2,
      behavior: "smooth",
    });
  }, { passive: true });

  document.getElementById("vPager").addEventListener("scroll", () => {
    if (renderingGradePages || selectedSubjectId == null) return;
    const pager = document.getElementById("vPager");
    const subjects = currentGradeStats()?.subjects || [];
    const index = Math.max(0, Math.min(subjects.length - 1,
      Math.round(pager.scrollLeft / (pager.clientWidth || 1))));
    const subject = subjects[index];
    if (!subject || String(subject.subjectId) === String(selectedSubjectId)) return;
    selectedSubjectId = subject.subjectId;
    const strip = document.getElementById("strip");
    strip.querySelectorAll(".stab").forEach((tab, tabIndex) => {
      const active = tabIndex === index;
      tab.setAttribute("aria-selected", String(active));
      const marker = tab.querySelector("i");
      if (active) marker?.remove();
      else if (!marker) tab.insertAdjacentHTML("afterbegin", "<i></i>");
      if (active) {
        const label = gradeSubjectName(subject);
        if (tab.textContent !== label) {
          tab.replaceChildren(node("i", ""), document.createTextNode(label));
          tab.querySelector("i")?.remove();
        }
      } else {
        tab.replaceChildren(node("i", ""), document.createTextNode(gradeSubjectName(subjects[tabIndex])));
      }
    });
    const activeTab = strip.querySelector(`.stab[data-subject-index="${index}"]`);
    if (activeTab) strip.scrollTo({
      left: activeTab.offsetLeft - strip.clientWidth / 2 + activeTab.clientWidth / 2,
      behavior: "smooth",
    });
  }, { passive: true });

  function onAppView(view) {
    activePlaceholder = null;
    document.getElementById("view-stub").hidden = true;
    if (view === "home") {
      activePlaceholder = null;
      app.dataset.screen = "home";
      document.getElementById("view-stub").hidden = true;
      loadHome().catch(() => {});
      return;
    }
    app.dataset.screen = view === "grades" ? "voti" : view === "noticeboard" ? "bacheca" : view;
    if (view === "grades") loadGrades().catch(() => {});
  }

  function updateProfile(nextProfile) {
    profile = nextProfile;
    const avatar = document.getElementById("avatar");
    if (avatar) {
      avatar.textContent = initials(profileName());
      avatar.setAttribute("aria-label", `Profilo di ${profileName()}`);
    }
  }

  function onApiUpdate({ detail }) {
    if (detail.path === "/api/events") {
      eventsData = detail.data;
      if (!calendarDate) calendarDate = dateFromKey(eventsData.today);
      days = schoolDays(eventsData, timetableData, new Set((eventsData.events || []).map((event) => event.date)));
      if (!days.includes(selectedDate)) selectedDate = days[0] || eventsData.today;
      renderHome();
    } else if (detail.path === "/api/timetable") {
      timetableData = detail.data;
      if (eventsData) {
        days = schoolDays(eventsData, timetableData, new Set((eventsData.events || []).map((event) => event.date)));
        if (!days.includes(selectedDate)) selectedDate = days[0] || eventsData.today;
        renderHome();
      }
    } else if (detail.path === "/api/grades") {
      gradesData = detail.data;
      renderGrades();
    } else if (detail.path === "/api/me") {
      updateProfile(detail.data);
    }
  }

  app.querySelector("#seg").addEventListener("click", (event) => {
    const tab = event.target.closest("button[data-view]");
    if (tab) openHomeMode(tab.dataset.view);
  });
  app.querySelector('[data-sheet="feedback"]').addEventListener("click", openFeedback);
  app.querySelector(".avatar").addEventListener("click", openProfile);
  app.querySelector('[data-sheet="menu"]').addEventListener("click", openMenu);
  document.getElementById("view-eventi").addEventListener("click", (event) => {
    const filter = event.target.closest("[data-f]");
    if (filter) {
      eventFilter = filter.dataset.f;
      renderFilters();
      renderGroups();
      return;
    }
    if (event.target.closest("#calToggle")) {
      calendarOpen = !calendarOpen;
      renderCalendar();
      return;
    }
    const day = event.target.closest("[data-goto]");
    if (day) goToEventDay(day.dataset.goto);
  });

  window.addEventListener("bv-app-view", ({ detail }) => onAppView(detail.view));
  window.addEventListener("bv-profile-ready", ({ detail }) => updateProfile(detail));
  window.addEventListener("bv-api-cache-update", onApiUpdate);
  window.addEventListener("bv-api-cache-error", ({ detail }) => {
    if (detail.path === "/api/events" || detail.path === "/api/grades") {
      setStatus("Dati salvati mostrati; impossibile aggiornarli dal server.");
    }
  });
  window.addEventListener("bv-notification-open", ({ detail }) => {
    if (detail?.view !== "home" || !detail.date) return;
    pendingNotificationDate = detail.date;
    if (eventsData) {
      includeDate(detail.date);
      selectedDate = detail.date;
      pendingNotificationDate = null;
      renderHome();
      openHomeMode("orario");
      document.getElementById("pager").scrollTo({
        left: document.getElementById("pager").clientWidth * days.indexOf(detail.date),
        behavior: "smooth",
      });
    }
  });

  if (BetterViva.profile) updateProfile(BetterViva.profile);
  const currentView = document.documentElement.dataset.bvView;
  if (currentView) onAppView(currentView);
})();
