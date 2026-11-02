<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { monthRange } from "../calendar-range.js";

defineProps({ visible: { type: Boolean, required: true } });

const events = ref([]);
const today = ref("");
const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const names = { verifica: "Verifica", interrogazione: "Interrogazione" };
const range = computed(() => {
  return monthRange();
});
const days = computed(() => {
  const { start, end } = range.value;
  const count = Math.round((end - start) / 864e5) + 1;
  const byDay = new Map();
  for (const event of events.value) {
    if (!event.kind) continue;
    const items = byDay.get(event.date) || [];
    items.push(event);
    byDay.set(event.date, items);
  }
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const tests = byDay.get(key) || [];
    const kinds = [...new Set(tests.map((event) => event.kind))];
    const what = tests.map((event) => `${names[event.kind] || event.kind}${event.subject ? ` di ${event.subject}` : ""}`).join(", ");
    return {
      date: key,
      number: day.getDate(),
      label: `${day.getDate()} ${months[day.getMonth()]}`,
      past: key < today.value,
      current: key === today.value,
      tests,
      kinds,
      title: what,
    };
  });
});

function updateEvents(event) {
  events.value = event.detail.events;
  today.value = event.detail.today;
}

function showDay(day) {
  window.BetterViva.showEventDay(day.date, day.tests);
}

onMounted(() => window.addEventListener("bv-events-loaded", updateEvents));
onUnmounted(() => window.removeEventListener("bv-events-loaded", updateEvents));
</script>

<template>
  <section id="cal" class="cal" aria-labelledby="cal-title" :hidden="!visible || !today">
    <h2 id="cal-title">Verifiche e interrogazioni</h2>
    <div class="cal-week" aria-hidden="true">
      <span>Lun</span><span>Mar</span><span>Mer</span><span>Gio</span><span>Ven</span><span>Sab</span><span>Dom</span>
    </div>
    <div class="cal-grid">
      <button
        v-for="day in days"
        :key="day.date"
        class="cd"
        :class="{ past: day.past, today: day.current }"
        type="button"
        :title="day.title || null"
        :aria-label="day.tests.length ? `${day.label}: ${day.title}` : null"
        @click="showDay(day)"
      >
        <span class="n">{{ day.number }}</span>
        <span v-if="day.kinds.length" class="ic">
          <svg
            v-for="kind in day.kinds"
            :key="kind"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="kind === 'verifica'">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M9 13h6M9 17h6" />
            </template>
            <template v-else-if="kind === 'interrogazione'">
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12z" />
              <path d="M8.5 11h7M8.5 14h4" />
            </template>
          </svg>
        </span>
      </button>
    </div>
  </section>
</template>
