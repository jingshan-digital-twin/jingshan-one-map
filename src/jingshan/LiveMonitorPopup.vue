<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LiveMonitorPoint } from './event-live-types.ts'
import SimulatedMonitorVideo from './SimulatedMonitorVideo.vue'

const props = defineProps<{ point: LiveMonitorPoint; light?: boolean; hasIncident?: boolean }>()
defineEmits<{ close: []; locate: []; incident: [] }>()
const kindNames = {
  venue: '赛事场馆',
  parking: '停车场',
  police: '交警岗',
  medical: '医疗点',
  camera: '视频监控',
  entrance: '观众入口',
  shuttle: '接驳点',
  supplies: '物资点',
}
const statusNames = { normal: '正常', busy: '繁忙', warning: '预警', offline: '离线', standby: '待启用' }
const viewNames = { entrance: '观众入口', parking: '停车区域', court: '比赛场地' }
const failed = ref(false),
  attempt = ref(0)
const camera = computed(() => props.point.camera)
const url = computed(() => {
  if (!camera.value?.url) return ''
  try {
    const result = new URL(camera.value.url, window.location.origin)
    return ['https:', 'http:'].includes(result.protocol) ? result.href : ''
  } catch {
    return ''
  }
})
watch(
  () => [props.point.id, url.value],
  () => {
    failed.value = false
    attempt.value = 0
  },
)
const reportTime = computed(() => Number.isFinite(Date.parse(props.point.updatedAt))
  ? new Date(props.point.updatedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  : '待采集')
const percent = (value: number) => Math.max(0, Math.min(100, value))
function reconnect() {
  failed.value = false
  attempt.value++
}
const vReleaseVideo = {
  beforeUnmount(player: HTMLVideoElement) {
    player.pause()
    player.removeAttribute('src')
    player.load()
  },
}
</script>

<template>
  <section class="monitor-popup" role="region" :aria-label="point.name + '监测详情'">
    <header class="monitor-head">
      <div>
        <small>{{ kindNames[point.kind] }}<template v-if="point.demo"> · 模拟点位</template></small>
        <h3>{{ point.name }}</h3>
      </div>
      <button type="button" class="monitor-close" aria-label="关闭点位详情" @click="$emit('close')">×</button>
    </header>
    <div class="monitor-status">
      <strong :class="point.status">{{ camera?.online ? '在线' : statusNames[point.status] }}</strong
      ><span>采集时间 {{ reportTime }}</span>
    </div>
    <template v-if="camera">
      <dl class="camera-facts">
        <div>
          <dt>设备编号</dt>
          <dd>{{ camera.code }}</dd>
        </div>
        <div>
          <dt>监看区域</dt>
          <dd>{{ viewNames[camera.view] }}</dd>
        </div>
      </dl>
      <div v-if="!camera.online" class="monitor-video-empty"><b>摄像头离线</b><span>暂无视频画面</span></div>
      <SimulatedMonitorVideo
        v-else-if="point.demo && camera.source === 'simulation'"
        :key="point.id + camera.view"
        :view="camera.view"
      />
      <div v-else-if="failed || !url" class="monitor-video-empty">
        <b>{{ url ? '暂时无法播放视频' : '尚未配置视频地址' }}</b
        ><button
          v-if="url"
          type="button"
          @click="reconnect"
        >
          重新连接
        </button>
      </div>
      <video
        v-else
        v-release-video
        :key="point.id + url + attempt"
        :src="url"
        autoplay
        muted
        playsinline
        :aria-label="point.name + '视频'"
        class="monitor-url-video"
        @error="failed = true"
      />
    </template>
    <dl v-if="point.kind !== 'camera' && point.metrics.length" class="monitor-metrics">
      <div v-for="metric in point.metrics" :key="metric.label">
        <dt>{{ point.kind === 'venue' && metric.label === '在场人数' ? '现场人数' : metric.label }}</dt>
        <dd>
          {{ metric.value }} <small>{{ metric.unit }}</small>
        </dd>
        <progress v-if="metric.percent != null" max="100" :value="percent(metric.percent)" :aria-label="metric.label" />
      </div>
    </dl>
    <dl v-if="point.contact" class="monitor-contact">
      <div>
        <dt>值班联系人</dt>
        <dd>{{ point.contact.name }}</dd>
      </div>
      <div>
        <dt>联系方式</dt>
        <dd>{{ point.contact.phone }}</dd>
      </div>
      <div>
        <dt>责任部门</dt>
        <dd>{{ point.contact.department }}</dd>
      </div>
    </dl>
    <footer>
      <button type="button" @click="$emit('locate')">定位到点位</button
      ><button v-if="hasIncident" type="button" @click="$emit('incident')">查看关联事件</button>
    </footer>
  </section>
</template>

<style scoped>
.monitor-popup {
  color: var(--el-ink);
  background: var(--v14-list);
  border: 1px solid var(--v14-edge);
  padding: 8px 10px;
}
.monitor-head,
.monitor-status,
.monitor-popup footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.monitor-head {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-line);
}
.monitor-head small,
.monitor-status span,
.monitor-popup dt {
  color: var(--el-muted);
  font-size: 16px;
}
.monitor-head h3 {
  margin: 2px 0 0;
  line-height: 26px;
  font-size: 20px;
}
.monitor-popup .monitor-close {
  width: 34px;
  height: 32px;
  min-height: 0;
  font-size: 24px;
  line-height: 24px;
  padding: 0;
}
.monitor-status {
  margin: 10px 0;
  font-size: 16px;
}
.monitor-status strong {
  white-space: nowrap;
  color: var(--el-green);
}
.monitor-status strong::before {
  content: ''; display:inline-block; width:8px; height:8px; margin-inline-end:5px; border-radius:50%; background:currentColor;
}
.monitor-status .busy,
.monitor-status .warning {
  color: var(--el-gold);
}
.monitor-status .offline,
.monitor-status .standby {
  color: var(--el-muted);
}
.monitor-popup dl {
  margin: 0;
}
.monitor-popup dd {
  margin: 0;
}
.camera-facts,
.monitor-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.camera-facts {
  padding: 0 0 10px;
}
.camera-facts > div {
  min-width: 0;
}
.camera-facts dd {
  font-size: 16px;
  overflow-wrap: anywhere;
}
.monitor-popup .monitor-metrics {
  margin: 10px 0;
}
.monitor-metrics > div {
  background: var(--el-card);
  border: 1px solid var(--el-line);
  padding: 6px 10px;
}
.monitor-metrics dd {
  color: var(--el-accent);
  font-size: 20px;
  font-weight: 700;
}
.monitor-metrics dd small {
  font-weight: 400;
  color: var(--el-ink);
}
.monitor-metrics progress {
  display: block;
  width: 100%;
  height: 6px;
  margin: 4px 0;
  accent-color: var(--el-gold);
}
.monitor-contact {
  border-top: 1px solid var(--el-line);
  padding-top: 4px;
}
.monitor-contact > div {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 3px 0;
}
.monitor-contact dt {
  min-width: 72px;
}
.monitor-video-empty,
.monitor-url-video {
  width: 100%;
  aspect-ratio: 16/9;
  background: #0a162c;
}
.monitor-video-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #d4e4f8;
  font-size: 16px;
}
.monitor-video-empty span {
  color: #9fb4cb;
}
.monitor-popup footer {
  justify-content: flex-end;
  margin-top: 12px;
}
.monitor-popup footer button {
  font-size: 16px;
}
</style>
