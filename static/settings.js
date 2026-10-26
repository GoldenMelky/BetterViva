"use strict";

const Settings = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const actionButton = (label, onClick, cls = "primary") => {
    const button = el("button", cls, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  };

  function open(onBack) {
    const root = $("settings-body");
    const title = el("h1", null, "Impostazioni");
    const lead = el("p", "lead", "Personalizza BetterViva.");
    const subjects = el("button", "primary settings-edit", "Configura le materie");
    subjects.type = "button";
    subjects.addEventListener("click", () => {
      show("setup");
      Setup.editSubjects(() => open(onBack));
    });
    const timetable = el("button", "primary settings-edit", "Configura l’orario");
    timetable.type = "button";
    timetable.addEventListener("click", () => {
      show("setup");
      Setup.editTimetable(() => open(onBack));
    });
    const averageLabel = el("label", "settings-average-label", "Media generale");
    averageLabel.htmlFor = "grade-average-mode";
    const averageMode = document.createElement("select");
    averageMode.id = "grade-average-mode";
    averageMode.className = "settings-average-mode";
    averageMode.setAttribute("aria-describedby", "grade-average-hint");
    for (const [value, label] of [
      ["all_grades", "Media di tutti i voti"],
      ["average_of_averages", "Media delle medie per materia"],
    ]) {
      const option = el("option", null, label);
      option.value = value;
      averageMode.append(option);
    }
    averageMode.value = "all_grades";
    averageMode.disabled = true;
    const averageHint = el("p", "settings-average-hint", "Scegli come calcolare la media generale dei voti.");
    averageHint.id = "grade-average-hint";
    averageMode.addEventListener("change", async () => {
      const previousMode = averageMode.dataset.saved || "all_grades";
      averageMode.disabled = true;
      try {
        const res = await api("/api/settings/grade-average-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: averageMode.value }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Impossibile salvare l’impostazione. Riprova.");
        }
        averageMode.dataset.saved = averageMode.value;
        averageHint.textContent = "Impostazione salvata.";
      } catch (error) {
        averageMode.value = previousMode;
        averageHint.textContent = error instanceof LoginError
          ? "Sessione scaduta. Accedi di nuovo."
          : error.message || "Impossibile salvare l’impostazione. Riprova.";
      } finally {
        averageMode.disabled = false;
      }
    });
    averageMode.dataset.saved = averageMode.value;
    api("/api/me").then(async (res) => {
      if (!res.ok) throw new Error("Impossibile caricare la preferenza della media.");
      const profile = await res.json();
      averageMode.value = profile.grade_average_mode === "average_of_averages"
        ? "average_of_averages"
        : "all_grades";
      averageMode.dataset.saved = averageMode.value;
      averageMode.disabled = false;
    }).catch((error) => {
      averageHint.textContent = error instanceof LoginError
        ? "Sessione scaduta. Accedi di nuovo."
        : error.message || "Impossibile caricare la preferenza della media.";
      averageMode.disabled = false;
    });
    const back = el("button", "secondary", "Torna alla home");
    back.type = "button";
    back.addEventListener("click", onBack);
    const footer = el("div", "settings-footer");
    footer.append(back);
    root.replaceChildren(title, lead, subjects, timetable, averageLabel, averageMode, averageHint, footer);
    show("settings");
  }

  function promptColorSetup(onComplete) {
    const backdrop = el("div", "color-prompt-backdrop");
    const dialog = el("section", "color-prompt");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "color-prompt-title");
    dialog.setAttribute("aria-describedby", "color-prompt-description");

    const title = el("h2", null, "Scegli i colori delle materie");
    title.id = "color-prompt-title";
    const description = el("p", null, "Puoi assegnare un colore a ogni materia per riconoscere più facilmente gli eventi. Se preferisci, potrai farlo più tardi dalle impostazioni.");
    description.id = "color-prompt-description";
    const error = el("p", "error color-prompt-error");
    error.hidden = true;
    error.setAttribute("role", "alert");
    const actions = el("div", "color-prompt-actions");
    const later = actionButton("Più tardi", dismiss, "secondary");
    const configure = actionButton("Configura ora", () => {
      backdrop.remove();
      show("setup");
      Setup.editSubjects(onComplete);
    });
    actions.append(later, configure);
    dialog.append(title, description, error, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    configure.focus();

    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const buttons = [later, configure].filter((button) => !button.disabled);
      if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
        event.preventDefault();
        buttons[0].focus();
      }
    });

    async function dismiss() {
      later.disabled = configure.disabled = true;
      error.hidden = true;
      try {
        const res = await api("/api/settings/color-prompt-dismissed", { method: "PUT" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Impossibile salvare la scelta. Riprova.");
        }
        backdrop.remove();
        onComplete();
      } catch (err) {
        if (err instanceof LoginError) {
          backdrop.remove();
          showLogin(err.message);
          return;
        }
        error.textContent = err.message || "Impossibile salvare la scelta. Riprova.";
        error.hidden = false;
        later.disabled = configure.disabled = false;
      }
    }
  }

  return { open, promptColorSetup };
})();
