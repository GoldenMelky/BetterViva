<script setup>
import CalendarView from "./CalendarView.vue";

defineProps({ visible: { type: Boolean, required: true } });
</script>

<template>
  <section id="view-home" :hidden="!visible">
    <div class="daybar">
      <div id="days" class="days" aria-label="Giorni"></div>
      <button id="mode-toggle" class="mode-toggle" type="button" role="switch" aria-checked="false" data-mode="orario" aria-label="Vista eventi" title="Cambia vista">
        <span class="knob">
          <svg class="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <svg class="i-events" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M14 3l5 5v2"/><path d="M20.3 12.7l-6.6 6.6-2.7.7.7-2.7 6.6-6.6a1.4 1.4 0 0 1 2 2z"/></svg>
        </span>
      </button>
    </div>
    <div id="panels" class="panels"></div>
    <div id="evlist" class="evlist" hidden></div>
    <CalendarView :visible="visible" />
  </section>
</template>
