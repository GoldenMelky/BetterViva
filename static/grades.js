"use strict";

const Grades = (() => {
  const $ = (id) => document.getElementById(id);
  const root = () => $("grades-body");
  let data = null;
  let periodPos = null;
  let subjectId = null;
  let loading = false;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, cls, onClick) => {
    const node = el("button", cls, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };
  const colorForAverage = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return "blue";
    if (Number(value) >= 6) return "green";
    if (Number(value) >= 5) return "orange";
    return "red";
  };
  const colorForGrade = (grade) => (
    grade.canceled || grade.noAverage || grade.decimalValue == null
      ? "blue"
      : colorForAverage(grade.decimalValue)
  );
  const formattedAverage = (value) => value == null ? "—" : Number(value).toFixed(2);
  const formattedDate = (value) => {
    if (typeof value !== "string") return "";
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
  };

  function periods() {
    return data?.periods || [];
  }

  function selectedStats() {
    return periodPos == null
      ? data?.overall
      : periods().find((period) => period.periodPos === periodPos) || data?.overall;
  }

  function centerPeriodTab(tabs, behavior = "smooth") {
    const active = tabs.querySelector(".grade-period-tab.active");
    if (!active) return;
    const [before, after] = tabs.querySelectorAll(".grade-period-spacer");
    const style = getComputedStyle(tabs);
    const innerWidth = tabs.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    before.style.flexBasis = `${Math.max(0, (innerWidth - active.clientWidth) / 2)}px`;
    after.style.flexBasis = before.style.flexBasis;
    tabs.scrollTo({
      left: active.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft
        - (tabs.clientWidth - active.clientWidth) / 2,
      behavior,
    });
  }

  function renderTabs() {
    const tabs = el("div", "grade-period-tabs");
    const items = [{ periodPos: null, periodLabel: "Tutto l’anno" },
      ...(periods().length > 1 ? periods() : [])];
    const before = el("span", "grade-period-spacer");
    const after = el("span", "grade-period-spacer");
    before.setAttribute("aria-hidden", "true");
    after.setAttribute("aria-hidden", "true");
    tabs.append(before);
    for (const item of items) {
      const tab = button(item.periodLabel, "grade-period-tab", () => {
        periodPos = item.periodPos;
        subjectId = null;
        render();
      });
      tab.classList.toggle("active", item.periodPos === periodPos);
      tab.setAttribute("aria-pressed", String(item.periodPos === periodPos));
      tabs.append(tab);
    }
    tabs.append(after);
    requestAnimationFrame(() => centerPeriodTab(tabs));
    return tabs;
  }

  function renderRing(value) {
    const ring = el("div", `grade-ring ${colorForAverage(value)}`);
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", `Media ${formattedAverage(value)}`);
    const progress = value == null ? 0 : Math.max(0, Math.min(100, Number(value) * 10));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("grade-ring-svg");
    const circumference = 2 * Math.PI * 43;
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", "43");
    track.classList.add("grade-ring-track");
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fill.setAttribute("cx", "50");
    fill.setAttribute("cy", "50");
    fill.setAttribute("r", "43");
    fill.setAttribute("stroke-dasharray", String(circumference));
    fill.setAttribute("stroke-dashoffset", String(circumference * (1 - progress / 100)));
    fill.classList.add("grade-ring-fill");
    svg.append(track, fill);
    ring.append(svg);
    ring.append(el("span", "", formattedAverage(value)));
    return ring;
  }

  function renderAverageBar(value) {
    const color = colorForAverage(value);
    const bar = el("span", `grade-average-bar ${color}`);
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `Media ${formattedAverage(value)}`);
    const fill = el("span", "grade-average-fill");
    const progress = value == null ? 0 : Math.max(0, Math.min(100, Number(value) * 10));
    fill.style.width = `${progress}%`;
    const label = formattedAverage(value);
    bar.append(fill, el("span", "grade-average-label", label));
    fill.append(el("span", "grade-average-label grade-average-label-filled", label));
    return bar;
  }

  function datesLabel(stats) {
    const grades = (stats?.subjects || []).flatMap((subject) => subject.grades);
    const dates = grades.map((grade) => grade.evtDate).filter((date) => typeof date === "string").sort();
    if (!dates.length) return "";
    return `Dal ${formattedDate(dates[0])} al ${formattedDate(dates.at(-1))}`;
  }

  function renderOverview(stats) {
    const summary = el("section", "grade-summary");
    summary.append(renderRing(stats?.average));
    const text = el("div", "grade-summary-text");
    text.append(el("h1", "", "Media generale"));
    text.append(el("p", "", datesLabel(stats)));
    summary.append(text);

    const list = el("div", "grade-subject-list");
    for (const subject of stats?.subjects || []) {
      const row = button("", "grade-subject-row", () => {
        history.pushState({ ...(history.state || {}), betterviva: true, view: "grades", gradeSubject: true }, "");
        subjectId = subject.subjectId;
        render();
      });
      row.append(renderAverageBar(subject.average));
      row.append(el("span", "grade-subject-name", subject.subjectName || subject.subjectDesc || "Materia"));
      row.append(el("span", "grade-subject-count", `${subject.grades.length} Voti`));
      list.append(row);
    }
    if (!list.childElementCount) list.append(el("p", "grade-empty", "Nessun voto per questo periodo."));
    root().replaceChildren(renderPeriodNav(), summary, list);
  }

  function renderPeriodNav(showBack = false) {
    const nav = el("div", "grade-period-nav");
    if (showBack) {
      const back = button("‹", "grade-period-back", () => {
        if (history.state?.gradeSubject) history.back();
        else handleBack();
      });
      back.setAttribute("aria-label", "Torna a tutte le materie");
      nav.append(back);
    }
    nav.append(renderTabs());
    return nav;
  }

  function openGrade(grade) {
    const value = el("span", `grade-value ${colorForGrade(grade)}`, grade.displayValue || "—");
    const component = grade.componentDesc || "";
    const date = formattedDate(grade.evtDate);
    const fallbackTitle = [date, component].filter(Boolean).join(" - ");
    const details = el("div", "grade-sheet-details");
    details.append(el("h2", "sheet-title", grade.subjectName || grade.subjectDesc || "Voto"));
    if (fallbackTitle) details.append(el("p", "sheet-meta", fallbackTitle));
    const heading = el("div", "grade-sheet-heading");
    heading.append(value, details);
    const nodes = [heading];
    if (grade.notesForFamily) nodes.push(el("p", "sheet-text", grade.notesForFamily));
    if (grade.teacherName) nodes.push(el("p", "sheet-meta", grade.teacherName));
    Sheet.open(...nodes);
  }

  function renderSubject(stats) {
    const subject = (stats?.subjects || []).find((item) => item.subjectId === subjectId);
    if (!subject) {
      subjectId = null;
      return renderOverview(stats);
    }
    const summary = el("section", "grade-summary grade-subject-summary");
    summary.append(renderRing(subject.average));
    const text = el("div", "grade-summary-text");
    text.append(el("h1", "", subject.subjectName || subject.subjectDesc || "Materia"));
    text.append(el("p", "", `${subject.grades.length} Voti`));
    summary.append(text);

    const list = el("div", "grade-list");
    const sortedGrades = [...subject.grades].sort((a, b) => {
      const byDate = String(b.evtDate || "").localeCompare(String(a.evtDate || ""));
      return byDate || Number(b.displaPos || 0) - Number(a.displaPos || 0);
    });
    for (const grade of sortedGrades) {
      const row = button("", `grade-row ${colorForGrade(grade)}`, () => openGrade(grade));
      row.append(el("span", `grade-value ${colorForGrade(grade)}`, grade.displayValue || "—"));
      const text = el("span", "grade-row-text");
      const fallbackTitle = [formattedDate(grade.evtDate), grade.componentDesc].filter(Boolean).join(" - ");
      text.append(el("span", "grade-row-note", grade.notesForFamily || fallbackTitle || "Voto"));
      const metadata = grade.notesForFamily
        ? fallbackTitle
        : grade.teacherName || "";
      if (metadata) text.append(el("span", "grade-row-meta", metadata));
      row.append(text);
      list.append(row);
    }
    root().replaceChildren(renderPeriodNav(true), summary, list);
  }

  function render() {
    if (!data) return;
    const stats = selectedStats();
    if (subjectId != null) return renderSubject(stats);
    renderOverview(stats);
  }

  async function load() {
    if (loading) return;
    loading = true;
    root().replaceChildren(el("p", "grade-loading", "Caricamento voti…"));
    try {
      const response = await api("/api/grades");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Impossibile caricare i voti.");
      }
      data = await response.json();
      if (periods().length <= 1 || (periodPos != null && !periods().some((period) => period.periodPos === periodPos))) {
        periodPos = null;
        subjectId = null;
      }
      render();
    } catch (error) {
      if (error instanceof LoginError) {
        showLogin(error.message);
        return;
      }
      const message = error.message || "Impossibile caricare i voti. Riprova.";
      const retry = button("Riprova", "grade-retry", load);
      root().replaceChildren(el("p", "grade-error", message), retry);
    } finally {
      loading = false;
    }
  }

  function open() {
    show("grades");
    subjectId = null;
    root().replaceChildren();
    load();
  }

  function handleBack() {
    if (subjectId == null) return false;
    subjectId = null;
    render();
    return true;
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (detail.path !== "/api/grades" || $("view-grades").hidden) return;
    data = detail.data;
    render();
  });
  window.addEventListener("resize", () => {
    const tabs = root().querySelector(".grade-period-tabs");
    if (tabs) requestAnimationFrame(() => centerPeriodTab(tabs, "auto"));
  });

  return { open, handleBack };
})();
