import { createApp } from "vue";
import App from "./App.vue";
import { monthRange } from "./calendar-range.js";

window.BetterVivaCalendar = { monthRange };

const legacyScripts = [
  "/static/sheet.js",
  "/static/home.js",
  "/static/settings.js",
  "/static/app.js",
];

function loadScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Impossibile caricare ${source}`));
    document.body.append(script);
  });
}

createApp(App).mount("#app");

for (const source of legacyScripts) {
  await loadScript(source);
}

if ("serviceWorker" in navigator) {
  const register = () => navigator.serviceWorker.register("/sw.js")
    .catch((error) => console.error("Registrazione del service worker non riuscita.", error));
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
