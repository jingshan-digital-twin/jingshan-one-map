<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ view: 'court' | 'parking' | 'entrance' }>()
const canvas = ref<HTMLCanvasElement>(),
  video = ref<HTMLVideoElement>()
const displayVideo = ref(false),
  frameError = ref(false)
const width = 640,
  height = 360
const titles = { court: '比赛场地', parking: '停车区域', entrance: '观众入口' }
let animation = 0,
  started = 0,
  lastPaint = -Infinity,
  disposed = false
let stream: MediaStream | undefined,
  ctx: CanvasRenderingContext2D | null = null

function person(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  g.fillStyle = '#19293c55'
  g.beginPath()
  g.ellipse(x + 4, y + 6, 7, 4, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = color
  g.fillRect(x - 3, y - 1, 6, 10)
  g.fillStyle = '#f0bf90'
  g.beginPath()
  g.arc(x, y - 3, 3, 0, Math.PI * 2)
  g.fill()
}
function car(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  g.fillStyle = '#15263380'
  g.fillRect(x + 3, y + 3, 40, 19)
  g.fillStyle = color
  g.fillRect(x, y, 40, 19)
  g.fillStyle = '#24485b'
  g.fillRect(x + 9, y + 2, 7, 15)
  g.fillRect(x + 26, y + 2, 6, 15)
  g.fillStyle = '#ffe6a0'
  g.fillRect(x + 37, y + 2, 3, 3)
  g.fillRect(x + 37, y + 14, 3, 3)
}
function court(g: CanvasRenderingContext2D, t: number) {
  g.fillStyle = '#497d66'
  g.fillRect(0, 0, width, height)
  g.fillStyle = '#3b7192'
  g.fillRect(92, 70, 456, 222)
  g.strokeStyle = '#d1e5df'
  g.lineWidth = 3
  g.strokeRect(92, 70, 456, 222)
  g.strokeRect(92, 99, 456, 164)
  g.strokeRect(195, 99, 250, 164)
  g.beginPath()
  g.moveTo(195, 181)
  g.lineTo(445, 181)
  g.moveTo(320, 65)
  g.lineTo(320, 297)
  g.stroke()
  person(g, 110 + 6 * Math.sin(t), 179 + 62 * Math.sin(t * 0.8), '#edf0f3')
  person(g, 527, 179 + 54 * Math.sin(t * 0.8 + 1), '#e6a15c')
  g.fillStyle = '#d8ff55'
  g.beginPath()
  g.arc(320 + 194 * Math.sin(t * 2), 182 + 48 * Math.cos(t * 0.9), 4, 0, Math.PI * 2)
  g.fill()
}
function parking(g: CanvasRenderingContext2D, t: number) {
  g.fillStyle = '#515e64'
  g.fillRect(0, 0, width, height)
  g.strokeStyle = '#ccd6d5'
  g.lineWidth = 2
  const colors = ['#d9deb9', '#6194aa', '#c57860', '#cfdae0']
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 8; i++) {
      const x = 22 + i * 76,
        y = row ? 242 : 76
      g.strokeRect(x, y, 66, 39)
      if ((i + row) % 4 !== 0) car(g, x + 12, y + 10, colors[(row + i) % 4])
    }
  g.strokeStyle = '#e2cb86'
  g.setLineDash([20, 15])
  g.beginPath()
  g.moveTo(0, 181)
  g.lineTo(640, 181)
  g.stroke()
  g.setLineDash([])
  car(g, ((t * 38 + 120) % 700) - 45, 146, '#a3c5cd')
  car(g, 645 - ((t * 30) % 700), 193, '#bfb9a2')
}
function entrance(g: CanvasRenderingContext2D, t: number) {
  g.fillStyle = '#a6ada8'
  g.fillRect(0, 0, width, height)
  g.strokeStyle = '#919991'
  g.lineWidth = 1
  for (let y = 0; y < height; y += 30) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(width, y)
    g.stroke()
  }
  for (let x = 0; x < width; x += 40) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, height)
    g.stroke()
  }
  g.fillStyle = '#49756b'
  g.fillRect(0, 56, 124, 250)
  g.fillRect(515, 56, 125, 250)
  g.fillStyle = '#546a71'
  for (let i = 0; i < 5; i++) g.fillRect(156 + i * 77, 137, 12, 60)
  for (let i = 0; i < 14; i++) {
    const lane = i % 4
    person(
      g,
      195 + lane * 77 + 4 * Math.sin(i + t),
      320 - ((t * 12 + i * 47) % 285),
      ['#447d9b', '#d4b061', '#805953'][i % 3],
    )
  }
}
function paint(ms: number) {
  if (!ctx) return
  const g = ctx,
    sec = ms / 1000
  if (props.view === 'parking') parking(g, sec)
  else if (props.view === 'entrance') entrance(g, sec)
  else court(g, sec)
}
function tick(now: number) {
  if (disposed) return
  if (now - lastPaint >= 1000 / 15) {
    paint(now - started)
    lastPaint = now
  }
  animation = requestAnimationFrame(tick)
}
onMounted(() => {
  const surface = canvas.value,
    player = video.value
  if (!surface || !player) return
  ctx = surface.getContext('2d')
  if (!ctx) {
    frameError.value = true
    return
  }
  paint(0)
  started = performance.now()
  animation = requestAnimationFrame(tick)
  try {
    if (typeof surface.captureStream !== 'function') return
    stream = surface.captureStream(15)
    player.srcObject = stream
    void player.play().catch(() => {
      if (!disposed) displayVideo.value = false
    })
  } catch {
    displayVideo.value = false
  }
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(animation)
  if (video.value) {
    video.value.pause()
    video.value.srcObject = null
  }
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = undefined
  ctx = null
})
</script>

<template>
  <div class="sim-feed">
    <div class="sim-picture">
      <canvas
        ref="canvas"
        :width="width"
        :height="height"
        :style="{ opacity: displayVideo ? 0 : 1 }"
        :aria-label="titles[view] + '模拟画面'"
      />
      <video
        ref="video"
        :style="{ opacity: displayVideo ? 1 : 0 }"
        :aria-label="titles[view] + '模拟视频'"
        muted
        autoplay
        playsinline
        @playing="displayVideo = true"
        @error="displayVideo = false"
      />
      <span v-if="frameError" class="sim-error">此浏览器无法显示模拟画面</span>
    </div>
  </div>
</template>

<style scoped>
.sim-feed {
  border: 1px solid var(--el-line);
  background: #101d2a;
}
.sim-picture {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
}
.sim-picture :is(canvas, video) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.sim-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #d9e6ee;
}
</style>
