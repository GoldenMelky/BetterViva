"use strict";

const Notifications = (() => {
  const RETENTION_MS = 1 * 60 * 60 * 1000;
  const MAX_ITEMS = 100;
  const $ = (id) => document.getElementById(id);
  const stateKey = (scope) => `notifications:${scope}`;
  const states = new Map();
  const queues = new Map();
  let generation = 0;

  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const text = (value) => typeof value === "string" || typeof value === "number" ? String(value) : "";

  function cleanState(state) {
    const cutoff = Date.now() - RETENTION_MS;
    state.items = (Array.isArray(state.items) ? state.items : [])
      .filter((item) => Number.isFinite(item.createdAt) && item.createdAt >= cutoff)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_ITEMS);
    state.snapshots ||= {};
    return state;
  }

  async function getState(scope) {
    if (!states.has(scope)) {
      const state = dbGet(stateKey(scope)).then((value) => cleanState(value || {
        snapshots: {},
        items: [],
      })).catch((error) => {
        states.delete(scope);
        throw error;
      });
      states.set(scope, state);
    }
    return states.get(scope);
  }

  function eventSnapshot(data) {
    return (Array.isArray(data?.events) ? data.events : []).map((event) => ({
      id: text(event.id),
      date: text(event.date),
      subject: text(event.subject),
      teacher: text(event.teacher),
      text: text(event.text),
      code: text(event.code),
      kind: text(event.kind),
      source: Array.isArray(event.source) ? event.source.filter((item) => typeof item === "string") : [],
    })).filter((event) => event.id);
  }

  function gradeSnapshot(data) {
    const occurrences = new Map();
    return (Array.isArray(data?.grades) ? data.grades : []).map((grade) => {
      const base = text(grade.gradeId ?? grade.evtId ?? grade.evtCode)
        || JSON.stringify([
          grade.subjectId, grade.evtDate, grade.periodPos, grade.componentDesc,
          grade.displayValue, grade.decimalValue, grade.teacherName,
        ]);
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      return {
        id: `${base}:${occurrence}`,
        identity: JSON.stringify({
          base,
          occurrence,
        }),
        date: text(grade.evtDate),
        subject: text(grade.subjectName || grade.subjectDesc),
        value: text(grade.displayValue ?? grade.decimalValue),
        subjectId: grade.subjectId,
        periodPos: grade.periodPos,
        componentDesc: text(grade.componentDesc),
      };
    });
  }

  function noticeSnapshot(data) {
    const occurrences = new Map();
    return (Array.isArray(data?.items) ? data.items : []).map((item) => {
      const title = text(item.cntTitle || item.title || item.subject || item.comTitle || item.name)
        || "Comunicazione senza titolo";
      const base = item.evtCode != null && item.pubId != null
        ? `${item.evtCode}:${item.pubId}`
        : `${title}:${item.pubDT || item.date || item.comDate || ""}`;
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      return {
        id: `${base}:${occurrence}`,
        title,
        date: text(item.pubDT || item.date || item.comDate || item.msgDate),
        evtCode: item.evtCode,
        pubId: item.pubId,
      };
    });
  }

  function snapshotFor(path, data) {
    if (path === "/api/events") return eventSnapshot(data);
    if (path === "/api/grades") return gradeSnapshot(data);
    if (path === "/api/noticeboard") return noticeSnapshot(data);
    return null;
  }

  function displayDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function createItem(type, title, description, target) {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      type,
      title,
      description,
      eventDate: target.eventDate || "",
      target,
      createdAt: Date.now(),
      readAt: null,
    };
  }

  function eventTitle(event, change) {
    const category = event.kind === "verifica" ? "verifica"
      : event.kind === "interrogazione" ? "interrogazione"
        : event.source.includes("homework") ? "compito" : "evento";
    const verb = change === "new" ? (category === "verifica" || category === "interrogazione" ? "Nuova" : "Nuovo")
      : change === "modified" ? (category === "verifica" || category === "interrogazione"
        ? `${category[0].toUpperCase()}${category.slice(1)} modificata`
        : `${category[0].toUpperCase()}${category.slice(1)} modificato`)
        : (category === "verifica" || category === "interrogazione"
          ? `${category[0].toUpperCase()}${category.slice(1)} rimossa`
          : `${category[0].toUpperCase()}${category.slice(1)} rimosso`);
    return `${verb} ${category} - ${event.subject || "Evento"}`;
  }

  function diffEvents(previous, current) {
    const oldById = new Map(previous.map((event) => [event.id, event]));
    const matchedOld = new Set();
    const oldForCurrent = new Map();
    for (const event of current) {
      const old = oldById.get(event.id);
      if (!old) continue;
      matchedOld.add(old.id);
      oldForCurrent.set(event.id, old);
    }

    const matchUnique = (keyFor) => {
      const oldGroups = new Map();
      const newGroups = new Map();
      for (const event of previous) {
        if (matchedOld.has(event.id)) continue;
        const key = keyFor(event);
        if (key) oldGroups.set(key, [...(oldGroups.get(key) || []), event]);
      }
      for (const event of current) {
        if (oldForCurrent.has(event.id)) continue;
        const key = keyFor(event);
        if (key) newGroups.set(key, [...(newGroups.get(key) || []), event]);
      }
      for (const [key, oldEvents] of oldGroups) {
        const newEvents = newGroups.get(key);
        if (oldEvents.length !== 1 || newEvents?.length !== 1) continue;
        matchedOld.add(oldEvents[0].id);
        oldForCurrent.set(newEvents[0].id, oldEvents[0]);
      }
    };
    const sourceKey = (event) => event.source.slice().sort().join(",");
    matchUnique((event) => event.code ? `code:${event.code}` : "");
    matchUnique((event) => `day:${event.date}:${event.subject}:${sourceKey(event)}`);
    matchUnique((event) => `text:${event.subject}:${event.text}:${sourceKey(event)}`);

    const items = [];
    for (const event of current) {
      const old = oldForCurrent.get(event.id);
      if (!old) {
        items.push(createItem("event", eventTitle(event, "new"), event.text, {
          view: "home", date: event.date, eventDate: event.date, eventId: event.id, event,
        }));
      } else if (old.date !== event.date || old.subject !== event.subject
        || old.teacher !== event.teacher || old.text !== event.text || old.kind !== event.kind) {
        items.push(createItem("event", eventTitle(event, "modified"), event.text, {
          view: "home", date: event.date, eventDate: event.date, eventId: event.id, event,
        }));
      }
    }
    for (const event of previous) {
      if (!matchedOld.has(event.id)) {
        items.push(createItem("event", eventTitle(event, "removed"), event.text, {
          view: "home", date: event.date, eventDate: event.date, eventId: event.id, event: { ...event, removed: true },
        }));
      }
    }
    return items;
  }

  function diffGrades(previous, current) {
    const previousById = new Map(previous.map((grade) => [grade.id, grade]));
    return current.flatMap((grade) => {
      const old = previousById.get(grade.id);
      if (old && old.date === grade.date && old.subject === grade.subject && old.value === grade.value) return [];
      return [createItem("grade", `${old ? "Voto modificato" : "Nuovo voto"} - ${grade.subject || "Materia"}`,
        [grade.value, grade.componentDesc].filter(Boolean).join(" · "),
        {
          view: "grades",
          eventDate: grade.date,
          gradeIdentity: grade.identity,
          grade: {
            subjectName: grade.subject,
            subjectDesc: grade.subject,
            displayValue: grade.value,
            evtDate: grade.date,
            componentDesc: grade.componentDesc,
          },
        })];
    });
  }

  function diffNotices(previous, current) {
    const previousById = new Map(previous.map((notice) => [notice.id, notice]));
    return current.flatMap((notice) => {
      const old = previousById.get(notice.id);
      if (old && old.title === notice.title && old.date === notice.date) return [];
      return [createItem("notice",
        `${old ? "Comunicazione modificata" : "Nuova comunicazione"} - ${notice.title || "Comunicazione"}`,
        "", { view: "noticeboard", eventDate: notice.date, evtCode: notice.evtCode, pubId: notice.pubId })];
    });
  }

  function updateBadge(state) {
    const button = $("notifications-button");
    const count = $("notifications-count");
    if (!button || !count) return;
    const unread = state?.items?.filter((item) => !item.readAt).length || 0;
    count.hidden = unread === 0;
    count.textContent = unread > 9 ? "9+" : String(unread);
    button.setAttribute("aria-label", unread
      ? `Novità, ${unread} non lette`
      : "Novità");
  }

  function groupLabel(type) {
    return ({ event: "Agenda", grade: "Voti", notice: "Bacheca" })[type] || "Novità";
  }

  function renderDialog(state, error = "") {
    const list = $("notifications-list");
    if (!list) return;
    list.replaceChildren();
    if (error) {
      list.append(element("p", "notifications-empty", "Impossibile caricare le novità salvate."));
      return;
    }
    if (!state.items.length) {
      list.append(element("p", "notifications-empty", "Nessuna novità nell'ultima ora."));
    } else {
      for (const type of ["event", "grade", "notice"]) {
        const items = state.items.filter((item) => item.type === type);
        if (!items.length) continue;
        const group = element("section", "notifications-group");
        group.append(element("h3", "", groupLabel(type)));
        for (const item of items) {
          const button = element("button", `notification-item${item.readAt ? "" : " unread"}`);
          button.type = "button";
          const heading = element("span", "notification-heading");
          heading.append(element("span", "notification-title", item.title));
          if (item.eventDate) {
            const date = element("time", "notification-event-date", displayDate(item.eventDate));
            date.dateTime = item.eventDate;
            heading.append(date);
          }
          button.append(heading);
          if (item.description) button.append(element("span", "notification-description", item.description));
          button.addEventListener("click", async () => {
            await markItemRead(item.id);
            $("notifications-dialog").close();
            window.dispatchEvent(new CustomEvent("bv-notification-open", { detail: item.target }));
          });
          group.append(button);
        }
        list.append(group);
      }
    }
  }

  async function markItemRead(id) {
    const scope = cacheScope;
    if (!scope) return;
    try {
      const state = cleanState(await getState(scope));
      const item = state.items.find((entry) => entry.id === id);
      if (!item || item.readAt) return;
      item.readAt = Date.now();
      await dbSet(stateKey(scope), state);
      if (scope !== cacheScope) return;
      updateBadge(state);
      if ($("notifications-dialog").open) renderDialog(state);
    } catch (error) {
      console.error("Impossibile segnare la notifica come letta.", error);
      $("notifications-list")?.append(element("p", "notifications-error",
        "Impossibile aggiornare lo stato di lettura."));
    }
  }

  async function clearItems(state = null) {
    const scope = cacheScope;
    if (!scope) return;
    try {
      const current = state || cleanState(await getState(scope));
      current.items = [];
      await dbSet(stateKey(scope), current);
      if (scope !== cacheScope) return;
      updateBadge(current);
      if ($("notifications-dialog").open) renderDialog(current);
      if (!$("view-debug")?.hidden) await refreshDebugPanel();
    } catch (error) {
      console.error("Impossibile pulire le notifiche.", error);
      const list = $("notifications-list");
      list?.append(element("p", "notifications-error", "Impossibile pulire le notifiche. Riprova."));
    }
  }

  async function refreshBadge() {
    const scope = cacheScope;
    const currentGeneration = generation;
    if (!scope) return;
    try {
      await (queues.get(scope) || Promise.resolve());
      const state = cleanState(await getState(scope));
      if (currentGeneration === generation && scope === cacheScope) {
        updateBadge(state);
        await dbSet(stateKey(scope), state);
      }
    } catch (error) {
      console.error("Impossibile leggere le notifiche locali.", error);
    }
  }

  async function open() {
    const dialog = $("notifications-dialog");
    const scope = cacheScope;
    const currentGeneration = generation;
    if (!scope) return;
    dialog.showModal();
    try {
      const state = cleanState(await getState(scope));
      if (currentGeneration !== generation || scope !== cacheScope) {
        dialog.close();
        return;
      }
      await dbSet(stateKey(scope), state);
      updateBadge(state);
      renderDialog(state);
    } catch (error) {
      console.error("Impossibile aprire le notifiche locali.", error);
      renderDialog({ items: [] }, error);
    }
  }

  function debugStatus(message, error = false) {
    const status = $("debug-notifications-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  async function loadDebugData(type) {
    const path = ({ task: "/api/events", grade: "/api/grades", notice: "/api/noticeboard" })[type];
    if (!path) throw new Error("Tipo di notifica non valido.");
    const scope = cacheScope;
    if (!scope) throw new Error("Accedi prima di usare la modalità debug.");
    let cached = await dbGet(cacheKey(scope, path));
    if (!cached) {
      const response = await api(path);
      if (!response.ok) throw new Error(`Caricamento non riuscito (${response.status}).`);
      cached = { data: await response.json() };
    }
    return cached.data;
  }

  function latestByDate(items, dateOf) {
    return [...items].sort((left, right) => (
      String(dateOf(right) || "").localeCompare(String(dateOf(left) || ""))
    ))[0];
  }

  async function addDebugNotification(type) {
    try {
      const data = await loadDebugData(type);
      let item;
      if (type === "task") {
        const event = latestByDate(
          (data.events || []).filter((entry) => entry.source?.includes("homework")),
          (entry) => entry.date,
        );
        if (!event) throw new Error("Non ci sono compiti in cache da usare.");
        const detail = [event.subject, displayDate(event.date), event.text].filter(Boolean).join(" · ");
        item = createItem("event", eventTitle(event, "new"), event.text || detail, {
          view: "home", date: event.date, eventDate: event.date, eventId: event.id, event,
        });
      } else if (type === "grade") {
        const grades = Array.isArray(data.grades) ? data.grades : [];
        const grade = latestByDate(grades, (entry) => entry.evtDate);
        if (!grade) throw new Error("Non ci sono voti in cache da usare.");
        const index = grades.indexOf(grade);
        const snapshot = gradeSnapshot(data)[index];
        item = createItem("grade", `Nuovo voto - ${grade.subjectName || grade.subjectDesc || "Materia"}`,
          [grade.displayValue ?? grade.decimalValue, grade.componentDesc].filter(Boolean).join(" · "),
          {
            view: "grades",
            eventDate: grade.evtDate,
            gradeIdentity: snapshot.identity,
            grade: {
              subjectName: grade.subjectName,
              subjectDesc: grade.subjectDesc,
              displayValue: grade.displayValue ?? grade.decimalValue,
              evtDate: grade.evtDate,
              componentDesc: grade.componentDesc,
            },
          });
      } else if (type === "notice") {
        const notice = latestByDate(data.items || [],
          (entry) => entry.pubDT || entry.date || entry.comDate || entry.msgDate);
        if (!notice) throw new Error("Non ci sono avvisi in cache da usare.");
        const noticeTitle = notice.cntTitle || notice.title || notice.comTitle || "Comunicazione senza titolo";
        const noticeDate = notice.pubDT || notice.date || notice.comDate || notice.msgDate;
        item = createItem("notice", `Nuovo avviso - ${noticeTitle}`, "",
          { view: "noticeboard", eventDate: noticeDate, evtCode: notice.evtCode, pubId: notice.pubId });
      } else {
        throw new Error("Tipo di notifica non valido.");
      }

      const scope = cacheScope;
      const state = cleanState(await getState(scope));
      state.items.unshift(item);
      cleanState(state);
      await dbSet(stateKey(scope), state);
      if (scope !== cacheScope) return;
      updateBadge(state);
      if ($("notifications-dialog").open) renderDialog(state);
      await refreshDebugPanel();
      debugStatus("Notifica aggiunta.");
    } catch (error) {
      console.error("Impossibile aggiungere la notifica di debug.", error);
      debugStatus(error.message || "Impossibile aggiungere la notifica.", true);
    }
  }

  async function refreshDebugPanel() {
    const scope = cacheScope;
    if (!scope) return;
    try {
      const state = cleanState(await getState(scope));
      const lines = [
        `Account cache: ${scope.slice(0, 12)}`,
        `Notifiche: ${state.items.length} (non lette: ${state.items.filter((item) => !item.readAt).length})`,
        ...["/api/events", "/api/grades", "/api/noticeboard"].map((path) => {
          const count = state.snapshots[path]?.length ?? "non inizializzato";
          return `${path}: ${count} elementi nello snapshot`;
        }),
      ];
      $("debug-notifications-info").textContent = lines.join("\n");
    } catch (error) {
      console.error("Impossibile leggere lo stato debug delle notifiche.", error);
      debugStatus("Impossibile leggere lo stato locale.", true);
    }
  }

  async function pruneExpired() {
    const scope = cacheScope;
    if (!scope) return;
    try {
      const state = await getState(scope);
      const previousCount = state.items.length;
      cleanState(state);
      if (state.items.length === previousCount) return;
      await dbSet(stateKey(scope), state);
      if (scope !== cacheScope) return;
      updateBadge(state);
      if ($("notifications-dialog").open) renderDialog(state);
    } catch (error) {
      console.error("Impossibile rimuovere le notifiche scadute.", error);
    }
  }

  function clear() {
    generation++;
    states.clear();
    queues.clear();
    updateBadge(null);
  }

  async function processUpdate(scope, detail, currentGeneration) {
    const next = snapshotFor(detail.path, detail.data);
    if (!next) return;
    const state = cleanState(await getState(scope));
    const previous = state.snapshots[detail.path]
      || (detail.previous ? snapshotFor(detail.path, detail.previous) : null);
    if (previous) {
      const diff = detail.path === "/api/events" ? diffEvents(previous, next)
        : detail.path === "/api/grades" ? diffGrades(previous, next)
          : diffNotices(previous, next);
      state.items.push(...diff);
    }
    state.snapshots[detail.path] = next;
    cleanState(state);
    if (currentGeneration !== generation || scope !== cacheScope) return;
    await dbSet(stateKey(scope), state);
    updateBadge(state);
    if ($("notifications-dialog").open) renderDialog(state);
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (!cacheScope) return;
    const scope = cacheScope;
    const currentGeneration = generation;
    const previous = queues.get(scope) || Promise.resolve();
    const pending = previous
      .then(() => processUpdate(scope, detail, currentGeneration))
      .catch((error) => console.error("Impossibile aggiornare le notifiche locali.", error));
    queues.set(scope, pending);
    pending.finally(() => {
      if (queues.get(scope) === pending) queues.delete(scope);
    });
  });

  $("notifications-button")?.addEventListener("click", open);
  $("notifications-close")?.addEventListener("click", () => $("notifications-dialog").close());
  $("notifications-clear")?.addEventListener("click", () => clearItems());
  $("debug-clear-notifications")?.addEventListener("click", () => clearItems());
  $("debug-add-task")?.addEventListener("click", () => addDebugNotification("task"));
  $("debug-add-grade")?.addEventListener("click", () => addDebugNotification("grade"));
  $("debug-add-notice")?.addEventListener("click", () => addDebugNotification("notice"));
  setInterval(pruneExpired, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pruneExpired();
  });

  return { open, refreshBadge, refreshDebugPanel, clearItems, clear };
})();
