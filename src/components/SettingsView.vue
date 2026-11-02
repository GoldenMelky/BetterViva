<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  visible: { type: Boolean, required: true },
  onBack: { type: Function, required: true },
});

const averageMode = ref("all_grades");
const savedMode = ref("all_grades");
const averageHint = ref("Scegli come calcolare la media generale dei voti.");
const loading = ref(false);
const saving = ref(false);

function returnToSettings() {
  if (history.state?.bvApp && history.state.view === "setup") {
    history.back();
  } else {
    window.BetterViva.openSettings(props.onBack);
  }
}

function editSubjects() {
  window.BetterViva.openSetup("subjects", returnToSettings);
}

function editTimetable() {
  window.BetterViva.openSetup("timetable", returnToSettings);
}

async function loadAverageMode() {
  loading.value = true;
  try {
    const response = await window.BetterViva.api("/api/me");
    if (!response.ok) throw new Error("Impossibile caricare la preferenza della media.");
    const profile = await response.json();
    const mode = profile.grade_average_mode === "average_of_averages"
      ? "average_of_averages"
      : "all_grades";
    averageMode.value = mode;
    savedMode.value = mode;
    averageHint.value = "Scegli come calcolare la media generale dei voti.";
  } catch (error) {
    averageHint.value = window.BetterViva.isLoginError(error)
      ? "Sessione scaduta. Accedi di nuovo."
      : error.message || "Impossibile caricare la preferenza della media.";
  } finally {
    loading.value = false;
  }
}

async function saveAverageMode() {
  const previousMode = savedMode.value;
  saving.value = true;
  averageHint.value = "Salvataggio…";
  try {
    const response = await window.BetterViva.api("/api/settings/grade-average-mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: averageMode.value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || "Impossibile salvare l’impostazione. Riprova.");
    }
    savedMode.value = averageMode.value;
    averageHint.value = "Impostazione salvata.";
  } catch (error) {
    averageMode.value = previousMode;
    averageHint.value = window.BetterViva.isLoginError(error)
      ? "Sessione scaduta. Accedi di nuovo."
      : error.message || "Impossibile salvare l’impostazione. Riprova.";
  } finally {
    saving.value = false;
  }
}

watch(() => props.visible, (visible) => {
  if (visible) void loadAverageMode();
});
</script>

<template>
  <section id="view-settings" :hidden="!props.visible">
    <h1>Impostazioni</h1>
    <p class="lead">Personalizza BetterViva.</p>
    <button class="primary settings-edit" type="button" @click="editSubjects">Configura le materie</button>
    <button class="primary settings-edit" type="button" @click="editTimetable">Configura l’orario</button>
    <label class="settings-average-label" for="grade-average-mode">Media generale</label>
    <select
      id="grade-average-mode"
      v-model="averageMode"
      class="settings-average-mode"
      aria-describedby="grade-average-hint"
      :disabled="loading || saving"
      @change="saveAverageMode"
    >
      <option value="all_grades">Media di tutti i voti</option>
      <option value="average_of_averages">Media delle medie per materia</option>
    </select>
    <p id="grade-average-hint" class="settings-average-hint" aria-live="polite">{{ averageHint }}</p>
    <div class="settings-footer">
      <button class="secondary" type="button" @click="props.onBack">Torna alla home</button>
    </div>
  </section>
</template>
