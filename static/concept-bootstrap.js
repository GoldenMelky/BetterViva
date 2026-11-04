"use strict";

(() => {
  const app = document.getElementById("app");
  const views = app.querySelector(".views");
  const gradeView = app.querySelector("#view-voti");
  const demoStub = app.querySelector("#view-stub");
  const createView = (id, label) => {
    const section = document.createElement("section");
    section.className = "view concept-page";
    section.id = id;
    section.setAttribute("aria-label", label);
    section.hidden = true;
    return section;
  };
  const appendText = (parent, tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.append(node);
    return node;
  };

  document.documentElement.dataset.bvConcept = "";
  app.dataset.conceptShell = "true";
  app.querySelector('[data-sheet="notifiche"]').id = "notifications-button";
  app.querySelector(".avatar").id = "avatar";
  app.querySelector("#sub").id = "sync-status";

  const homeView = createView("view-home", "Home");
  homeView.className = "concept-home";
  homeView.hidden = false;
  views.replaceWith(homeView);
  homeView.append(views);
  gradeView.id = "view-grades";
  app.append(gradeView);
  demoStub.remove();

  const noticeboardView = createView("view-noticeboard", "Bacheca");
  const noticeboardBody = document.createElement("div");
  noticeboardBody.id = "noticeboard-body";
  noticeboardView.append(noticeboardBody);
  app.append(noticeboardView);

  const stubView = createView("view-stub", "Sezione non ancora disponibile");
  stubView.classList.add("concept-stub");
  app.append(stubView);

  const settingsView = createView("view-settings", "Impostazioni");
  const settingsBody = document.createElement("div");
  settingsBody.id = "settings-body";
  settingsView.append(settingsBody);
  app.append(settingsView);

  const setupView = createView("view-setup", "Configurazione iniziale");
  const setupBody = document.createElement("div");
  setupBody.id = "setup-body";
  setupView.append(setupBody);
  app.append(setupView);

  const loginView = createView("view-login", "Accedi");
  const loginForm = document.createElement("form");
  loginForm.id = "login-form";
  loginForm.className = "concept-login";
  appendText(loginForm, "h1", "", "Accedi con ClasseViva");
  const usernameLabel = appendText(loginForm, "label", "", "Username");
  usernameLabel.htmlFor = "username";
  const username = document.createElement("input");
  username.id = "username";
  username.name = "username";
  username.autocomplete = "username";
  username.required = true;
  loginForm.append(username);
  const passwordLabel = appendText(loginForm, "label", "", "Password");
  passwordLabel.htmlFor = "password";
  const password = document.createElement("input");
  password.id = "password";
  password.name = "password";
  password.type = "password";
  password.autocomplete = "current-password";
  password.required = true;
  loginForm.append(password);
  const rememberLabel = document.createElement("label");
  rememberLabel.className = "concept-remember";
  const remember = document.createElement("input");
  remember.id = "remember";
  remember.type = "checkbox";
  remember.checked = true;
  rememberLabel.append(remember, document.createTextNode("Resta connesso su questo dispositivo"));
  loginForm.append(rememberLabel);
  appendText(loginForm, "p", "hint", "Le credenziali restano cifrate in questo browser. Il server non le salva.");
  const loginError = appendText(loginForm, "p", "error", "");
  loginError.id = "login-error";
  loginError.hidden = true;
  loginError.setAttribute("role", "alert");
  const loginButton = appendText(loginForm, "button", "primary", "Accedi");
  loginButton.id = "login-btn";
  loginButton.type = "submit";
  loginForm.append(loginButton);
  loginView.append(loginForm);
  app.append(loginView);

  const debugView = createView("view-debug", "Debug");
  debugView.classList.add("legacy-only");
  app.append(debugView);

  const status = document.createElement("p");
  status.id = "status";
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  app.append(status);

  const toast = document.createElement("div");
  toast.id = "connection-toast";
  toast.className = "concept-toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  app.append(toast);

  const bridge = document.createElement("div");
  bridge.id = "bv-core-bridge";
  bridge.className = "legacy-bridge";
  bridge.hidden = true;
  bridge.innerHTML = `
    <button id="feedback-button" type="button" hidden></button>
    <button id="back-button" type="button" hidden></button>
    <button id="menu-button" type="button" hidden></button>
    <nav id="app-menu" hidden>
      <button id="menu-home" type="button"></button>
      <button id="menu-grades" type="button"></button>
      <button id="menu-noticeboard" type="button"></button>
      <button id="menu-settings" type="button"></button>
      <button id="menu-debug" type="button" hidden></button>
    </nav>
    <button id="debug-add-task" type="button"></button>
    <button id="debug-add-grade" type="button"></button>
    <button id="debug-add-notice" type="button"></button>
    <button id="debug-clear-notifications" type="button"></button>
    <p id="debug-notifications-status"></p><pre id="debug-notifications-info"></pre>
    <div id="days"></div><div id="panels"></div><div id="evlist"></div>
    <button id="mode-toggle" type="button"></button><button id="today-button" type="button"></button>
    <section id="cal-native"><div id="cal-month-title"></div><button id="cal-prev"></button>
      <button id="cal-next"></button><div id="cal-scroll"><div id="cal-months"></div></div></section>
    <div id="grades-body"></div>
    <dialog id="feedback-dialog"><form id="feedback-form">
      <textarea id="feedback-message"></textarea><p id="feedback-status"></p>
      <button id="feedback-send" type="submit"></button><button id="feedback-close" type="button"></button>
    </form></dialog>
    <dialog id="notifications-dialog">
      <button id="notifications-close" type="button"></button>
      <div id="notifications-list"></div><button id="notifications-clear" type="button"></button>
    </dialog>`;
  app.append(bridge);
  app.querySelector('[data-sheet="notifiche"] .badge').id = "notifications-count";

  const feedback = app.querySelector('[data-sheet="feedback"]');
  feedback.dataset.feedbackOpen = "true";
})();
