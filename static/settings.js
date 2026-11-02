"use strict";

const Settings = (() => {
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
      window.BetterViva.openSetup("subjects", onComplete);
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

  return { promptColorSetup };
})();
