<script setup>
import { onMounted, onUnmounted, ref } from "vue";

defineProps({ visible: { type: Boolean, required: true } });

const username = ref("");
const password = ref("");
const secureContext = !!window.crypto?.subtle;
const remember = ref(secureContext);
const busy = ref(false);
const error = ref("");
const hint = ref("Le credenziali restano cifrate in questo browser. Il server non le salva.");

function showLoginError(event) {
  error.value = event.detail;
}

function clearPassword() {
  password.value = "";
}

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    await window.BetterViva.login(username.value.trim(), password.value, remember.value);
    password.value = "";
  } catch (loginError) {
    error.value = loginError.message || "Accesso non riuscito.";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  window.addEventListener("bv-login-error", showLoginError);
  window.addEventListener("bv-clear-login-password", clearPassword);
  if (!secureContext) {
    hint.value = "Connessione non sicura (HTTP): le credenziali non possono essere salvate e dovrai accedere ogni volta. Apri il sito in HTTPS per attivare il salvataggio.";
  }
});
onUnmounted(() => {
  window.removeEventListener("bv-login-error", showLoginError);
  window.removeEventListener("bv-clear-login-password", clearPassword);
});
</script>

<template>
  <section id="view-login" :hidden="!visible">
    <h1>Accedi con ClasseViva</h1>
    <form id="login-form" class="card" @submit.prevent="submit">
      <label for="username">Username</label>
      <input id="username" v-model="username" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required>

      <label for="password">Password</label>
      <input id="password" v-model="password" name="password" type="password" autocomplete="current-password" required>

      <label class="check">
        <input id="remember" v-model="remember" type="checkbox" :disabled="!secureContext">
        <span>Resta connesso su questo dispositivo</span>
      </label>
      <p class="hint">{{ hint }}</p>

      <p id="login-error" class="error" role="alert" :hidden="!error">{{ error }}</p>
      <button id="login-btn" type="submit" :disabled="busy">{{ busy ? "Accesso in corso…" : "Accedi" }}</button>
    </form>
  </section>
</template>
