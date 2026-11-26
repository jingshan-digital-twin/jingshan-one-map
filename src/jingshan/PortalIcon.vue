<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'm6 6 12 12M18 6 6 18',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M20.8 13.1A8.7 8.7 0 0 1 10.9 3.2 8.8 8.8 0 1 0 20.8 13.1Z',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4.5 21v-2a7.5 6 0 0 1 15 0v2',
  monitor: 'M3 4h18v13H3zM12 17v4m-4 0h8',
  network: 'M3 4h6v5H3zM15 4h6v5h-6zM9 16h6v5H9zM6 9v3h12V9m-6 3v4',
  catalog: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  folder: 'M3 7V5h6l2 2h10v13H3z',
  services: 'm12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  local:
    'M12 3c-5 0-9 1.7-9 4s4 4 9 4 9-1.7 9-4-4-4-9-4Zm-9 4v10c0 2.3 4 4 9 4s9-1.7 9-4V7M3 12c0 2.3 4 4 9 4s9-1.7 9-4',
  forms: 'M4 4h16v16H4zM4 9h16M10 9v11',
  preview: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15',
  bindings: 'M4 4h5v5H4zM15 4h5v5h-5zM15 15h5v5h-5zM6.5 9v8.5H15M6.5 12h5L16 9',
  activity: 'M2 12h4l3-7 5 14 3-7h5',
  versions: 'M4 5h16v5H4zM6 10v10h12V10M10 14h4',
  settings: 'M3 6h5m4 0h9M3 12h10m4 0h4M3 18h3m4 0h11M8 3v6m5 0v6m-7 0v6',
  opening: 'M5 4h14v17H5zM9 2h6v4H9zM8 12l2 2 5-5',
  results: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h6',
  accounts: 'M4 20v-2c0-4 3-6 7-6s7 2 7 6v2M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm2 5c3 0 5 3 5 6',
  reviews: 'M5 4h14v16H5zM8 12l3 3 5-6',
  api: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 5 6 6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  external: 'M13 4h7v7m0-7-10 10m0-8H4v14h14v-6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',
  chevron: 'm9 5 7 7-7 7',
  box: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-6v7l5 2',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Zm-5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  layers: 'm12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  star: 'm12 3 2.8 5.8 6.4 1-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-1z',
  plus: 'M12 4v16M4 12h16',
  check: 'm4 12 5 5 11-11',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
}
</script>
<template>
  <svg
    :width="size ?? 19"
    :height="size ?? 19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.folder" />
  </svg>
</template>
