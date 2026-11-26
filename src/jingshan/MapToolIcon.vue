<script setup lang="ts">
defineProps<{ name:'legend'|'imagery'|'tilt'|'tools' }>()
</script>

<template>
  <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="name === 'legend'" d="M9 6h11M9 12h11M9 18h11M4 6h1m-1 6h1m-1 6h1" />
    <template v-else-if="name === 'imagery'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m4 17 5-4 3 3 3-5 5 6" />
    </template>
    <path v-else-if="name === 'tilt'" d="m12 3 8 5v8l-8 5-8-5V8l8-5ZM4 8l8 5 8-5m-8 5v8" />
    <path v-else d="m14 6 4 4M5 17l-1 3 3-1L19 7a2 2 0 0 0-3-3L5 17Zm7-10L8 3 3 8l4 4m5 5 4 4 5-5-4-4" />
  </svg>
</template>
