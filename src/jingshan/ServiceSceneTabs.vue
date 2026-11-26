<script setup lang="ts">
defineProps<{active:'venues'|'facilities'|'opening'}>()
defineEmits<{select:[tab:'venues'|'facilities'|'opening']}>()
const tabs=[['venues','场馆资源'],['facilities','配套资源'],['opening','开放协调']] as const
</script>
<template><nav class="industry-tabs service-scene-tabs" aria-label="服务对象"><button v-for="[key,title] in tabs" :key="key" type="button" :aria-pressed="active===key" @click="$emit('select',key)">{{ title }}</button></nav></template>
