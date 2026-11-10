"use strict";

const Absences = (() => {
  const root = () => document.getElementById("absences-body");
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, cls, action) => {
    const node = el("button", cls, text);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  };
  const text = (value) => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const truthy = (value) => value === true || value === 1 || value === "1" || value === "true" || value === "Y";
  const dateInputValue = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  };
  const timeInputValue = (value) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(text(value));
    return match ? `${match[1]}:${match[2]}` : "";
  };
  const formattedDate = (value) => {
    const iso = dateInputValue(value);
    if (!iso) return text(value);
    const [year, month, day] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("it-IT", {
      day: "numeric", month: "long", year: "numeric",
    }).format(new Date(year, month - 1, day));
  };
  const numberOfDays = (later, earlier) => {
    const [ly, lm, ld] = later.split("-").map(Number);
    const [ey, em, ed] = earlier.split("-").map(Number);
    return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86400000);
  };
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const responseData = async (response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.detail || "Impossibile caricare i dati delle assenze.");
    if (!data || typeof data !== "object") throw new Error("ClasseViva ha restituito una risposta non valida.");
    return data;
  };
  const listFrom = (data, keys) => {
    if (Array.isArray(data)) return data.filter((item) => item && typeof item === "object");
    for (const key of keys) {
      if (Array.isArray(data?.[key])) return data[key].filter((item) => item && typeof item === "object");
    }
    return [];
  };
  const eventItems = (data) => listFrom(data, ["events", "details", "absences", "items"]);
  const bookItems = (data) => listFrom(data, ["items", "justifications", "librettoWeb", "events"]);
  const typeOf = (item) => {
    if (item.evtCode === "ABA0") return 0;
    if (item.evtCode === "ABR0" || item.evtCode === "ABR1") return 1;
    if (item.evtCode === "ABU0") return 2;
    const type = Number(item.evtType);
    return [0, 1, 2].includes(type) ? type : null;
  };
  const typeName = (type) => ["Assenza", "Ritardo", "Uscita anticipata"][type] || "Evento";
  const typeEnabled = (type) => truthy(config?.[["enableJustA", "enableJustR", "enableJustU"][type]]);
  const eventDate = (item) => dateInputValue(item.evtDate || item.dateStart || item.date);
  const eventStatus = (item) => {
    if (truthy(item.isJustified)) return ["justified", "Giustificata"];
    const status = Number(item.webJustifStatus);
    if (status === 1) return ["pending", "In approvazione"];
    if (status === -1) return ["rejected", "Respinta"];
    return ["todo", "Da giustificare"];
  };
  const bookStatus = (item) => {
    if (truthy(item.isRejected)) return ["rejected", "Respinta"];
    if (truthy(item.isJustified) || item.justifyAuthor || item.justifyData) {
      return ["justified", "Giustificata"];
    }
    return ["pending", "In approvazione"];
  };
  const statusFilterValue = (item) => eventStatus(item)[0];
  const allowedToJustify = (item) => {
    const type = typeOf(item);
    const status = eventStatus(item)[0];
    return (status === "todo" || status === "rejected")
      && type !== null;
  };

  let config = null;
  let events = [];
  let justifications = [];
  let activeTab = "events";
  let typeFilter = "all";
  let statusFilter = "all";
  let filtersOpen = false;
  let dateFrom = "";
  let dateTo = "";
  let loadError = "";
  let operation = 0;
  let loading = false;
  let hasCachedData = false;
  let pendingCacheData = null;
  let dataScope = null;

  function renderHeader() {
    const header = el("header", "absence-heading");
    header.append(el("h1", "", "Assenze"));
    header.append(el("p", "", "Eventi, frequenza e giustificazioni"));
    root().append(header);
    renderAnnualSummary();
    const tabs = el("div", "absence-tabs");
    for (const [key, label] of [["events", "Eventi"], ["book", "Libretto web"]]) {
      const tab = button(label, `absence-tab${activeTab === key ? " active" : ""}`, () => {
        activeTab = key;
        render();
      });
      tab.setAttribute("aria-pressed", String(activeTab === key));
      tabs.append(tab);
    }
    root().append(tabs);
  }

  function renderAnnualSummary() {
    const summary = el("section", "absence-annual-summary");
    const heading = el("div", "absence-annual-heading");
    heading.append(el("h2", "", "Monte ore annuo"));
    heading.append(el("span", "", "Anno scolastico corrente"));
    summary.append(heading);

    const total = el(
      "strong",
      "absence-annual-value",
      loading ? "Caricamento…" : "Dato non disponibile",
    );
    const note = el(
      "p",
      "absence-annual-note",
      loading
        ? "Recupero dei dati dell’anno scolastico."
        : `ClasseViva non fornisce il totale delle ore annuali. Eventi registrati: ${events.length}.`,
    );
    summary.append(total, note);
    root().append(summary);
  }

  function renderFilters() {
    const filters = el("div", "absence-filters");
    const row = el("div", "absence-filter-row");
    const chips = el("div", "absence-type-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Filtra per tipo di evento");
    for (const [value, label] of [
      ["all", "Tutti i tipi"], ["0", "Assenze"], ["1", "Ritardi"], ["2", "Uscite"],
    ]) {
      const count = value === "all"
        ? events.length
        : events.filter((item) => String(typeOf(item)) === value).length;
      const chip = button("", `absence-chip${typeFilter === value ? " active" : ""} type-${value}`, () => {
        typeFilter = value;
        render();
      });
      chip.append(
        el("span", "absence-chip-label", label),
        el("span", "absence-chip-count", String(count)),
      );
      chip.setAttribute("aria-label", `${label}: ${count} eventi`);
      chip.setAttribute("aria-pressed", String(typeFilter === value));
      chips.append(chip);
    }
    row.append(chips);

    const filterCount = (statusFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);
    const filterButton = button(
      `Filtri${filterCount ? ` ${filterCount}` : ""}`,
      `absence-filter-toggle${filtersOpen ? " active" : ""}`,
      () => { filtersOpen = !filtersOpen; render(); },
    );
    filterButton.setAttribute("aria-expanded", String(filtersOpen));
    filterButton.setAttribute("aria-controls", "absence-extra-filters");
    row.append(filterButton);
    filters.append(row);

    if (!filtersOpen) {
      if (filterCount) {
        const activeFilters = el("div", "absence-active-filters");
        const summary = statusFilter !== "all"
          ? {
            todo: "Da giustificare",
            pending: "In approvazione",
            rejected: "Respinte",
            justified: "Giustificate",
          }[statusFilter]
          : "";
        if (summary) activeFilters.append(el("span", "absence-filter-tag", `Stato: ${summary}`));
        if (dateFrom || dateTo) {
          activeFilters.append(el(
            "span",
            "absence-filter-tag",
            `Periodo: ${dateFrom || "…"} – ${dateTo || "…"}`,
          ));
        }
        activeFilters.append(button("Azzera", "absence-filter-reset", () => {
          statusFilter = "all";
          dateFrom = "";
          dateTo = "";
          render();
        }));
        filters.append(activeFilters);
      }
      root().append(filters);
      return;
    }

    const extraFilters = el("div", "absence-extra-filters");
    extraFilters.id = "absence-extra-filters";
    const status = el("select", "absence-control");
    status.setAttribute("aria-label", "Filtra per stato");
    for (const [value, label] of [
      ["all", "Tutti gli stati"], ["todo", "Da giustificare"], ["pending", "In approvazione"],
      ["rejected", "Respinte"], ["justified", "Giustificate"],
    ]) {
      const option = el("option", "", label);
      option.value = value;
      status.append(option);
    }
    status.value = statusFilter;
    status.addEventListener("change", () => { statusFilter = status.value; render(); });
    const statusField = el("label", "absence-date-field", "Stato");
    statusField.append(status);
    extraFilters.append(statusField);

    const dates = el("div", "absence-date-filters");
    for (const [id, label, value, setter] of [
      ["absence-date-from", "Dal", dateFrom, (next) => { dateFrom = next; }],
      ["absence-date-to", "Al", dateTo, (next) => { dateTo = next; }],
    ]) {
      const field = el("label", "absence-date-field", label);
      const input = el("input", "absence-control");
      input.id = id;
      input.type = "date";
      input.value = value;
      input.addEventListener("change", () => {
        setter(input.value);
        render();
      });
      field.append(input);
      dates.append(field);
    }
    extraFilters.append(dates);
    extraFilters.append(button("Azzera filtri", "absence-filter-reset", () => {
      statusFilter = "all";
      dateFrom = "";
      dateTo = "";
      render();
    }));
    filters.append(extraFilters);
    root().append(filters);
  }

  function filteredEvents() {
    return events.filter((item) => {
      const type = typeOf(item);
      const date = eventDate(item);
      if (typeFilter !== "all" && String(type) !== typeFilter) return false;
      if (statusFilter !== "all" && statusFilterValue(item) !== statusFilter) return false;
      if (dateFrom && (!date || date < dateFrom)) return false;
      if (dateTo && (!date || date > dateTo)) return false;
      return true;
    }).sort((a, b) => eventDate(b).localeCompare(eventDate(a)));
  }

  function renderEventCard(item) {
    const type = typeOf(item);
    const [status, statusText] = eventStatus(item);
    const card = el("article", `absence-card type-${type ?? "default"} status-${status}`);
    const date = eventDate(item);
    const dateObj = date ? new Date(`${date}T12:00:00`) : null;
    const dateBox = el("div", "absence-date");
    if (dateObj) {
      const day = el("strong", "", String(dateObj.getDate()));
      const month = el("span", "", new Intl.DateTimeFormat("it-IT", { month: "short" }).format(dateObj).replace(".", ""));
      dateBox.append(day, month);
    }
    card.append(dateBox);

    const body = el("div", "absence-main");
    const title = el("div", "absence-card-heading");
    title.append(el("h2", "", typeName(type)));
    title.append(el("span", `absence-status ${status}`, statusText));
    body.append(title);

    const meta = [formattedDate(date)];
    const time = timeInputValue(item.evtTime || item.time);
    if (time) meta.push(time);
    const hour = Number(item.evtHPos ?? item.hPos);
    if (Number.isFinite(hour) && hour > 0) meta.push(`${hour}ª ora`);
    const value = text(item.evtValue);
    if (value) meta.push(type === 1 && item.evtCode === "ABR1" ? `${value} min` : `${value} ${Number(value) === 1 ? "ora" : "ore"}`);
    body.append(el("p", "absence-meta", meta.filter(Boolean).join(" · ")));
    const reason = text(item.reason || item.justifyReason || item.justifReasonDesc);
    if (reason) body.append(el("p", "absence-reason", reason));
    if (Number(item.webJustifStatus) === -1 && text(item.rejectReason)) {
      body.append(el("p", "absence-rejection", `Motivo del rifiuto: ${text(item.rejectReason)}`));
    }
    if (allowedToJustify(item)) {
      body.append(button(
        status === "rejected" ? "Riprova giustificazione" : "Giustifica",
        "absence-action",
        () => openForm({ event: item }),
      ));
    }
    card.append(body);
    return card;
  }

  function renderList() {
    root().querySelector(".absence-list")?.remove();
    root().querySelector(".absence-empty")?.remove();
    const list = el("div", "absence-list");
    const items = filteredEvents();
    if (!items.length) {
      root().append(el("p", "absence-empty",
        events.length ? "Nessun evento corrisponde ai filtri." : "Non risultano assenze, ritardi o uscite."));
      return;
    }
    for (const item of items) list.append(renderEventCard(item));
    root().append(list);
  }

  function firstText(item, keys) {
    for (const key of keys) {
      const value = text(item?.[key]);
      if (value) return value;
    }
    return "";
  }

  function renderBook() {
    const list = el("div", "absence-list");
    const items = [...justifications].sort((a, b) => (
      firstText(b, ["dateStart", "evtDate", "date"]).localeCompare(
        firstText(a, ["dateStart", "evtDate", "date"]),
      )
    ));
    if (!items.length) {
      root().append(el("p", "absence-empty", "Il libretto web non contiene giustificazioni."));
    } else {
      for (const item of items) {
        const type = typeOf(item);
        const [status, statusText] = bookStatus(item);
        const card = el("article", `absence-card type-${type ?? "default"} status-${status}`);
        const start = firstText(item, ["dateStart", "evtDate", "date"]);
        const end = firstText(item, ["dateEnd"]);
        const dateObj = start ? new Date(`${start}T12:00:00`) : null;
        const dateBox = el("div", "absence-date");
        if (dateObj) {
          const day = el("strong", "", String(dateObj.getDate()));
          const month = el("span", "", new Intl.DateTimeFormat("it-IT", { month: "short" }).format(dateObj).replace(".", ""));
          dateBox.append(day, month);
        }
        card.append(dateBox);

        const body = el("div", "absence-main");
        const title = el("div", "absence-card-heading");
        title.append(el("h2", "", typeName(type)));
        title.append(el("span", `absence-status ${status}`, statusText));
        body.append(title);
        body.append(el("p", "absence-meta",
          end && end !== start
            ? `${formattedDate(start)} – ${formattedDate(end)}`
            : formattedDate(start)));
        const causalCode = firstText(item, ["causalCode"]);
        const configuredCausal = (Array.isArray(config?.causals) ? config.causals : [])
          .find((entry) => text(entry.code || entry.usercode) === causalCode);
        const causal = firstText(item, ["causalDesc", "causalDescription"])
          || text(configuredCausal?.longdesc || configuredCausal?.shortdesc)
          || causalCode;
        if (causal) body.append(el("p", "absence-reason", causal));
        const reason = firstText(item, ["reason", "justifyReason"]);
        if (reason && reason !== causal) body.append(el("p", "absence-reason", reason));
        if (status === "rejected") {
          const rejection = firstText(item, ["rejectReason"]);
          if (rejection) body.append(el("p", "absence-rejection", `Motivo del rifiuto: ${rejection}`));
          body.append(button(
            "Modifica e reinvia",
            "absence-retry",
            () => openForm({ justification: item }),
          ));
        }
        card.append(body);
        list.append(card);
      }
    }
    if (items.length) root().append(list);
    if (truthy(config?.enableJustM)) {
      const cta = el("div", "absence-cta-bar");
      cta.append(button("＋  Nuova giustificazione", "absence-action", () => openForm()));
      root().append(cta);
    }
  }

  function render() {
    root().replaceChildren();
    renderHeader();
    if (loading) {
      root().append(el("p", "absence-empty", "Caricamento assenze e giustificazioni…"));
      return;
    }
    if (loadError && !hasCachedData) {
      root().append(el("p", "absence-error", loadError));
      root().append(button("Riprova", "absence-retry", () => load()));
      return;
    }
    if (loadError) {
      root().append(el("p", "absence-error", `${loadError} Sono mostrati gli ultimi dati salvati.`));
      root().append(button("Riprova", "absence-retry", () => load()));
    }
    if (activeTab === "events") {
      renderFilters();
      renderList();
    } else {
      renderBook();
    }
  }

  async function load() {
    const currentOperation = ++operation;
    if (dataScope !== cacheScope) {
      dataScope = cacheScope;
      hasCachedData = false;
      config = null;
      events = [];
      justifications = [];
    }
    pendingCacheData = {};
    loadError = "";
    loading = !hasCachedData;
    render();

    const paths = [
      "/api/absences",
      "/api/absences/justifications/config",
      "/api/absences/justifications",
    ];
    let cachedData = {};
    if (cacheScope) {
      try {
        const records = await Promise.all(
          paths.map((path) => dbGet(cacheKey(cacheScope, path))),
        );
        cachedData = Object.fromEntries(
          paths.flatMap((path, index) => records[index] ? [[path, records[index].data]] : []),
        );
      } catch (error) {
        console.error("Impossibile leggere la cache locale delle assenze.", error);
      }
    }

    hasCachedData = hasCachedData || Object.keys(cachedData).length > 0;
    for (const [path, data] of Object.entries(cachedData)) setEndpointData(path, data);
    loading = !hasCachedData;
    render();

    const fetchPath = async (path) => {
      const response = await api(path);
      return responseData(response);
    };

    if (hasCachedData) {
      pendingCacheData = null;
      for (const path of paths) {
        fetchPath(path).then((data) => {
          if (currentOperation !== operation) return;
          setEndpointData(path, data);
          loadError = "";
          if (!document.getElementById("view-absences").hidden) render();
        }).catch((error) => {
          if (currentOperation !== operation) return;
          loadError = error.message || "Impossibile aggiornare le assenze.";
          if (!document.getElementById("view-absences").hidden) render();
        });
      }
      return;
    }

    try {
      const responses = await Promise.all(paths.map(async (path) => [path, await fetchPath(path)]));
      if (currentOperation !== operation) return;
      for (const [path, data] of responses) {
        setEndpointData(path, pendingCacheData[path] ?? data);
      }
      hasCachedData = true;
      loadError = "";
    } catch (error) {
      if (currentOperation !== operation) return;
      loadError = error.message || "Impossibile caricare le assenze.";
    } finally {
      if (currentOperation === operation) {
        loading = false;
        pendingCacheData = null;
        render();
      }
    }
  }

  function setEndpointData(path, data) {
    if (path === "/api/absences") {
      events = eventItems(data);
    } else if (path === "/api/absences/justifications/config") {
      config = data;
    } else if (path === "/api/absences/justifications") {
      justifications = bookItems(data);
    }
  }

  function field(parent, labelText, name, value, options = {}) {
    const label = el("label", "absence-form-field", labelText);
    let input;
    if (options.select) {
      input = el("select", "absence-form-control");
      for (const optionData of options.select) {
        const option = el("option", "", optionData.label);
        option.value = optionData.value;
        input.append(option);
      }
    } else if (options.multiline) {
      input = el("textarea", "absence-form-control");
      input.rows = options.rows || 4;
      if (options.maxLength) input.maxLength = options.maxLength;
    } else {
      input = el("input", "absence-form-control");
      input.type = options.type || "text";
      if (options.maxLength) input.maxLength = options.maxLength;
    }
    input.name = name;
    input.value = value || "";
    if (options.required) input.required = true;
    if (options.min) input.min = options.min;
    if (options.max) input.max = options.max;
    label.append(input);
    parent.append(label);
    return input;
  }

  function causalOptions() {
    const causals = Array.isArray(config?.causals) ? config.causals : [];
    return causals.map((causal) => ({
      value: text(causal.code || causal.usercode),
      label: text(causal.desc || causal.longdesc || causal.shortdesc || causal.description || causal.code),
    })).filter((causal) => causal.value);
  }

  function openForm({ event = null, justification = null } = {}) {
    const source = justification || event;
    let selectedType = source ? typeOf(source) : 0;
    const currentDate = eventDate(source || {}) || dateInputValue(source?.dateStart) || today();
    const form = el("form", "absence-form");
    form.append(el(
      "h2",
      "",
      justification ? "Modifica e reinvia" : event ? "Giustifica evento" : "Nuova giustificazione",
    ));

    if (justification && firstText(justification, ["rejectReason"])) {
      form.append(el("p", "absence-form-rejection", `Respinta: ${firstText(justification, ["rejectReason"])}`));
    }

    const typeField = el("fieldset", "absence-type-field");
    typeField.append(el("legend", "", "Tipo di evento"));
    const typeTabs = el("div", "absence-type-tabs");
    typeTabs.setAttribute("role", "group");
    typeTabs.setAttribute("aria-label", "Tipo di evento");
    const typeOptions = [
      { value: 0, label: "Assenza" },
      { value: 1, label: "Ritardo" },
      { value: 2, label: "Uscita" },
    ].filter((option) => source || truthy(config?.enableJustM) || typeEnabled(option.value));
    for (const option of typeOptions) {
      const typeButton = button(option.label, "absence-type-tab", () => {
        selectedType = option.value;
        updateTypeFields();
      });
      typeButton.dataset.type = String(option.value);
      typeButton.setAttribute("aria-pressed", String(selectedType === option.value));
      typeButton.disabled = Boolean(source);
      typeTabs.append(typeButton);
    }
    typeField.append(typeTabs);
    form.append(typeField);

    const dates = el("div", "absence-date-row");
    form.append(dates);
    const startField = field(dates, "Dal", "dateStart", dateInputValue(source?.dateStart) || currentDate, {
      type: "date", required: true, min: schoolYearStart(), max: schoolYearEnd(),
    });
    const endField = field(dates, "Al", "dateEnd", dateInputValue(source?.dateEnd) || currentDate, {
      type: "date", required: true, min: schoolYearStart(), max: schoolYearEnd(),
    });
    const timeField = field(form, "Orario", "time", timeInputValue(source?.evtTime || source?.time), { type: "time" });
    const pickupField = field(form, "Accompagnatore", "pickup", text(source?.pickup), { maxLength: 300 });
    const causalField = field(form, "Causale", "causalCode", text(source?.causalCode), {
      required: true,
      select: [{ value: "", label: "Seleziona una causale" }, ...causalOptions()],
    });
    const reasonField = field(form, "Motivazione", "reason", text(source?.reason), {
      required: true, maxLength: 1000, multiline: true, rows: 4,
    });
    reasonField.placeholder = "Inserisci una motivazione";
    const hPos = Number(source?.evtHPos ?? source?.hPos);
    const hPosField = field(form, "Ora di lezione (facoltativa)", "hPos",
      Number.isInteger(hPos) && hPos > 0 ? String(hPos) : "", { type: "number", min: "1", max: "12" });
    const otherInfoFields = el("fieldset", "absence-other-info");
    otherInfoFields.append(el("legend", "", "Altre informazioni"));
    for (const info of Array.isArray(config?.otherInfo) ? config.otherInfo : []) {
      const id = Number(info.id);
      if (!Number.isInteger(id) || id < 0) continue;
      const label = el("label", "absence-checkbox-label");
      const checkbox = el("input");
      checkbox.type = "checkbox";
      checkbox.name = "otherInfo";
      checkbox.value = String(id);
      if ((source?.otherInfo || []).some((value) => Number(value.id) === id)) checkbox.checked = true;
      label.append(checkbox, document.createTextNode(` ${text(info.desc || info.description || info.label)}`));
      otherInfoFields.append(label);
    }
    if (otherInfoFields.querySelector("input")) form.append(otherInfoFields);

    const status = el("p", "absence-form-status");
    status.setAttribute("role", "status");
    form.append(status);
    const actions = el("div", "absence-form-actions");
    actions.append(button("Annulla", "absence-cancel", () => Sheet.close()));
    const submit = el("button", "absence-submit", "Invia giustificazione");
    submit.type = "submit";
    submit.setAttribute("aria-label", "Invia giustificazione");
    actions.append(submit);
    form.append(actions);

    const updateTypeFields = () => {
      for (const tab of typeTabs.querySelectorAll(".absence-type-tab")) {
        tab.setAttribute("aria-pressed", String(Number(tab.dataset.type) === selectedType));
      }
      timeField.required = selectedType !== 0;
      timeField.closest("label").hidden = selectedType === 0;
      pickupField.closest("label").hidden = selectedType !== 2;
      endField.disabled = selectedType !== 0;
      if (selectedType !== 0) endField.value = startField.value;
    };
    startField.addEventListener("change", () => {
      if (selectedType !== 0) endField.value = startField.value;
    });
    updateTypeFields();

    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      if (!form.reportValidity()) return;
      const evtType = selectedType;
      const payload = {
        evtType,
        causalCode: causalField.value,
        dateStart: startField.value,
        dateEnd: evtType === 0 ? endField.value : startField.value,
        reason: reasonField.value.trim(),
        otherInfo: [...form.querySelectorAll('input[name="otherInfo"]:checked')]
          .map((input) => ({ id: Number(input.value) })),
      };
      if (evtType !== 0) payload.time = timeField.value;
      if (evtType === 2) payload.pickup = pickupField.value.trim() || null;
      if (hPosField.value) payload.hPos = Number(hPosField.value);
      const validationError = validatePayload(payload);
      if (validationError) {
        status.textContent = validationError;
        return;
      }
      const path = justification
        ? `/api/absences/justifications/${encodeURIComponent(String(justification.evtId))}`
        : "/api/absences/justifications";
      const method = justification ? "PUT" : "POST";
      submit.disabled = true;
      status.textContent = "Invio in corso…";
      try {
        const response = await fetchApi(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await responseData(response);
        if (currentOperation !== operation) return;
        Sheet.close();
        await load();
      } catch (error) {
        status.textContent = error.message || "Impossibile inviare la giustificazione.";
        submit.disabled = false;
      }
    });
    Sheet.open(form);
    causalField.focus();
  }

  function schoolYearStart() {
    const now = new Date();
    const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-09-01`;
  }

  function schoolYearEnd() {
    return `${Number(schoolYearStart().slice(0, 4)) + 1}-08-31`;
  }

  function validatePayload(payload) {
    const begin = payload.dateStart;
    const end = payload.dateEnd;
    if (!begin || !end || end < begin) return "Controlla le date selezionate.";
    if (begin < schoolYearStart() || end > schoolYearEnd()) {
      return "Le date devono appartenere all'anno scolastico corrente.";
    }
    const maxPeriod = Number(config?.maxPeriodDays ?? 15);
    if (payload.evtType === 0 && Number.isFinite(maxPeriod) && maxPeriod > 0
        && numberOfDays(end, begin) > maxPeriod) {
      return `Il periodo non può superare ${maxPeriod} giorni.`;
    }
    const latestDate = payload.evtType === 0 ? end : begin;
    const futureDays = numberOfDays(latestDate, today());
    const maxFuture = Number(config?.maxDaysFuture);
    if (futureDays > 0 && (maxFuture === 0 || (Number.isFinite(maxFuture) && futureDays > maxFuture))) {
      return maxFuture === 0
        ? "Non è possibile giustificare date future."
        : `La data supera il limite di ${maxFuture} giorni nel futuro.`;
    }
    if (!causalOptions().some((causal) => causal.value === payload.causalCode)) {
      return "Seleziona una causale valida.";
    }
    return "";
  }

  function open() {
    return load();
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (detail.path === "/api/absences") {
      events = eventItems(detail.data);
    } else if (detail.path === "/api/absences/justifications/config") {
      config = detail.data;
    } else if (detail.path === "/api/absences/justifications") {
      justifications = bookItems(detail.data);
    } else {
      return;
    }

    if (loading && pendingCacheData) pendingCacheData[detail.path] = detail.data;
    hasCachedData = true;
    if (!document.getElementById("view-absences").hidden && !loading && !loadError) render();
  });

  return { open };
})();
