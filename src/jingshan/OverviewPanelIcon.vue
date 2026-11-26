<script setup lang="ts">
import { computed, useId } from 'vue'
import {servicePictograms} from './service-pictograms'
import type {SupportKind} from './venue-support'

const props=withDefaults(defineProps<{ name: string; variant?: 'illustrated' | 'symbol' }>(), { variant: 'illustrated' })
const serviceGlyph=computed(()=>props.name.startsWith('support-') ? servicePictograms[props.name.slice(8) as SupportKind] : undefined)

const id = useId()
const paint = (name: string) => 'url(#' + id + '-' + name + ')'
</script>

<template>
  <svg class="overview-panel-icon" :class="`overview-panel-icon--${variant}`" viewBox="0 0 64 58" aria-hidden="true" focusable="false">
    <g v-if="variant === 'symbol'" transform="translate(6 3) scale(2.1667)" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path v-if="serviceGlyph" :d="serviceGlyph" />
      <g v-else-if="name === 'event'">
        <path d="m4 4 15 7-4 5-12-5zM4 11l-1 7 5 2m6-4 7 4M18 11l3 2-2 3"/>
        <path d="m4 7 11 6" />
      </g>
      <g v-else-if="name === 'calendar'">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4m8-4v4m-8 7h2m4 0h2m-8 3h2m4 0h2" />
      </g>
      <g v-else-if="name === 'club'">
        <rect x="8" y="8" width="8" height="8" rx="2" />
        <path d="M9 8 6 5m9 3 3-3m-3 11 3 3m-9-3-3 3" />
        <circle cx="4.5" cy="4.5" r="2.25" /><circle cx="19.5" cy="4.5" r="2.25" />
        <circle cx="4.5" cy="19.5" r="2.25" /><circle cx="19.5" cy="19.5" r="2.25" />
      </g>
      <g v-else-if="name === 'audience'">
        <path d="M6 4a9 9 0 0 0 0 13m12-13a9 9 0 0 1 0 13M9 7a5 5 0 0 0 0 7m6-7a5 5 0 0 1 0 7M8 21l4-8 4 8m-6-3h4" />
        <circle cx="12" cy="10" r="1" fill="currentColor" />
      </g>
      <g v-else-if="name === 'state'">
        <path d="m3 11 9-7 9 7M5 11l7-5 7 5v9H5z" fill="currentColor" />
        <path d="M10 20v-5h4v5" stroke="#dff4ff" stroke-width="2"/>
      </g>
      <g v-else-if="name === 'venue'">
        <circle cx="12" cy="12" r="9" fill="currentColor" />
        <circle cx="12" cy="12" r="4.5" stroke="#e5f7ff" />
        <path d="M12 2v7m0 6v7M2 12h7m6 0h7" stroke="#e5f7ff" />
      </g>
      <g v-else-if="name === 'lodging'">
        <path d="M2.5 5v15m19-6v6m-19-4h19v-3.4a2.6 2.6 0 0 0-2.6-2.6H12v4H3" /><circle cx="7.8" cy="9.8" r="2.4"/>
      </g>
      <path v-else-if="name === 'dining'" d="M4 3v4.5a3 3 0 0 0 6 0V3M7 3v18m11-18c-3 2.5-4 6-4 9h4m0-9v18"/>
      <g v-else-if="name === 'parking'">
        <rect x="2.5" y="2.5" width="19" height="19" rx="3"/><path d="M9 17V7h4a3 3 0 1 1 0 6H9"/>
      </g>
      <g v-else-if="name === 'charging'">
        <path d="M2 21h14M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17m0-12h2a2 2 0 0 1 2 2v5a2 2 0 0 0 4 0V9l-3-4"/><path d="m10 6-3 5h4l-3 5"/>
      </g>
      <g v-else>
        <path d="M7 4h10v6a5 5 0 0 1-10 0zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 3v5m-4 0h8" />
      </g>
    </g>
    <image v-else-if="name === 'club' || name === 'audience'" href="/jingshan/ui/mastergo-overview-users.png" x="6" y="2" width="52" height="54" />
    <image v-else-if="name === 'security'" href="/jingshan/ui/mastergo-overview-shield.png" x="6" y="2" width="52" height="54" />
    <template v-else>
    <defs>
      <linearGradient :id="id + '-blue'" x2=".77" y2="1">
        <stop stop-color="#a7ecff" />
        <stop offset=".42" stop-color="#46a9fc" />
        <stop offset="1" stop-color="#206dd7" />
      </linearGradient>
      <linearGradient :id="id + '-pale'" x2=".84" y2="1">
        <stop stop-color="#ecfaff" />
        <stop offset=".47" stop-color="#a4e5ff" />
        <stop offset="1" stop-color="#4b9cf3" />
      </linearGradient>
      <linearGradient :id="id + '-deep'" x2="1" y2="1">
        <stop stop-color="#6ecbff" />
        <stop offset="1" stop-color="#235cbe" />
      </linearGradient>
      <radialGradient :id="id + '-shadow'">
        <stop stop-color="#2688dd" stop-opacity=".22" />
        <stop offset="1" stop-color="#2688dd" stop-opacity="0" />
      </radialGradient>
    </defs>

    <ellipse cx="32" cy="51" rx="28" ry="6" :fill="paint('shadow')" />

    <g transform="translate(-3 -3) scale(1.085)">
    <g v-if="name === 'industry'" stroke-linejoin="round">
      <path d="M6 38 29 26 56 36 56 44 33 54 6 46z" :fill="paint('deep')" />
      <path d="m6 38 23-12 27 10-23 11z" :fill="paint('blue')" stroke="#bdf6ff" />
      <path d="m15 38 14-8 15 6-14 8zM11 45l15 6m16-7 11-6" fill="none" stroke="#8de8ff" stroke-width="1.5" />
      <path d="M32 39V7m0 14q-12 0-12-10 9 0 12 10zm0 9q-13 0-13-10 10 0 13 10zm0 8q-12 0-13-9 10 0 13 9zm0-17q10 0 11-12-8 3-11 12zm0 9q12-2 12-11-9 2-12 11zm0 8q12-2 13-10-11 2-13 10z" :fill="paint('pale')" stroke="#87dfff" stroke-width="1.3" />
    </g>
    <g v-else-if="name === 'lodging'" stroke-linejoin="round">
      <path d="m24 10 7 1 5-2 5 3-7 9H26L19 12z" :fill="paint('pale')" />
      <path d="M25 20h11c5 4 14 12 14 22 0 8-10 10-19 10-10 0-19-2-19-10 0-10 8-18 13-22z" :fill="paint('blue')" />
      <path d="M24 19h14M25 30l6 7 6-7m-13 9h14m-14 4h14m-7-6v9" fill="none" stroke="#def7ff" stroke-width="1.8" stroke-linecap="round" />
      <path d="M43 39h12v10H43z" :fill="paint('deep')" /><ellipse cx="49" cy="39" rx="6" ry="2.5" :fill="paint('pale')" />
      <path d="M43 44q6 4 12 0m-12 5q6 4 12 0" fill="none" stroke="#a5ddff" />
    </g>
    <g v-else-if="name === 'dining'" stroke-linejoin="round">
      <ellipse cx="32" cy="32" rx="15" ry="16" :fill="paint('blue')" />
      <ellipse cx="32" cy="32" rx="10" ry="11" :fill="paint('pale')" />
      <path d="M8 12v8q0 7 6 7t6-7v-8M14 12v37m39-36q-8 7-7 16h7m0-16v36" fill="none" :stroke="paint('deep')" stroke-width="3" stroke-linecap="round"/>
    </g>
    <g v-else-if="name === 'charging'" stroke-linejoin="round">
      <rect x="12" y="10" width="29" height="41" rx="4" :fill="paint('blue')" />
      <path d="m28 16-9 16h7l-2 13 11-19h-8z" fill="#eafaff"/>
      <path d="M41 24h4a4 4 0 0 1 4 4v11a3 3 0 0 0 6 0V21l-5-6m-39 36h32" :stroke="paint('deep')" stroke-width="3" fill="none"/>
    </g>
    <g v-else-if="name === 'springs'" stroke-linecap="round">
      <path d="M8 36c2 14 11 18 24 18s23-6 25-18" :fill="paint('deep')" />
      <ellipse cx="32" cy="36" rx="24" ry="7" :fill="paint('blue')" stroke="#bdf1ff" stroke-width="1.6"/>
      <path d="M20 30c-8-9 6-12 0-22m12 22c-8-9 6-13 0-23m12 23c-8-9 6-12 0-22" :stroke="paint('blue')" stroke-width="3" fill="none"/>
    </g>
    <g v-else-if="name === 'training'" stroke-linejoin="round">
      <path d="m8 19 25-11 23 11-23 11z" :fill="paint('pale')" />
      <path d="m18 25 15 7 14-7v10c-7 7-20 7-29 0z" :fill="paint('blue')" />
      <path d="m50 22 2 12m-1 0v3" stroke="#388be7" stroke-width="2" />
      <path d="M19 49c3-8 24-11 31-1V54H16z" :fill="paint('pale')" />
    </g>
    <g v-else-if="name === 'court'" stroke-linejoin="round">
      <path d="m7 39 25-18 25 12v8L32 56 7 45z" :fill="paint('deep')" />
      <path d="m7 39 25-18 25 12-25 17z" :fill="paint('blue')" stroke="#a5e9ff" />
      <path d="m15 39 17-12 17 7-17 12zM22 34l17 8m-15 0 17-12M32 27v-7m17 14v-7m-17-7 17 7" fill="none" stroke="#e5faff" stroke-width="1.4" />
      <path d="m18 20-5 6m4-7a5 7 39 1 1 5 4c-2 0-3-1-5-4" :fill="paint('pale')" stroke="#479ce7" stroke-width="1.4" />
      <circle cx="26" cy="14" r="3.2" fill="#b9efff" />
    </g>

    <g v-else-if="name === 'venue'" stroke-linejoin="round">
      <path d="m7 38 25-13 25 11v6L32 54 7 43z" :fill="paint('deep')" />
      <path d="m7 38 25-13 25 11-25 13z" :fill="paint('blue')" stroke="#b8f1ff" />
      <path d="M13 34V20l19-11 19 10v13l-4-2v-8l-15-8-15 10v8z" :fill="paint('pale')" stroke="#9fdeff" />
      <path d="m18 37 14-7 14 6-14 8zM25 33.5l14 7M25 40.5l14-7" fill="none" stroke="#e1faff" stroke-width="1.35" />
      <path d="M21 25v-2l11-6 11 5v2" fill="none" stroke="#effdff" stroke-width="1.25" />
    </g>

    <g v-else-if="name === 'school'">
      <path d="M13 28 32 12l19 16v16H13z" :fill="paint('blue')" />
      <path d="m10 29 22-19 22 19-5 1-17-14-17 14zM10 44h44v5H10z" :fill="paint('pale')" />
      <path d="M20 29h6v7h-6zm18 0h6v7h-6zm-9 8h6v8h-6z" fill="#dcf7ff" />
      <circle cx="32" cy="23" r="3.2" fill="#effdff" />
      <path d="M31 11V5l10 1-2.5 2.5 2.5 2.5z" fill="#4c96ec" />
    </g>

    <g v-else-if="name === 'state' || name === 'government'">
      <path d="M12 21 32 9l20 12v6H12zm4 7h32v15H16zm-5 16h42v6H11z" :fill="paint('blue')" />
      <path d="M14 22h36v4H14zm6 7h4v14h-4zm10 0h4v14h-4zm10 0h4v14h-4zm-28 16h40v3H12z" :fill="paint('pale')" />
      <path d="m21 20 11-7 11 7" fill="none" stroke="#e9faff" stroke-width="1.5" />
    </g>

    <g v-else-if="name === 'private'">
      <path d="M11 24h42v25H11z" :fill="paint('blue')" />
      <path d="m9 25 4-14h38l4 14-7 5-5-5-6 5-5-5-5 5-6-5-5 5z" :fill="paint('pale')" />
      <path d="M17 33h13v9H17zm18 0h12v16H35z" fill="#dcf7ff" />
    </g>

    <g v-else-if="name === 'medical' || name === 'aid'">
      <path d="M19 10h26v13H19zm4 4v5h18v-5z" :fill="paint('deep')" fill-rule="evenodd" />
      <rect x="8" y="18" width="48" height="33" rx="7" :fill="paint('blue')" />
      <path d="M9 25a7 7 0 0 1 7-6h32a7 7 0 0 1 7 6v2H9z" :fill="paint('pale')" opacity=".62" />
      <path d="M28 25h8v6h6v8h-6v6h-8v-6h-6v-8h6z" fill="#eafaff" />
      <path d="M17 25h5" stroke="#b9efff" stroke-linecap="round" stroke-width="2" />
    </g>

    <g v-else-if="name === 'emergency'">
      <path d="M13 37h38v10H13zm7-8v-5a12 12 0 0 1 24 0v13H20z" :fill="paint('deep')" />
      <path d="M25 36V25a7 7 0 1 1 14 0v11z" :fill="paint('blue')" />
      <path d="M30 25a3 3 0 0 1 3-3" fill="none" stroke="#d4f7ff" stroke-linecap="round" stroke-width="1.7" />
      <path d="M32 11V5M16 15l-4-4m36 4 4-4m-38 15H7m43 0h7" fill="none" stroke="#5bb0f8" stroke-linecap="round" stroke-width="2.5" />
      <path d="M17 39h30v4H17z" :fill="paint('pale')" />
    </g>

    <g v-else-if="name === 'parking' || name === 'traffic' || name === 'transport'">
      <path d="M11 27 17 13h29l7 14v18H11z" :fill="paint('blue')" />
      <path d="m14 28 6-12h24l6 12z" :fill="paint('pale')" />
      <path d="M15 43h9v7h-9zm25 0h9v7h-9z" fill="#2e74cc" />
      <path d="M16 33h8v5h-8zm24 0h8v5h-8z" fill="#dbfaff" />
      <path d="M27 35h10" stroke="#dcfaff" stroke-linecap="round" stroke-width="2" />
    </g>

    <g v-else-if="name === 'calendar' || name === 'event'">
      <rect x="12" y="14" width="41" height="36" rx="5" :fill="paint('deep')" />
      <rect x="14" y="15" width="36" height="31" rx="4" :fill="paint('pale')" />
      <path d="M14 25h36v-6a4 4 0 0 0-4-4H18a4 4 0 0 0-4 4z" :fill="paint('blue')" />
      <path d="M22 10v9m20-9v9" fill="none" stroke="#3292e7" stroke-linecap="round" stroke-width="3" />
      <path d="M22 30h5v5h-5zm8 0h5v5h-5zm8 0h5v5h-5zm-16 8h5v5h-5zm8 0h5v5h-5z" fill="#438de4" />
    </g>

    <g v-else-if="name === 'trophy'">
      <path d="M13 16h10v4h-6c0 6 3 10 9 11v4c-9-1-13-7-13-19zm38 0H41v4h6c0 6-3 10-9 11v4c9-1 13-7 13-19z" :fill="paint('pale')" />
      <path d="M20 12h24v10c0 7-4 12-10 14v7h8v6H22v-6h8v-7c-6-2-10-7-10-14z" :fill="paint('blue')" />
      <path d="m32 17 2 4 4.5.7-3.3 3.1.8 4.3-4-2.1-4 2.1.8-4.3-3.3-3.1 4.5-.7z" fill="#f1fcff" />
    </g>

    <g v-else-if="name === 'camera'">
      <rect x="8" y="10" width="46" height="32" rx="4" :fill="paint('blue')" />
      <rect x="12" y="14" width="38" height="24" rx="2" :fill="paint('deep')" stroke="#bcecff" />
      <path d="m27 18 12 8-12 8zM26 43h10v4l8 2v2H18v-2l8-2z" :fill="paint('pale')" />
    </g>
    <g v-else-if="name === 'travel'">
      <path d="m9 41 14-17 8 7 10-12 14 22-23 9z" :fill="paint('blue')" />
      <path d="m10 42 15-15 5 6 3-3 8-9 12 20" fill="none" stroke="#c9f3ff" stroke-width="1.5" />
      <path d="M17 44c8-1 10-6 15-7 5-1 8 2 14 0" fill="none" stroke="#edfaff" stroke-linecap="round" stroke-width="2" />
      <circle cx="22" cy="16" r="6" :fill="paint('pale')" />
    </g>

    <image v-else href="/jingshan/ui/light-metric-industry.png" x="2" y="2" width="60" height="54" />
    </g>
    </template>
  </svg>
</template>

<style scoped>
.overview-panel-icon {
  display: block;
  flex: none;
  width: 1em;
  height: 1em;
  overflow: visible;
}
.overview-panel-icon--symbol { color: #164387; }
:global(.overview-metric.on) .overview-panel-icon--illustrated { filter: brightness(1.17) saturate(1.08); }
</style>
