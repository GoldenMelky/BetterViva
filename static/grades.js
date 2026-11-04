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

  function centerPeriodTab(tabs) {
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
      behavior: "instant",
    });
  }

  function renderTabs() {
    const tabs = el("div", "grade-period-tabs");
    const subjectItems = subjectId == null ? null : selectedStats()?.subjects || [];
    const items = subjectItems || [{ periodPos: null, periodLabel: "Tutto l’anno" },
      ...(periods().length > 1 ? periods() : [])];
    tabs.setAttribute("aria-label", subjectItems ? "Materie" : "Periodi");
    const before = el("span", "grade-period-spacer");
    const after = el("span", "grade-period-spacer");
    before.setAttribute("aria-hidden", "true");
    after.setAttribute("aria-hidden", "true");
    tabs.append(before);
    for (const item of items) {
      const isSubjectTab = subjectItems !== null;
      const label = isSubjectTab
        ? item.subjectName || item.subjectDesc || "Materia"
        : item.periodLabel;
      const isActive = isSubjectTab ? item.subjectId === subjectId : item.periodPos === periodPos;
      const tab = button(label, "grade-period-tab", () => {
        if (isSubjectTab) {
          navigateToSubject(item.subjectId);
        } else {
          periodPos = item.periodPos;
          subjectId = null;
          render();
        }
      });
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-pressed", String(isActive));
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

  function openCalculator(subject) {
    const contributions = subject.grades
      .filter((grade) => !grade.canceled && !grade.noAverage)
      .map((grade) => ({
        value: grade.decimalValue,
        weight: grade.weightFactor === undefined ? 1 : grade.weightFactor,
      }))
      .filter(({ value, weight }) => (
        value !== null && value !== undefined && value !== "" && typeof value !== "boolean"
        && weight !== null && weight !== "" && typeof weight !== "boolean"
        && Number.isFinite(Number(value)) && Number.isFinite(Number(weight)) && Number(weight) > 0
      ))
      .map(({ value, weight }) => ({ value: Number(value), weight: Number(weight) }));
    const totalWeight = contributions.reduce((sum, grade) => sum + grade.weight, 0);
    const average = totalWeight
      ? contributions.reduce((sum, grade) => sum + grade.value * grade.weight, 0) / totalWeight
      : 0;
    const initialTarget = average < 6
      ? 6
      : Math.min(10, Math.ceil((average + 1) * 2 - 1e-9) / 2);
    let target = initialTarget;
    let extraGrades = 0;

    function renderCalculator() {
      const requiredCount = target <= average
        ? 0
        : target >= 10
          ? 1
          : Math.max(1, Math.ceil(totalWeight * (target - average) / (10 - target) - 1e-9));
      const gradeCount = requiredCount + extraGrades;
      const neededGrade = gradeCount
        ? Math.min(10, Math.max(1, Math.ceil(
          (target + totalWeight * (target - average) / gradeCount) * 2 - 1e-9,
        ) / 2))
        : null;
      const nodes = [];
      nodes.push(el("h2", "sheet-title", subject.subjectName || subject.subjectDesc || "Materia"));

      const targetGroup = el("div", "grade-calculator-target");
      targetGroup.setAttribute("role", "group");
      targetGroup.setAttribute("aria-label", "Media desiderata");
      targetGroup.append(el("p", "grade-calculator-label", "Per avere la media del..."));
      const targetControls = el("div", "grade-calculator-controls");
      const decrease = button("−", "grade-calculator-step", () => {
        target = Math.max(1, target - 0.5);
        Sheet.update(...renderCalculator());
      });
      decrease.setAttribute("aria-label", "Diminuisci la media desiderata");
      decrease.disabled = target <= 1;
      const targetValue = el("span", "grade-calculator-target-value", formatCalculatorGrade(target));
      targetValue.setAttribute("aria-live", "polite");
      const increase = button("+", "grade-calculator-step", () => {
        target = Math.min(10, target + 0.5);
        Sheet.update(...renderCalculator());
      });
      increase.setAttribute("aria-label", "Aumenta la media desiderata");
      increase.disabled = target >= 10;
      targetControls.append(decrease, targetValue, increase);
      targetGroup.append(targetControls);
      nodes.push(targetGroup, el("p", "grade-calculator-label grade-calculator-needed-label", "...devo prendere..."));

      const grades = el("div", "grade-calculator-grades");
      grades.setAttribute("role", "list");
      grades.setAttribute("aria-label", "Voti necessari");
      for (let index = 0; index < gradeCount; index += 1) {
        const grade = el("span", "grade-calculator-grade", formatCalculatorGrade(neededGrade));
        grade.setAttribute("role", "listitem");
        grades.append(grade);
      }
      const addGrade = button("+", "grade-calculator-add", () => {
        extraGrades += 1;
        Sheet.update(...renderCalculator());
      });
      addGrade.setAttribute("aria-label", "Aggiungi una valutazione");
      grades.append(addGrade);
      nodes.push(grades);

      if (target >= 10 && average < 10) {
        nodes.push(el("p", "grade-calculator-note", "La media del 10 non è raggiungibile con un numero finito di voti."));
      } else if (gradeCount === 0) {
        nodes.push(el("p", "grade-calculator-note", "Hai già raggiunto questa media. Aggiungi un voto per simulare il risultato."));
      }
      return nodes;
    }

    function formatCalculatorGrade(value) {
      return Number.isInteger(value) ? String(value) : `${Math.floor(value)}½`;
    }

    Sheet.open(...renderCalculator());
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
    text.append(button("Calcola voto", "grade-calculator-open", () => openCalculator(subject)));
    summary.append(text);

    const page = el("div", "grade-subject-page");
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
    page.append(summary, list);
    root().replaceChildren(renderPeriodNav(true), page);
  }

  function render() {
    if (!data) return;
    const stats = selectedStats();
    if (subjectId != null) return renderSubject(stats);
    renderOverview(stats);
  }

  let touchStart = null;
  let subjectTransitioning = false;

  function finishSubjectTransition(nextSubjectId, offset) {
    subjectId = nextSubjectId;
    render();
    const incomingPage = root().querySelector(".grade-subject-page");
    if (incomingPage) {
      incomingPage.style.transition = "none";
      incomingPage.style.transform = `translateX(${-offset}px)`;
      incomingPage.getBoundingClientRect();
      requestAnimationFrame(() => {
        incomingPage.style.transition = "";
        incomingPage.style.transform = "";
      });
    }
    subjectTransitioning = false;
  }

  function navigateToSubject(nextSubjectId, offset = null) {
    if (subjectTransitioning || nextSubjectId === subjectId) return;
    const subjects = selectedStats()?.subjects || [];
    const currentIndex = subjects.findIndex((subject) => subject.subjectId === subjectId);
    const nextIndex = subjects.findIndex((subject) => subject.subjectId === nextSubjectId);
    if (currentIndex < 0 || nextIndex < 0) return;

    const page = root().querySelector(".grade-subject-page");
    if (!page) {
      subjectId = nextSubjectId;
      render();
      return;
    }
    const distance = offset ?? (nextIndex > currentIndex ? -1 : 1) * page.clientWidth;
    subjectTransitioning = true;
    page.style.transition = "transform 220ms ease-out";
    page.style.transform = `translateX(${distance}px)`;

    let completed = false;
    let timeout;
    const finish = (event) => {
      if (completed || (event && (event.target !== page || event.propertyName !== "transform"))) return;
      completed = true;
      clearTimeout(timeout);
      page.removeEventListener("transitionend", finish);
      finishSubjectTransition(nextSubjectId, distance);
    };
    page.addEventListener("transitionend", finish);
    timeout = setTimeout(finish, 260);
  }

  root().addEventListener("touchstart", (event) => {
    const page = event.target.closest(".grade-subject-page");
    if (subjectId == null || subjectTransitioning || event.touches.length !== 1 || !page
      || event.target.closest(".grade-calculator-open")) {
      touchStart = null;
      return;
    }
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, page, axis: null };
  }, { passive: true });
  root().addEventListener("touchmove", (event) => {
    if (!touchStart || event.touches.length !== 1 || subjectTransitioning) return;
    const dx = event.touches[0].clientX - touchStart.x;
    const dy = event.touches[0].clientY - touchStart.y;
    if (touchStart.axis === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      touchStart.axis = Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical";
    }
    if (touchStart.axis !== "horizontal") return;
    event.preventDefault();
    touchStart.page.style.transition = "none";
    touchStart.page.style.transform = `translateX(${dx}px)`;
  }, { passive: false });
  function finishTouchNavigation(event, cancelled = false) {
    if (!touchStart) return;
    const gesture = touchStart;
    touchStart = null;
    if (gesture.axis !== "horizontal") return;
    const dx = cancelled || !event.changedTouches?.length
      ? 0
      : event.changedTouches[0].clientX - gesture.x;
    const subjects = selectedStats()?.subjects || [];
    const currentIndex = subjects.findIndex((subject) => subject.subjectId === subjectId);
    const nextIndex = currentIndex + (dx < 0 ? 1 : -1);
    if (Math.abs(dx) >= 48 && nextIndex >= 0 && nextIndex < subjects.length) {
      navigateToSubject(subjects[nextIndex].subjectId, dx < 0 ? -gesture.page.clientWidth : gesture.page.clientWidth);
      return;
    }
    gesture.page.style.transition = "transform 180ms ease-out";
    gesture.page.style.transform = "";
    setTimeout(() => {
      gesture.page.style.transition = "";
    }, 200);
  }
  root().addEventListener("touchend", (event) => finishTouchNavigation(event), { passive: true });
  root().addEventListener("touchcancel", (event) => finishTouchNavigation(event, true), { passive: true });

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
      if (error instanceof LoginRequired) {
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
    if (tabs) requestAnimationFrame(() => centerPeriodTab(tabs));
  });

  return { open, handleBack };
})();
