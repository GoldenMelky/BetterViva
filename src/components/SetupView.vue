<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";

const props = defineProps({
  visible: { type: Boolean, required: true },
  mode: { type: String, required: true },
  firstName: { type: String, default: "" },
  onDone: { type: Function, required: true },
});

const days = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const colors = [
  ["red", "Rosso", "#A8342B"], ["green", "Verde", "#399456"],
  ["blue", "Blu", "#3478B9"], ["yellow", "Giallo", "#B69A31"],
  ["brown", "Marrone", "#93653D"], ["purple", "Viola", "#8854AA"],
  ["orange", "Arancione", "#C16C2C"], ["teal", "Turchese", "#2D898B"],
  ["pink", "Rosa", "#A44D70"],
];
const data = ref(null);
const subjects = ref([]);
const config = reactive({});
const picks = reactive({});
const flagged = ref(new Set());
const step = ref(0);
const error = ref("");
const loading = ref(false);
const saving = ref(false);
const editingName = ref(null);
const openColorId = ref(null);
const dirty = ref(false);
const savedConfiguration = ref(null);
const dayIndex = computed(() => step.value - 2);
const currentDay = computed(() => data.value?.days[dayIndex.value]);
const isInitial = computed(() => props.mode === "initial");

function key(weekday, hour) {
  return `${weekday}-${hour}`;
}

function subjectName(subject) {
  return (config[subject.id]?.name || "").trim() || subject.short || subject.name;
}

function labName(subject) {
  return `Lab ${subjectName(subject).toLowerCase()}`;
}

function colorName(value) {
  return colors.find(([id]) => id === value)?.[1] || "Nessun colore";
}

function initializeConfig(list) {
  Object.keys(config).forEach((id) => delete config[id]);
  list.forEach((subject) => {
    config[subject.id] = { name: subject.short || subject.name, lab: !!subject.lab, color: "" };
  });
}

function setProposal(proposal) {
  data.value = proposal;
  subjects.value = proposal.subjects;
  initializeConfig(subjects.value);
  Object.keys(picks).forEach((cell) => delete picks[cell]);
  flagged.value = new Set();
  proposal.cells.forEach((cell) => {
    const cellKey = key(cell.weekday, cell.hpos);
    picks[cellKey] = cell.subject_id == null
      ? ""
      : `${cell.subject_id}${cell.lab ? ":lab" : ""}`;
    if (cell.status !== "ok") flagged.value.add(cellKey);
  });
}

function applySavedConfiguration(saved) {
  if (!data.value) return;
  savedConfiguration.value = saved;
  const savedSubjects = saved.subjects || {};
  subjects.value.forEach((subject) => {
    const current = savedSubjects[String(subject.id)] || {};
    config[subject.id] = {
      name: current.name || saved.names?.[String(subject.id)] || subject.short || subject.name,
      lab: !!current.lab,
      color: current.color || "",
    };
  });

  const cellsByKey = new Map((saved.cells || []).map((cell) => [key(cell.weekday, cell.hpos), cell]));
  const weekdays = [...new Set([
    ...data.value.days,
    ...(saved.cells || []).map((cell) => cell.weekday),
  ])].sort((a, b) => a - b);
  const slots = Math.max(data.value.slots, ...(saved.cells || []).map((cell) => cell.hpos), 1);
  const proposed = new Map(data.value.cells.map((cell) => [key(cell.weekday, cell.hpos), cell]));
  data.value = {
    ...data.value,
    days: weekdays,
    slots,
    cells: weekdays.flatMap((weekday) => Array.from({ length: slots }, (_, index) => {
      const hour = index + 1;
      const cellKey = key(weekday, hour);
      const proposal = proposed.get(cellKey) || {
        weekday, hpos: hour, candidates: [], status: "empty",
      };
      const current = cellsByKey.get(cellKey);
      return {
        ...proposal,
        subject_id: current?.subject_id ?? null,
        subject: current?.subject ?? null,
        lab: !!current?.lab,
      };
    })),
  };
  Object.keys(picks).forEach((cell) => delete picks[cell]);
  data.value.cells.forEach((cell) => {
    picks[key(cell.weekday, cell.hpos)] = cell.subject_id == null
      ? ""
      : `${cell.subject_id}${cell.lab ? ":lab" : ""}`;
  });
  flagged.value = new Set();
}

async function loadProposal() {
  const response = await window.BetterViva.api("/api/setup/timetable");
  if (!response.ok) throw new Error("Impossibile leggere le lezioni da ClasseViva.");
  setProposal(await response.json());
}

async function initialize() {
  loading.value = true;
  error.value = "";
  dirty.value = false;
  data.value = null;
  savedConfiguration.value = null;
  step.value = isInitial.value ? 0 : -1;
  if (isInitial.value) {
    loading.value = false;
    return;
  }
  try {
    await loadProposal();
    const response = await window.BetterViva.api("/api/timetable");
    if (!response.ok) throw new Error("Impossibile leggere l'orario salvato.");
    applySavedConfiguration(await response.json());
    step.value = props.mode === "subjects" ? 1 : 2;
  } catch (reason) {
    if (window.BetterViva.isLoginError(reason)) {
      window.BetterViva.showLogin(reason.message);
    } else {
      error.value = reason.message || "Impossibile caricare l'orario.";
    }
  } finally {
    loading.value = false;
  }
}

async function begin() {
  loading.value = true;
  error.value = "";
  try {
    await loadProposal();
    step.value = 1;
  } catch (reason) {
    if (window.BetterViva.isLoginError(reason)) {
      window.BetterViva.showLogin(reason.message);
    } else {
      error.value = "Non riesco a leggere le lezioni da ClasseViva. Riprova tra poco.";
    }
  } finally {
    loading.value = false;
  }
}

function sanitize(value) {
  if (value?.endsWith(":lab")) {
    const id = Number(value.slice(0, -4));
    return config[id]?.lab ? value : String(id);
  }
  return value ?? "";
}

function candidatesFor(weekday, hour) {
  const cell = data.value.cells.find((item) => item.weekday === weekday && item.hpos === hour);
  const candidateIds = cell?.candidates || [];
  return {
    probable: candidateIds.map((id) => subjects.value.find((subject) => subject.id === id)).filter(Boolean),
    rest: subjects.value.filter((subject) => !candidateIds.includes(subject.id)),
  };
}

function entriesFor(list) {
  return list.flatMap((subject) => [
    { value: String(subject.id), label: subjectName(subject) },
    ...(config[subject.id]?.lab
      ? [{ value: `${subject.id}:lab`, label: labName(subject) }]
      : []),
  ]);
}

function goBack() {
  if (!isInitial.value) {
    props.onDone();
    return;
  }
  if (step.value > 0) step.value--;
}

function goPreviousDay() {
  if (dayIndex.value > 0) step.value--;
}

function goNextDay() {
  if (dayIndex.value < data.value.days.length - 1) step.value++;
}

function disableLab(subjectId) {
  Object.keys(picks).forEach((cellKey) => {
    if (picks[cellKey] === `${subjectId}:lab`) picks[cellKey] = String(subjectId);
  });
  dirty.value = true;
}

function requestBack() {
  if (isInitial.value && step.value > 0) {
    step.value--;
    return true;
  }
  if (props.mode === "timetable" && step.value > 2) {
    step.value--;
    return true;
  }
  return false;
}

function createPayload(includeCells) {
  const payload = { subjects: {} };
  subjects.value.forEach((subject) => {
    const name = (config[subject.id].name || "").trim();
    payload.subjects[subject.id] = {
      name: name === subject.name ? null : name || null,
      lab: !!config[subject.id].lab,
      color: config[subject.id].color || null,
    };
  });
  if (includeCells) {
    payload.cells = [];
    data.value.days.forEach((weekday) => {
      for (let hour = 1; hour <= data.value.slots; hour++) {
        const value = sanitize(picks[key(weekday, hour)]);
        const lab = value.endsWith(":lab");
        payload.cells.push({
          weekday,
          hpos: hour,
          subject_id: value ? Number(lab ? value.slice(0, -4) : value) : null,
          lab,
        });
      }
    });
  }
  return payload;
}

async function save(includeCells) {
  saving.value = true;
  error.value = "";
  try {
    const response = await window.BetterViva.api(includeCells ? "/api/setup" : "/api/subjects", {
      method: includeCells ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload(includeCells)),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(typeof result.detail === "string"
        ? result.detail
        : includeCells ? "Impossibile salvare l'orario." : "Impossibile salvare le materie.");
    }
    dirty.value = false;
    props.onDone();
  } catch (reason) {
    if (window.BetterViva.isLoginError(reason)) {
      window.BetterViva.showLogin(reason.message);
    } else {
      error.value = reason.message || "Salvataggio non riuscito. Riprova.";
    }
  } finally {
    saving.value = false;
  }
}

function handleCacheUpdate({ detail }) {
  if (dirty.value) return;
  if (detail.path === "/api/setup/timetable") {
    setProposal(detail.data);
    if (savedConfiguration.value) applySavedConfiguration(savedConfiguration.value);
  } else if (detail.path === "/api/timetable" && data.value) {
    applySavedConfiguration(detail.data);
  }
}

watch(
  () => [props.visible, props.mode, props.firstName, props.onDone],
  ([visible]) => {
    if (visible) void initialize();
  },
  { immediate: true, flush: "post" },
);

onMounted(() => {
  window.BetterVivaSetup = { back: requestBack };
  window.addEventListener("bv-api-cache-update", handleCacheUpdate);
});
onUnmounted(() => {
  delete window.BetterVivaSetup;
  window.removeEventListener("bv-api-cache-update", handleCacheUpdate);
});
</script>

<template>
  <section id="view-setup" :hidden="!visible">
    <div id="setup-body">
      <template v-if="loading && step === -1">
        <h1>Modifica l'orario</h1>
        <p class="status">Carico i dati…</p>
      </template>
      <template v-else-if="step === 0">
        <h1 class="welcome">Ciao {{ firstName }},</h1>
        <p class="welcome-sub">grazie per usare BetterViva</p>
        <p class="hint">Prepariamo insieme materie e orario. Ti proponiamo già tutto noi: devi solo controllare.</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="nav">
          <button class="primary" type="button" :disabled="loading" @click="begin">
            {{ loading ? "Carico la proposta…" : "Inizia" }}
          </button>
        </div>
      </template>
      <template v-else-if="step === 1 && data">
        <h1>{{ isInitial ? "Configura le materie" : "Modifica le materie" }}</h1>
        <p class="lead"><b>Personalizza</b> le materie: rinominale, scegli un colore e segna quelle con laboratorio</p>
        <div class="cols">
          <span>Lab?</span><span>Materia · colore</span><span></span>
        </div>
        <div class="card rows">
          <div v-for="subject in subjects" :key="subject.id" class="subj">
            <label class="labbox">
              <input
                v-model="config[subject.id].lab"
                type="checkbox"
                :aria-label="`${subjectName(subject)}: ha il laboratorio`"
                @change="disableLab(subject.id)"
              >
              <i aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
              </i>
            </label>
            <div class="subject-config">
              <input
                v-if="editingName === subject.id"
                v-model="config[subject.id].name"
                type="text"
                maxlength="40"
                :aria-label="`Nome per ${subject.name}`"
                @blur="editingName = null"
                @keydown.enter.prevent="editingName = null"
                @input="dirty = true"
              >
              <span v-else class="name" :title="subject.name">{{ subjectName(subject) }}</span>
              <div class="subject-color-picker">
                <button
                  class="subject-color-trigger"
                  type="button"
                  :aria-expanded="String(openColorId === subject.id)"
                  aria-haspopup="listbox"
                  :aria-label="`Scegli il colore per ${subjectName(subject)}`"
                  @click="openColorId = openColorId === subject.id ? null : subject.id"
                >
                  <span
                    class="color-swatch"
                    :class="{ 'no-color': !config[subject.id].color }"
                    :style="{ '--swatch': colors.find(([id]) => id === config[subject.id].color)?.[2] || 'transparent' }"
                  ></span>
                  <span class="color-current-name">{{ colorName(config[subject.id].color) }}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div
                  v-if="openColorId === subject.id"
                  class="subject-color-options"
                  role="listbox"
                  :aria-label="`Colori per ${subjectName(subject)}`"
                >
                  <button
                    v-for="color in [['', 'Nessun colore', ''], ...colors]"
                    :key="color[0] || 'none'"
                    class="subject-color-option"
                    type="button"
                    role="option"
                    :aria-selected="String(config[subject.id].color === color[0])"
                    @click="config[subject.id].color = color[0]; dirty = true; openColorId = null"
                  >
                    <span class="color-swatch" :class="{ 'no-color': !color[2] }" :style="{ '--swatch': color[2] || 'var(--muted)' }"></span>
                    <span>{{ color[1] }}</span>
                  </button>
                </div>
              </div>
            </div>
            <button
              class="round ghost"
              type="button"
              :aria-label="`Rinomina ${subject.name}`"
              @click="editingName = subject.id; $nextTick(() => $el.parentElement.querySelector('input[type=text]')?.focus())"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>
            </button>
          </div>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="nav">
          <button class="round" type="button" aria-label="Indietro" @click="goBack">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m11 6-6 6 6 6M5 12h14"/></svg>
          </button>
          <button class="pill" type="button" :disabled="saving" @click="isInitial ? step++ : save(false)">
            <span>{{ saving ? "Salvo…" : isInitial ? "Configura l'orario" : "Salva" }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m13 6 6 6-6 6m6-6H5"/></svg>
          </button>
        </div>
      </template>
      <template v-else-if="step >= 2 && data">
        <h1>{{ isInitial ? "Configura l'orario" : "Modifica l'orario" }}</h1>
        <p class="lead">Verifica che l'orario sia corretto</p>
        <div class="daynav">
          <button class="round" type="button" aria-label="Giorno precedente" :disabled="dayIndex === 0" @click="goPreviousDay">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>
          </button>
          <span>{{ days[currentDay] }}</span>
          <button class="round" type="button" aria-label="Giorno successivo" :disabled="dayIndex === data.days.length - 1" @click="goNextDay">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
          </button>
        </div>
        <div class="hours">
          <div v-for="hour in data.slots" :key="hour" class="hour">
            <span class="num">{{ hour }}°</span>
            <div class="sel">
              <select
                v-model="picks[key(currentDay, hour)]"
                :aria-label="`${days[currentDay]}, ${hour}ª ora`"
                @change="flagged.delete(key(currentDay, hour)); dirty = true"
              >
                <option value="">
                  Nessuna lezione{{ flagged.has(key(currentDay, hour)) && !picks[key(currentDay, hour)] ? "?" : "" }}
                </option>
                <template v-if="candidatesFor(currentDay, hour).probable.length">
                  <optgroup label="Più probabili">
                    <option v-for="entry in entriesFor(candidatesFor(currentDay, hour).probable)" :key="entry.value" :value="entry.value">
                      {{ entry.label }}{{ flagged.has(key(currentDay, hour)) && picks[key(currentDay, hour)] === entry.value ? "?" : "" }}
                    </option>
                  </optgroup>
                  <optgroup v-if="candidatesFor(currentDay, hour).rest.length" label="Tutte le materie">
                    <option v-for="entry in entriesFor(candidatesFor(currentDay, hour).rest)" :key="entry.value" :value="entry.value">
                      {{ entry.label }}{{ flagged.has(key(currentDay, hour)) && picks[key(currentDay, hour)] === entry.value ? "?" : "" }}
                    </option>
                  </optgroup>
                </template>
                <template v-else>
                  <option v-for="entry in entriesFor(candidatesFor(currentDay, hour).rest)" :key="entry.value" :value="entry.value">
                    {{ entry.label }}{{ flagged.has(key(currentDay, hour)) && picks[key(currentDay, hour)] === entry.value ? "?" : "" }}
                  </option>
                </template>
              </select>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="nav">
          <button class="round" type="button" aria-label="Indietro" @click="dayIndex === 0 && mode === 'timetable' ? goBack() : step--">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m11 6-6 6 6 6M5 12h14"/></svg>
          </button>
          <button
            class="pill"
            type="button"
            :disabled="saving"
            @click="dayIndex === data.days.length - 1 ? save(true) : step++"
          >
            <span>{{ saving ? "Salvo…" : dayIndex === data.days.length - 1 ? "Salva" : "Avanti" }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m13 6 6 6m-6 6 6-6H5"/></svg>
          </button>
        </div>
      </template>
      <template v-else-if="error">
        <h1>Modifica l'orario</h1>
        <p class="error" role="alert">{{ error }}</p>
        <button class="primary" type="button" @click="props.onDone">Torna alle impostazioni</button>
      </template>
    </div>
  </section>
</template>
