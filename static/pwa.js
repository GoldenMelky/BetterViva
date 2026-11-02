"use strict";
if ("serviceWorker" in navigator) {
  let registration;
  let reloading = false;
  let hadController = Boolean(navigator.serviceWorker.controller);

  function checkForUpdates() {
    if (navigator.onLine) registration?.active?.postMessage({ type: "CHECK_FOR_UPDATES" });
  }

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  }

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "ASSETS_UPDATED") reloadOnce();
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) reloadOnce();
    hadController = true;
  });
  window.addEventListener("online", checkForUpdates);

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(async (result) => {
        registration = result;
        await navigator.serviceWorker.ready;
        checkForUpdates();
      })
      .catch((error) => console.error("Registrazione del service worker non riuscita.", error));
  });
}
