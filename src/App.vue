<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import GradesView from "./components/GradesView.vue";
import HomeView from "./components/HomeView.vue";
import LoginView from "./components/LoginView.vue";
import SettingsView from "./components/SettingsView.vue";
import SetupView from "./components/SetupView.vue";

const activeView = ref("login");
const menuOpen = ref(false);
const settingsOnBack = ref(() => {});
const setupOptions = ref({ mode: "initial", firstName: "", onDone: () => {} });
const setView = (event) => {
  activeView.value = event.detail;
  menuOpen.value = false;
};
const openSettings = (event) => {
  activeView.value = "settings";
  settingsOnBack.value = event.detail.onBack;
};
const openSetup = (event) => {
  activeView.value = "setup";
  setupOptions.value = event.detail;
};
const closeMenu = () => {
  menuOpen.value = false;
};
const goHome = () => {
  closeMenu();
  window.BetterViva.goHome();
};
const goGrades = () => {
  closeMenu();
  window.BetterViva.goGrades();
};
const goSettings = () => {
  closeMenu();
  window.BetterViva.goSettings();
};
const goBack = () => window.BetterViva.goBack();
const logout = () => window.BetterViva.logout();

onMounted(() => {
  window.addEventListener("bv-view-change", setView);
  window.addEventListener("bv-open-settings", openSettings);
  window.addEventListener("bv-open-setup", openSetup);
});
onUnmounted(() => {
  window.removeEventListener("bv-view-change", setView);
  window.removeEventListener("bv-open-settings", openSettings);
  window.removeEventListener("bv-open-setup", openSetup);
});
</script>

<template>
  <header class="top">
    <div class="brand">
      <span class="logo">BetterViva</span>
      <span id="sync-status" class="sync-status" role="status" aria-live="polite">Aggiornamento…</span>
    </div>
    <button id="settings-button" class="header-button" type="button" :hidden="activeView !== 'home'" aria-label="Impostazioni" title="Impostazioni" @click="goSettings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>
    </button>
    <button id="avatar" class="avatar" :hidden="!['home', 'grades', 'setup', 'settings'].includes(activeView)" aria-label="Esci" title="Esci" @click="logout"></button>
    <button id="back-button" class="header-button" type="button" :hidden="['home', 'login'].includes(activeView)" aria-label="Indietro" title="Indietro" @click="goBack">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    </button>
    <button id="menu-button" class="menu-button" type="button" :hidden="!['home', 'grades', 'settings', 'setup'].includes(activeView)" :aria-expanded="String(menuOpen)" aria-controls="app-menu" aria-label="Apri menu" @click="menuOpen = !menuOpen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  </header>
  <div id="connection-toast" class="connection-toast" role="status" aria-live="polite" hidden></div>

  <nav id="app-menu" class="app-menu" :hidden="!menuOpen" aria-label="Navigazione">
    <button id="menu-home" type="button" @click="goHome">Home</button>
    <button id="menu-grades" type="button" @click="goGrades">Voti</button>
    <button id="menu-settings" type="button" @click="goSettings">Impostazioni</button>
  </nav>
  <main>
    <LoginView :visible="activeView === 'login'" />
    <SetupView
      :visible="activeView === 'setup'"
      :mode="setupOptions.mode"
      :first-name="setupOptions.firstName"
      :on-done="setupOptions.onDone"
    />
    <SettingsView :visible="activeView === 'settings'" :on-back="settingsOnBack" />
    <GradesView :visible="activeView === 'grades'" />
    <HomeView :visible="activeView === 'home'" />
    <p id="status" class="status">Caricamento…</p>
  </main>
</template>
