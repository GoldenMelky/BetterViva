"use strict";

const Noticeboard = (() => {
  const $ = (id) => document.getElementById(id);
  const root = () => $("noticeboard-body");
  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const firstValue = (item, keys) => {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  };
  const textValue = (value) => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    return "";
  };
  const matchingText = (item, pattern) => {
    const match = Object.entries(item || {}).find(([key, value]) => pattern.test(key) && textValue(value));
    return match ? textValue(match[1]) : "";
  };
  const titleOf = (item) => textValue(firstValue(item, [
    "cntTitle", "title", "subject", "comTitle", "msgTitle", "msgSubject",
    "communicationTitle", "evtTitle", "name",
  ])) || matchingText(item, /title|subject/i) || "Comunicazione senza titolo";
  const bodyOf = (item) => textValue(firstValue(item, [
    "text", "cntText", "comText", "comDesc", "msgText", "body", "description", "message",
    "communicationText",
  ])) || matchingText(item, /text|message|body|content/i);
  const dateOf = (item) => textValue(firstValue(item, [
    "pubDT", "date", "comDate", "msgDate", "createdAt", "communicationDate",
  ])) || matchingText(item, /date|datetime|dt$/i);
  const isRead = (item) => {
    const explicit = firstValue(item, ["readStatus", "isRead", "read", "viewed", "comRead"]);
    const value = explicit !== "" ? explicit
      : Object.entries(item || {}).find(([key, candidate]) => (
        /read|view/i.test(key) && candidate !== undefined && candidate !== null && candidate !== ""
      ))?.[1];
    return value === true || value === 1 || value === "1" || value === "true" || value === "Y";
  };
  const isRequired = (item, key) => {
    const value = item?.[key];
    return value === true || value === 1 || value === "1" || value === "true" || value === "Y";
  };
  const formattedDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  };

  let data = null;
  let pendingData = null;
  let selected = null;
  let searchOpen = false;
  let searchTerm = "";
  let loading = false;
  let loadingVisible = false;
  let loadPromise = null;
  let loadError = "";
  let operation = 0;

  function entries() {
    return (data?.items || []).map((item) => ({ item }));
  }

  function visibleEntries() {
    const query = searchTerm.trim().toLocaleLowerCase("it");
    if (!query) return entries();
    return entries().filter(({ item }) => (
      `${titleOf(item)} ${bodyOf(item)} ${item.cntCategory || ""}`.toLocaleLowerCase("it").includes(query)
    ));
  }

  function button(label, cls, onClick, ariaLabel = "") {
    const node = element("button", cls, label);
    node.type = "button";
    if (ariaLabel) node.setAttribute("aria-label", ariaLabel);
    node.addEventListener("click", onClick);
    return node;
  }

  function noticeContentCacheKey(item, scope = cacheScope) {
    if (!scope || item?.evtCode == null || item?.pubId == null) return null;
    const evtCode = encodeURIComponent(String(item.evtCode));
    const pubId = encodeURIComponent(String(item.pubId));
    return cacheKey(scope, `/api/noticeboard/${evtCode}/${pubId}/content`);
  }

  async function cacheNoticeContent(item, content, scope = cacheScope, completed = false) {
    const key = noticeContentCacheKey(item, scope);
    if (!key || scope !== cacheScope) return;
    try {
      await dbSet(key, { data: { ...content, _responseCompleted: completed } });
    } catch (error) {
      console.error("Impossibile salvare il contenuto della comunicazione nella cache locale.", error);
    }
  }

  async function cacheNoticeList(scope = cacheScope) {
    if (!scope || scope !== cacheScope || !data) return;
    try {
      await dbSet(cacheKey(scope, "/api/noticeboard"), { data });
    } catch (error) {
      console.error("Impossibile salvare la bacheca nella cache locale.", error);
    }
  }

  function renderHeader() {
    const header = element("div", "noticeboard-heading");
    header.append(element("h1", "", "Bacheca"));
    const search = button("", "noticeboard-search", () => {
      searchOpen = !searchOpen;
      if (!searchOpen) searchTerm = "";
      render();
      if (searchOpen) $("noticeboard-search-input").focus();
    }, searchOpen ? "Chiudi ricerca" : "Cerca");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2.2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "10.8");
    circle.setAttribute("cy", "10.8");
    circle.setAttribute("r", "6.8");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", "m16 16 5 5");
    icon.append(circle, line);
    search.append(icon);
    header.append(search);
    root().append(header);
  }

  function renderSearch() {
    if (!searchOpen) return;
    const input = element("input", "noticeboard-search-input");
    input.id = "noticeboard-search-input";
    input.type = "search";
    input.placeholder = "Cerca nella bacheca";
    input.setAttribute("aria-label", "Cerca avvisi e comunicazioni");
    input.value = searchTerm;
    input.addEventListener("input", () => {
      searchTerm = input.value;
      renderList();
      const replacement = $("noticeboard-search-input");
      replacement?.focus();
      replacement?.setSelectionRange(searchTerm.length, searchTerm.length);
    });
    root().append(input);
  }

  function renderList() {
    root().querySelector(".noticeboard-list")?.remove();
    const list = element("div", "noticeboard-list");
    const items = visibleEntries();
    if (!items.length) {
      list.append(element("p", "noticeboard-empty",
        searchTerm ? "Nessun risultato per questa ricerca." : "Non ci sono avvisi."));
      root().append(list);
      return;
    }
    for (const entry of items) {
      const { item } = entry;
      const read = isRead(item);
      const card = button("", `noticeboard-card ${read ? "read" : "unread"}`, () => openEntry(entry));
      card.setAttribute("aria-label", `${titleOf(item)}, ${read ? "letto" : "da leggere"}`);
      card.append(element("span", "noticeboard-card-title", titleOf(item)));
      const meta = element("span", "noticeboard-card-meta");
      meta.append(element("span", read ? "noticeboard-read" : "noticeboard-unread",
        read ? "Letto" : "Da leggere"));
      const date = formattedDate(dateOf(item));
      if (date) meta.append(element("span", "noticeboard-date", date));
      const category = textValue(firstValue(item, ["cntCategory", "category", "type"]));
      if (category) meta.append(element("span", "noticeboard-category", category));
      if (isRequired(item, "needReply")) meta.append(element("span", "noticeboard-action-tag", "Risposta"));
      if (isRequired(item, "needJoin")) meta.append(element("span", "noticeboard-action-tag", "Conferma"));
      if (isRequired(item, "needFile")) meta.append(element("span", "noticeboard-action-tag", "Allegato richiesto"));
      if (isRequired(item, "needSign")) meta.append(element("span", "noticeboard-action-tag", "Firma"));
      card.append(meta);
      list.append(card);
    }
    root().append(list);
  }

  function appendAttachmentButtons(container, entry) {
    const { item } = entry;
    const attachments = Array.isArray(item.attachments) ? item.attachments : [];
    if (!attachments.length) return;
    const section = element("section", "noticeboard-attachments");
    section.append(element("h2", "", "Allegati"));
    for (const attachment of attachments) {
      const fileName = textValue(firstValue(attachment, ["fileName", "filename", "name", "attachmentName"]))
        || "Allegato";
      const download = button(`↓  ${fileName}`, "noticeboard-download", async () => {
        let path;
        const pubId = item.pubId;
        const attachNum = attachment.attachNum;
        if (!/^\d+$/.test(String(pubId ?? "")) || !/^\d+$/.test(String(attachNum ?? ""))
            || !/^[A-Za-z0-9_-]{1,32}$/.test(String(item.evtCode ?? ""))) {
          showDetailError("Dati dell’allegato non validi.");
          return;
        }
        path = `/api/noticeboard/attachment/${encodeURIComponent(item.evtCode)}/${pubId}/${attachNum}`;
        download.disabled = true;
        try {
          const response = await fetchApi(path);
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || "Download non riuscito.");
          }
          const url = URL.createObjectURL(await response.blob());
          const link = element("a");
          link.href = url;
          link.download = fileName.replace(/[\\/]/g, "_");
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
          showDetailError(error.message || "Download non riuscito.");
        } finally {
          download.disabled = false;
        }
      });
      section.append(download);
    }
    container.append(section);
  }

  function renderActions(detail) {
    const item = selected.item;
    const needsReply = isRequired(item, "needReply");
    const needsJoin = isRequired(item, "needJoin");
    const needsFile = isRequired(item, "needFile");
    const needsSign = isRequired(item, "needSign");
    if ((!needsReply && !needsJoin && !needsFile && !needsSign) || selected.completed) return;

    const form = element("form", "noticeboard-response");
    form.append(element("h3", "", "Richiesta di risposta"));
    if (needsReply) {
      const label = element("label", "", "La tua risposta");
      const textarea = element("textarea", "noticeboard-reply-input");
      textarea.name = "replText";
      textarea.maxLength = 4000;
      textarea.required = true;
      textarea.value = selected.content?.reply?.replText || "";
      label.append(textarea);
      form.append(label);
    }
    if (needsJoin) {
      const label = element("label", "", "Conferma");
      const choice = element("select", "noticeboard-reply-input");
      choice.name = "replJoin";
      choice.required = true;
      const placeholder = element("option", "", "Seleziona una risposta");
      placeholder.value = "";
      choice.append(placeholder);
      for (const [value, text] of [["true", "Confermo"], ["false", "Non confermo"]]) {
        const option = element("option", "", text);
        option.value = value;
        choice.append(option);
      }
      label.append(choice);
      form.append(label);
    }
    if (needsFile) {
      const label = element("label", "", "Allega un file");
      const file = element("input", "noticeboard-reply-input");
      file.type = "file";
      file.name = "replFile";
      file.required = true;
      label.append(file);
      form.append(label);
    }
    if (needsSign) {
      const label = element("label", "noticeboard-sign-confirm");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.name = "replSign";
      checkbox.required = true;
      checkbox.checked = Boolean(selected.content?.reply?.replSign);
      label.append(checkbox, document.createTextNode(" Confermo e firmo la comunicazione"));
      form.append(label);
    }
    const status = element("p", "noticeboard-response-status");
    status.setAttribute("role", "status");
    form.append(status);
    const submit = button("Invia", "noticeboard-submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || selected.submitting) return;
      const currentOperation = operation;
      const scope = selected.scope;
      const payload = {};
      if (needsReply) payload.replText = form.elements.replText.value.trim();
      if (needsJoin) payload.replJoin = form.elements.replJoin.value === "true";
      if (needsSign) payload.replSign = form.elements.replSign.checked;
      selected.submitting = true;
      submit.disabled = true;
      status.classList.remove("error");
      status.textContent = "Invio in corso…";
      try {
        if (needsFile) {
          const file = form.elements.replFile.files[0];
          if (file.size > 10 * 1024 * 1024) throw new Error("Il file supera il limite di 10 MB.");
          payload.replFile = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Impossibile leggere il file selezionato."));
            reader.readAsDataURL(file);
          });
        }
        if (currentOperation !== operation || !selected) return;
        const response = await api(
          `/api/noticeboard/${encodeURIComponent(item.evtCode)}/${item.pubId}/read`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        );
        const body = await response.json().catch(() => ({}));
        if (currentOperation !== operation || !selected) return;
        if (!response.ok) throw new Error(body.detail || "Impossibile inviare la risposta.");
        selected.content = body;
        selected.completed = true;
        selected.item.readStatus = true;
        selected.success = "Risposta inviata.";
        await cacheNoticeContent(selected.item, body, scope, true);
        await cacheNoticeList(scope);
        if (currentOperation !== operation || !selected) return;
        renderList();
        Sheet.update(...renderDetailNodes());
      } catch (error) {
        if (currentOperation !== operation || !selected) return;
        selected.submitting = false;
        status.classList.add("error");
        status.textContent = error.message || "Impossibile inviare la risposta.";
        submit.disabled = false;
      }
    });
    form.append(submit);
    detail.append(form);
  }

  function renderDetailNodes() {
    const detail = element("article", "noticeboard-detail");
    detail.append(element("h2", "sheet-title", titleOf(selected.item)));
    const meta = element("div", "noticeboard-detail-meta");
    const date = formattedDate(dateOf(selected.item));
    if (date) meta.append(element("span", "", date));
    const category = textValue(firstValue(selected.item, ["cntCategory", "category", "type"]));
    if (category) meta.append(element("span", "", category));
    detail.append(meta);
    const text = selected.content?.item?.text || bodyOf(selected.item);
    detail.append(element("div", "noticeboard-detail-text",
      typeof text === "string" ? text : textValue(text)));
    if (selected.loading) detail.append(element("p", "noticeboard-loading", "Caricamento del contenuto…"));
    if (selected.error) detail.append(element("p", "noticeboard-error", selected.error));
    if (selected.success) detail.append(element("p", "noticeboard-response-success", selected.success));
    if (selected.content?.reply?.replText) {
      detail.append(element("h2", "noticeboard-reply-title", "La tua risposta"));
      detail.append(element("div", "noticeboard-detail-text", selected.content.reply.replText));
    }
    appendAttachmentButtons(detail, selected);
    renderActions(detail);
    return [detail];
  }

  function render() {
    root().replaceChildren();
    renderHeader();
    renderSearch();
    if (loading && loadingVisible) {
      root().append(element("p", "noticeboard-loading", "Caricamento della bacheca…"));
    } else if (loadError) {
      root().append(element("p", "noticeboard-error", loadError));
      root().append(button("Riprova", "noticeboard-retry", load));
    } else if (data) {
      renderList();
    }
  }

  function showDetailError(message) {
    if (!selected) return;
    selected.error = message;
    Sheet.update(...renderDetailNodes());
  }

  async function openEntry(entry) {
    const currentOperation = ++operation;
    const scope = cacheScope;
    selected = { ...entry, scope, loading: true, content: null, error: "" };
    Sheet.open(...renderDetailNodes());
    try {
      const contentKey = noticeContentCacheKey(entry.item, scope);
      if (contentKey) {
        try {
          const cached = await dbGet(contentKey);
          if (currentOperation !== operation || !selected) return;
          if (cached?.data) {
            const { _responseCompleted, ...content } = cached.data;
            selected.content = content;
            selected.completed = _responseCompleted === true;
            selected.loading = false;
            selected.item.readStatus = true;
            await cacheNoticeList(scope);
            if (currentOperation !== operation || !selected) return;
            renderList();
            Sheet.update(...renderDetailNodes());
          }
        } catch (error) {
          console.error("Impossibile leggere il contenuto della comunicazione dalla cache.", error);
        }
      }
      const response = await api(
        `/api/noticeboard/${encodeURIComponent(entry.item.evtCode)}/${entry.item.pubId}/read`,
        { method: "POST" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Impossibile aprire l’avviso.");
      if (currentOperation !== operation || !selected) return;
      const changed = !sameJsonValue(selected.content, body);
      const wasLoading = selected.loading;
      selected.content = body;
      selected.loading = false;
      selected.item.readStatus = true;
      selected.error = "";
      const notice = selected.item;
      await cacheNoticeContent(notice, body, scope, selected.completed === true);
      await cacheNoticeList(scope);
      if (currentOperation !== operation || !selected) return;
      renderList();
      if (changed || wasLoading) Sheet.update(...renderDetailNodes());
    } catch (error) {
      if (currentOperation !== operation || !selected) return;
      selected.loading = false;
      selected.error = error.message || "Impossibile aprire l’avviso.";
      Sheet.update(...renderDetailNodes());
    }
  }

  function closeDetail() {
    operation++;
    selected = null;
    Sheet.close();
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
    loading = true;
    loadingVisible = false;
    pendingData = null;
    loadError = "";
    render();
    const loadingTimer = setTimeout(() => {
      if (!loading) return;
      loadingVisible = true;
      render();
    }, 300);
    try {
      const response = await api("/api/noticeboard");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Impossibile caricare la bacheca.");
      data = pendingData || body;
      await cacheNoticeList();
    } catch (error) {
      loadError = error.message || "Impossibile caricare la bacheca.";
    } finally {
      clearTimeout(loadingTimer);
      loading = false;
      loadingVisible = false;
      pendingData = null;
      render();
    }
    })();
    try {
      await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  function open() {
    selected = null;
    searchTerm = "";
    searchOpen = false;
    return load();
  }

  async function openEntryByIdentity(evtCode, pubId) {
    if (evtCode == null || pubId == null) return false;
    if (!data) await load();
    const item = data?.items?.find((entry) => (
      String(entry.evtCode) === String(evtCode) && String(entry.pubId) === String(pubId)
    ));
    if (!item) return false;
    await openEntry({ item });
    return true;
  }

  window.addEventListener("bv-api-cache-update", ({ detail }) => {
    if (detail.path !== "/api/noticeboard") return;
    data = detail.data;
    if (loading) {
      pendingData = detail.data;
      return;
    }
    if (!loading && !$("view-noticeboard").hidden) render();
  });

  window.addEventListener("bv-sheet-close", () => {
    if (!selected) return;
    selected = null;
    operation++;
  });

  return {
    open,
    openEntryByIdentity,
  };
})();
