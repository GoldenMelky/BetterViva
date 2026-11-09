"use strict";

const Subjects = (() => {
  const $ = (id) => document.getElementById(id);
  const root = () => $("subjects-body");
  const paths = ["/api/subjects", "/api/grades", "/api/events", "/api/lessons"];
  let subjects = [];
  let gradeData = null;
  let grades = [];
  let events = [];
  let lessons = [];
  let selectedId = null;
  let filter = "all";
  let query = "";
  let loading = false;
  let loadPromise = null;

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
  const sameId = (left, right) => left != null && right != null && String(left) === String(right);
  const dateLabel = (value, options = { day: "numeric", month: "short", year: "numeric" }) => {
    if (typeof value !== "string") return "";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("it-IT", options).format(date);
  };
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const shortName = (name) => String(name || "Materia").trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0] || "").join("").toLocaleUpperCase("it-IT");

  function itemsFor(subject) {
    const items = [];
    for (const grade of grades) {
      if (!sameId(grade.subjectId, subject.id)) continue;
      items.push({
        type: "grade",
        filter: "verification",
        date: grade.evtDate,
        title: grade.notesForFamily || grade.componentDesc || "Valutazione",
        description: [grade.componentDesc, grade.teacherName].filter(Boolean).join(" · "),
        value: grade.displayValue || "—",
        order: Number(grade.displaPos || 0),
      });
    }
    for (const event of events) {
      if (!sameId(event.subject_id, subject.id)) continue;
      const isHomework = event.source?.includes("homework") && !event.kind;
      items.push({
        type: event.kind ? "verification" : isHomework ? "homework" : "event",
        filter: event.kind ? "verification" : isHomework ? "homework" : "all",
        date: event.date,
        title: event.text || (isHomework ? "Compito assegnato" : "Attività"),
        description: event.kind
          ? event.kind === "interrogazione" ? "Interrogazione" : "Verifica"
          : isHomework ? "Compito" : "Attività",
        order: 0,
      });
    }
    for (const lesson of lessons) {
      if (!sameId(lesson.subjectId, subject.id)) continue;
      items.push({
        type: "lesson",
        filter: "lesson",
        date: lesson.evtDate,
        title: lesson.lessonArg || lesson.lessonType || "Lezione",
        description: [lesson.lessonType, lesson.evtHPos ? `${lesson.evtHPos}ª ora` : ""]
          .filter(Boolean).join(" · "),
        order: Number(lesson.evtHPos || 0),
      });
    }
    return items.sort((left, right) =>
      String(right.date || "").localeCompare(String(left.date || "")) || right.order - left.order);
  }

  function renderSubjectCards(list) {
    const filtered = subjects.filter((subject) =>
      `${subject.name} ${subject.original_name} ${(subject.teachers || []).join(" ")}`
        .toLocaleLowerCase("it-IT").includes(query.toLocaleLowerCase("it-IT")));
    list.replaceChildren();
    if (!filtered.length) {
      list.append(el("p", "subject-empty", subjects.length ? "Nessuna materia trovata." : "Non risultano materie."));
      return;
    }
    for (const subject of filtered) {
      const row = button("", "subject-list-card", () => {
        history.pushState({ ...(history.state || {}), bvApp: true, view: "subjects", subjectId: subject.id }, "");
        selectedId = subject.id;
        filter = "all";
        renderDetail();
      });
      row.dataset.color = subject.color || "blue";
      const icon = el("span", "subject-list-icon", shortName(subject.name));
      icon.setAttribute("aria-hidden", "true");
      const text = el("span", "subject-list-copy");
      text.append(el("strong", "subject-list-name", subject.name || "Materia"));
      text.append(el("span", "subject-list-teacher", (subject.teachers || []).join(", ") || "Docente non indicato"));
      const arrow = el("span", "subject-list-arrow", "›");
      arrow.setAttribute("aria-hidden", "true");
      row.append(icon, text, arrow);
      list.append(row);
    }
  }

  function renderList() {
    const heading = el("div", "subjects-page-heading");
    heading.append(el("h1", "", "Materie"));
    heading.append(el("p", "", "Le tue materie, con voti, compiti e lezioni."));
    const search = document.createElement("input");
    search.className = "subjects-search";
    search.type = "search";
    search.placeholder = "Cerca materia o docente…";
    search.setAttribute("aria-label", "Cerca materia o docente");
    search.value = query;
    const list = el("div", "subjects-list");
    search.addEventListener("input", () => {
      query = search.value;
      renderSubjectCards(list);
    });
    root().replaceChildren(heading, search, list);
    renderSubjectCards(list);
  }

  function filteredItems(items) {
    if (filter === "all") return items;
    return items.filter((item) => item.filter === filter);
  }

  function renderTimeline(items) {
    const timeline = el("div", "subject-timeline");
    if (!items.length) {
      timeline.append(el("p", "subject-empty", "Nessun elemento per questo filtro."));
      return timeline;
    }
    for (const item of items) {
      const row = el("article", `subject-timeline-item ${item.type}`);
      const marker = el("span", "subject-timeline-marker");
      marker.setAttribute("aria-hidden", "true");
      const card = el("div", "subject-timeline-card");
      const meta = el("div", "subject-timeline-meta");
      meta.append(el("span", "subject-timeline-date", dateLabel(item.date)));
      meta.append(el("span", "subject-timeline-type",
        item.type === "grade" ? "Voto"
          : item.type === "verification" ? item.description
            : item.type === "homework" ? "Compito"
              : item.type === "lesson" ? "Lezione" : "Attività"));
      card.append(meta);
      if (item.value) card.append(el("strong", "subject-timeline-grade", item.value));
      card.append(el("h3", "", item.title));
      if (item.description && item.type !== "verification") {
        card.append(el("p", "subject-timeline-description", item.description));
      }
      row.append(marker, card);
      timeline.append(row);
    }
    return timeline;
  }

  function renderDetail() {
    const subject = subjects.find((item) => sameId(item.id, selectedId));
    if (!subject) {
      selectedId = null;
      return renderList();
    }
    const items = itemsFor(subject);
    const stats = gradeData?.overall?.subjects?.find((item) => sameId(item.subjectId, subject.id));
    const average = stats?.average == null ? "—" : Number(stats.average).toFixed(1);
    const next = items.filter((item) => typeof item.date === "string" && item.date >= today())
      .sort((left, right) => String(left.date).localeCompare(String(right.date)))[0];

    const hero = el("section", "subject-detail-hero");
    hero.dataset.color = subject.color || "blue";
    const teacher = (subject.teachers || []).join(", ") || "Docente non indicato";
    hero.append(el("p", "subject-detail-teacher", teacher));
    hero.append(el("h1", "", subject.name || "Materia"));
    const summary = el("div", "subject-detail-summary");
    const averageCard = el("div", "subject-summary-card");
    averageCard.append(el("span", "subject-summary-label", "Media attuale"));
    averageCard.append(el("strong", "subject-summary-value", average));
    averageCard.append(el("span", "subject-summary-caption", `${stats?.gradeCount || 0} voti`));
    const nextCard = el("div", "subject-summary-card subject-next-card");
    nextCard.append(el("span", "subject-summary-label", next ? "Prossimo appuntamento" : "Registro"));
    nextCard.append(el("strong", "subject-next-title", next?.title || "Nessuna scadenza"));
    nextCard.append(el("span", "subject-summary-caption", next ? dateLabel(next.date) : `${items.length} elementi`));
    summary.append(averageCard, nextCard);
    hero.append(summary);

    const counts = {
      all: items.length,
      verification: items.filter((item) => item.filter === "verification").length,
      homework: items.filter((item) => item.filter === "homework").length,
      lesson: items.filter((item) => item.filter === "lesson").length,
    };
    const filters = [
      ["all", "Tutto"],
      ["verification", "Verifiche"],
      ["homework", "Compiti"],
      ["lesson", "Lezioni"],
    ];
    const pills = el("div", "subject-filters");
    pills.setAttribute("role", "group");
    pills.setAttribute("aria-label", "Filtra il registro");
    for (const [value, label] of filters) {
      const pill = button(`${label} ${counts[value]}`, `subject-filter${filter === value ? " active" : ""}`, () => {
        filter = value;
        renderDetail();
      });
      pill.setAttribute("aria-pressed", String(filter === value));
      pills.append(pill);
    }

    const title = el("div", "subject-timeline-heading");
    title.append(el("h2", "", "Registro"));
    title.append(el("span", "", `${items.length} elementi`));
    root().replaceChildren(hero, pills, title, renderTimeline(filteredItems(items)));
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      loading = true;
      const timer = setTimeout(() => {
        if (loading) root().replaceChildren(el("p", "subject-loading", "Caricamento materie…"));
      }, 250);
      try {
        const responses = await Promise.all(paths.map((path) => api(path)));
        const payloads = await Promise.all(responses.map(async (response, index) => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `Impossibile caricare ${paths[index]}.`);
          }
          return response.json();
        }));
        subjects = payloads[0].subjects || [];
        gradeData = payloads[1];
        grades = gradeData.grades || [];
        events = payloads[2].events || [];
        lessons = payloads[3].lessons || [];
        selectedId == null ? renderList() : renderDetail();
      } catch (error) {
        if (error instanceof LoginRequired) {
          showLogin(error.message);
          return;
        }
        const retry = button("Riprova", "subject-retry", load);
        root().replaceChildren(
          el("p", "subject-error", error.message || "Impossibile caricare le materie."),
          retry,
        );
      } finally {
        clearTimeout(timer);
        loading = false;
      }
    })();
    try {
      await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  function open(subjectId = null) {
    show("subjects");
    selectedId = subjectId;
    history.replaceState(
      subjectId == null ? { bvApp: true, view: "subjects" }
        : { bvApp: true, view: "subjects", subjectId },
      "",
    );
    if (subjectId == null) query = "";
    root().replaceChildren();
    return load();
  }

  function handleBack() {
    if (selectedId == null) return false;
    selectedId = null;
    filter = "all";
    renderList();
    return true;
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (!paths.includes(detail.path) || $("view-subjects").hidden) return;
    if (detail.path === "/api/subjects") subjects = detail.data.subjects || [];
    else if (detail.path === "/api/grades") {
      gradeData = detail.data;
      grades = gradeData.grades || [];
    }
    else if (detail.path === "/api/events") events = detail.data.events || [];
    else if (detail.path === "/api/lessons") lessons = detail.data.lessons || [];
    if (loading) return;
    selectedId == null ? renderList() : renderDetail();
  });

  return { open, handleBack };
})();
