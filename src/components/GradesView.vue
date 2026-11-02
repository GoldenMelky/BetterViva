<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps({ visible: { type: Boolean, required: true } });
const data = ref(null);
const periodPos = ref(null);
const subjectId = ref(null);
const loading = ref(false);
const error = ref("");
const tabsElement = ref(null);

const periods = computed(() => data.value?.periods || []);
const periodItems = computed(() => [
  { periodPos: null, periodLabel: "Tutto l’anno" },
  ...(periods.value.length > 1 ? periods.value : []),
]);
const selectedStats = computed(() => periodPos.value == null
  ? data.value?.overall
  : periods.value.find((period) => period.periodPos === periodPos.value) || data.value?.overall);
const selectedSubject = computed(() => (
  selectedStats.value?.subjects || []
).find((subject) => subject.subjectId === subjectId.value) || null);

const colorForAverage = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return "blue";
  if (Number(value) >= 6) return "green";
  if (Number(value) >= 5) return "orange";
  return "red";
};
const colorForGrade = (grade) => (
  grade.canceled || grade.noAverage || grade.decimalValue == null
    ? "blue"
    : colorForAverage(grade.decimalValue)
);
const formattedAverage = (value) => value == null ? "—" : Number(value).toFixed(2);
const formattedDate = (value) => {
  if (typeof value !== "string") return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};
const progress = (value) => value == null ? 0 : Math.max(0, Math.min(100, Number(value) * 10));
const datesLabel = (stats) => {
  const dates = (stats?.subjects || [])
    .flatMap((subject) => subject.grades)
    .map((grade) => grade.evtDate)
    .filter((date) => typeof date === "string")
    .sort();
  return dates.length ? `Dal ${formattedDate(dates[0])} al ${formattedDate(dates.at(-1))}` : "";
};
const sortedGrades = computed(() => [...(selectedSubject.value?.grades || [])].sort((a, b) => {
  const byDate = String(b.evtDate || "").localeCompare(String(a.evtDate || ""));
  return byDate || Number(b.displaPos || 0) - Number(a.displaPos || 0);
}));

function centerPeriodTab(behavior = "smooth") {
  const tabs = tabsElement.value;
  const active = tabs?.querySelector(".grade-period-tab.active");
  if (!active) return;
  const [before, after] = tabs.querySelectorAll(".grade-period-spacer");
  const style = getComputedStyle(tabs);
  const innerWidth = tabs.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  before.style.flexBasis = `${Math.max(0, (innerWidth - active.clientWidth) / 2)}px`;
  after.style.flexBasis = before.style.flexBasis;
  tabs.scrollTo({
    left: active.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft
      - (tabs.clientWidth - active.clientWidth) / 2,
    behavior,
  });
}

function selectPeriod(item) {
  periodPos.value = item.periodPos;
  subjectId.value = null;
}

function selectSubject(subject) {
  history.pushState({ ...(history.state || {}), betterviva: true, view: "grades", gradeSubject: true }, "");
  subjectId.value = subject.subjectId;
}

function backToSubjects() {
  if (history.state?.gradeSubject) history.back();
  else subjectId.value = null;
}

function handleGradeBack(event) {
  if (subjectId.value == null) return;
  subjectId.value = null;
  event.detail.handled = true;
}

function openGrade(grade) {
  window.BetterViva.openGrade(grade);
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await window.BetterViva.api("/api/grades");
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || "Impossibile caricare i voti.");
    }
    data.value = await response.json();
    if (periods.value.length <= 1
      || (periodPos.value != null && !periods.value.some((period) => period.periodPos === periodPos.value))) {
      periodPos.value = null;
      subjectId.value = null;
    }
  } catch (loadError) {
    if (window.BetterViva.isLoginError(loadError)) {
      window.BetterViva.showLogin(loadError.message);
    } else {
      error.value = loadError.message || "Impossibile caricare i voti. Riprova.";
    }
  } finally {
    loading.value = false;
  }
}

function handleCacheUpdate(event) {
  if (event.detail.path !== "/api/grades" || !props.visible) return;
  data.value = event.detail.data;
}

function handleResize() {
  if (tabsElement.value) requestAnimationFrame(() => centerPeriodTab("auto"));
}

onMounted(() => {
  window.addEventListener("bv-api-cache-update", handleCacheUpdate);
  window.addEventListener("bv-grade-back", handleGradeBack);
  window.addEventListener("resize", handleResize);
});
onUnmounted(() => {
  window.removeEventListener("bv-api-cache-update", handleCacheUpdate);
  window.removeEventListener("bv-grade-back", handleGradeBack);
  window.removeEventListener("resize", handleResize);
});

watch(() => props.visible, (visible) => {
  if (visible) {
    subjectId.value = null;
    void load();
  }
});
watch(periodPos, () => nextTick(() => centerPeriodTab()));
watch(periodItems, () => nextTick(() => centerPeriodTab()));
</script>

<template>
  <section id="view-grades" :hidden="!props.visible" aria-label="Voti">
    <p v-if="loading && !data" class="grade-loading">Caricamento voti…</p>
    <template v-else-if="error">
      <p class="grade-error">{{ error }}</p>
      <button class="grade-retry" type="button" @click="load">Riprova</button>
    </template>
    <template v-else-if="data">
      <div class="grade-period-nav">
        <button
          v-if="selectedSubject"
          class="grade-period-back"
          type="button"
          aria-label="Torna a tutte le materie"
          @click="backToSubjects"
        >‹</button>
        <div ref="tabsElement" class="grade-period-tabs">
          <span class="grade-period-spacer" aria-hidden="true"></span>
          <button
            v-for="item in periodItems"
            :key="item.periodPos ?? 'all'"
            class="grade-period-tab"
            :class="{ active: item.periodPos === periodPos }"
            type="button"
            :aria-pressed="String(item.periodPos === periodPos)"
            @click="selectPeriod(item)"
          >{{ item.periodLabel }}</button>
          <span class="grade-period-spacer" aria-hidden="true"></span>
        </div>
      </div>

      <template v-if="selectedSubject">
        <section class="grade-summary grade-subject-summary">
          <div class="grade-ring" :class="colorForAverage(selectedSubject.average)" role="img" :aria-label="`Media ${formattedAverage(selectedSubject.average)}`">
            <svg class="grade-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle class="grade-ring-track" cx="50" cy="50" r="43" />
              <circle
                class="grade-ring-fill"
                cx="50"
                cy="50"
                r="43"
                :stroke-dasharray="2 * Math.PI * 43"
                :stroke-dashoffset="2 * Math.PI * 43 * (1 - progress(selectedSubject.average) / 100)"
              />
            </svg>
            <span>{{ formattedAverage(selectedSubject.average) }}</span>
          </div>
          <div class="grade-summary-text">
            <h1>{{ selectedSubject.subjectName || selectedSubject.subjectDesc || "Materia" }}</h1>
            <p>{{ selectedSubject.grades.length }} Voti</p>
          </div>
        </section>

        <div class="grade-list">
          <button
            v-for="(grade, index) in sortedGrades"
            :key="`${grade.evtDate}-${grade.displaPos}-${index}`"
            class="grade-row"
            :class="colorForGrade(grade)"
            type="button"
            @click="openGrade(grade)"
          >
            <span class="grade-value" :class="colorForGrade(grade)">{{ grade.displayValue || "—" }}</span>
            <span class="grade-row-text">
              <span class="grade-row-note">
                {{ grade.notesForFamily || [formattedDate(grade.evtDate), grade.componentDesc].filter(Boolean).join(" - ") || "Voto" }}
              </span>
              <span v-if="grade.notesForFamily ? (formattedDate(grade.evtDate) || grade.componentDesc) : grade.teacherName" class="grade-row-meta">
                {{ grade.notesForFamily
                  ? [formattedDate(grade.evtDate), grade.componentDesc].filter(Boolean).join(" - ")
                  : grade.teacherName }}
              </span>
            </span>
          </button>
        </div>
      </template>

      <template v-else>
        <section class="grade-summary">
          <div class="grade-ring" :class="colorForAverage(selectedStats?.average)" role="img" :aria-label="`Media ${formattedAverage(selectedStats?.average)}`">
            <svg class="grade-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle class="grade-ring-track" cx="50" cy="50" r="43" />
              <circle
                class="grade-ring-fill"
                cx="50"
                cy="50"
                r="43"
                :stroke-dasharray="2 * Math.PI * 43"
                :stroke-dashoffset="2 * Math.PI * 43 * (1 - progress(selectedStats?.average) / 100)"
              />
            </svg>
            <span>{{ formattedAverage(selectedStats?.average) }}</span>
          </div>
          <div class="grade-summary-text">
            <h1>Media generale</h1>
            <p>{{ datesLabel(selectedStats) }}</p>
          </div>
        </section>

        <div class="grade-subject-list">
          <button
            v-for="subject in selectedStats?.subjects || []"
            :key="subject.subjectId"
            class="grade-subject-row"
            type="button"
            @click="selectSubject(subject)"
          >
            <span class="grade-average-bar" :class="colorForAverage(subject.average)" role="img" :aria-label="`Media ${formattedAverage(subject.average)}`">
              <span class="grade-average-fill" :style="{ width: `${progress(subject.average)}%` }">
                <span class="grade-average-label grade-average-label-filled">{{ formattedAverage(subject.average) }}</span>
              </span>
              <span class="grade-average-label">{{ formattedAverage(subject.average) }}</span>
            </span>
            <span class="grade-subject-name">{{ subject.subjectName || subject.subjectDesc || "Materia" }}</span>
            <span class="grade-subject-count">{{ subject.grades.length }} Voti</span>
          </button>
          <p v-if="!selectedStats?.subjects?.length" class="grade-empty">Nessun voto per questo periodo.</p>
        </div>
      </template>
    </template>
  </section>
</template>
