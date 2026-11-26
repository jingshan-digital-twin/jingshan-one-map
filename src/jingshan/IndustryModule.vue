<script setup lang="ts">
defineProps<{ title: string; fill?: boolean }>()
</script>

<template>
  <section class="v14-overview-module industry-module" :class="{ 'industry-module-fill': fill }">
    <header class="v14-overview-heading">
      <h2>{{ title }}</h2>
      <slot name="heading-actions" />
    </header>
    <slot name="navigation" />
    <div class="v14-overview-content industry-module-body">
      <slot />
    </div>
    <footer v-if="$slots.actions" class="industry-actions">
      <slot name="actions" />
    </footer>
  </section>
</template>
