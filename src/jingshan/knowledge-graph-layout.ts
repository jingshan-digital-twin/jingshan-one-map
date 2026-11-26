export interface KnowledgeNode {
  id: string
  name: string
  group: string
  kind: 'enterprise' | 'facility' | 'event'
  center?: boolean
}
export interface KnowledgeEdge {
  id: string
  from: string
  to: string
  label: string
  kind: 'business' | 'spatial'
  direction: 'out' | 'in' | 'both' | 'none'
}
export type Position = { x: number; y: number }
export type Bounds = { left: number; top: number; right: number; bottom: number }
export type PlacedNode = KnowledgeNode & Position & { isolated: boolean }
export type GraphBand = Bounds & { title: string }

export function shortName(node: KnowledgeNode) {
  const name = node.kind === 'enterprise'
    ? node.name.replace(/(?:有限责任公司|股份有限公司|有限公司)$/u, '').replace(/^(?:湖北省)?(?:京山市|京山县|京山)/u, '')
    : node.name.replace(/^京山市/u, '')
  return name || node.name
}

function labelUnits(text: string) {
  return Array.from(text, char => /[\x00-\xff]/.test(char) ? .56 : 1).reduce((a, b) => a + b, 0)
}

export function nameLines(text: string, max = 10) {
  const lines: string[] = []
  let line = '', units = 0
  for (const char of text) {
    const size = labelUnits(char)
    if (units + size > max && line) { lines.push(line.trim()); line = ''; units = 0 }
    line += char
    units += size
  }
  if (line) lines.push(line.trim())
  return lines
}

export function nodeLabel(node: KnowledgeNode) {
  return nameLines(shortName(node), 6)
}

export function radius(node: PlacedNode) {
  return node.isolated ? node.center ? 7 : 4.5 : node.center ? 22 : node.kind === 'event' ? 12 : 11
}

export function nodeBounds(node: PlacedNode): Bounds {
  if (node.isolated) return { left: node.x - 10, top: node.y - 12, right: node.x + 128, bottom: node.y + 13 }
  const lines = nodeLabel(node)
  const width = Math.max(26, Math.max(...lines.map(labelUnits)) * 8)
  return { left: node.x - width - 5, top: node.y - radius(node) - 7, right: node.x + width + 5, bottom: node.y + radius(node) + 6 + 20 * lines.length }
}

function extent(boxes: Bounds[]): Bounds {
  if (!boxes.length) return { left: -80, right: 80, top: -40, bottom: 40 }
  return { left: Math.min(...boxes.map(p => p.left)), right: Math.max(...boxes.map(p => p.right)),
    top: Math.min(...boxes.map(p => p.top)), bottom: Math.max(...boxes.map(p => p.bottom)) }
}
export function graphBounds(nodes: PlacedNode[], bands: GraphBand[]) {
  return extent([...nodes.map(nodeBounds), ...bands])
}

function rank(node: KnowledgeNode) {
  if (node.group.includes('上游')) return 0
  if (node.group.includes('中游')) return 1
  if (node.group.includes('下游')) return 2
  return node.kind === 'event' ? 4 : node.kind === 'facility' ? 5 : 3
}

function placeComponent(nodes: KnowledgeNode[], adjacency: Map<string, Set<string>>, all: Map<string, KnowledgeNode>, aspect: number): PlacedNode[] {
  const ordered = [...nodes].sort((a,b) => Number(!!b.center) - Number(!!a.center) || adjacency.get(b.id)!.size - adjacency.get(a.id)!.size)
  const root = ordered[0]
  const levels = [[root]], visited = new Set([root.id])
  const neighbors = (node: KnowledgeNode) => [...adjacency.get(node.id)!].map(id => all.get(id)!)
    .sort((a,b) => rank(a) - rank(b) || adjacency.get(b.id)!.size - adjacency.get(a.id)!.size || a.name.localeCompare(b.name, 'zh-CN'))
  for (let index = 0; index < levels.length; index++) {
    const next: KnowledgeNode[] = []
    for (const node of levels[index]) {
      for (const peer of neighbors(node)) {
        if (!visited.has(peer.id)) { visited.add(peer.id); next.push(peer) }
      }
    }
    if (next.length) levels.push(next)
  }
  const points: PlacedNode[] = [{ ...root, isolated: false, x: 0, y: 0 }]
  const distances = [0]
  for (let layer = 1; layer < levels.length; layer++) {
    const group = levels[layer]
    const r = Math.max(distances[layer - 1] + 105, 30 + group.length * 20)
    distances.push(r)
    group.forEach((node, i) => {
      const narrow = aspect < 1.15
      const start = group.length === 1 ? (narrow ? -Math.PI/2 : 0) : -2.55
      const angle = (i / group.length) * 2 * Math.PI + start + (layer % 2) * .2
      points.push({ ...node, isolated: false, x: (narrow ? .82 : 1.28) * r * Math.cos(angle), y: (narrow ? 1.25 : 1) * r * Math.sin(angle) })
    })
  }

  // Start with a stable breadth-first arrangement. Relax connected pairs towards
  // one another, then separate their labels in both axes without random jitter.
  const initial = points.map(p => ({ x: p.x, y: p.y }))
  const pointIndex = new Map(points.map((node,i) => [node.id, i]))
  const pairs: [number, number][] = []
  points.forEach((node,i) => adjacency.get(node.id)!.forEach(id => {
    const j = pointIndex.get(id)!
    if (j > i) pairs.push([i,j])
  }))
  const boxes = points.map(p => nodeBounds({ ...p, x: 0, y: 0 }))
  for (let iteration = 0; iteration < 82; iteration++) {
    const settling = iteration >= 58
    if (!settling) {
      points.forEach((p, i) => {
        p.x += (initial[i].x - p.x) * .025
        p.y += (initial[i].y - p.y) * .025
      })
      for (const [i,j] of pairs) {
        const a = points[i], b = points[j], dx = b.x - a.x, dy = b.y - a.y
        const distance = Math.hypot(dx,dy) || 1
        const pull = (distance - (a.center || b.center ? 150 : 124)) * .044 / distance
        if (i !== 0) { a.x += dx * pull; a.y += dy * pull }
        if (j !== 0) { b.x -= dx * pull; b.y -= dy * pull }
      }
    }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j], boxA = boxes[i], boxB = boxes[j]
      const dx = b.x - a.x
      const dy = (b.y + (boxB.bottom + boxB.top) / 2) - (a.y + (boxA.bottom + boxA.top) / 2)
      const overlapX = (boxA.right - boxA.left + boxB.right - boxB.left) / 2 + 8 - Math.abs(dx)
      const overlapY = (boxA.bottom - boxA.top + boxB.bottom - boxB.top) / 2 + 9 - Math.abs(dy)
      if (overlapX <= 0 || overlapY <= 0) continue
      const amount = (Math.min(overlapX, overlapY) + .2) * (i === 0 ? 1 : .5)
      const shiftX = overlapX < overlapY ? (dx >= 0 ? 1 : -1) * amount : 0
      const shiftY = overlapY <= overlapX ? (dy >= 0 ? 1 : -1) * amount : 0
      if (i !== 0) { a.x -= shiftX; a.y -= shiftY }
      b.x += shiftX; b.y += shiftY
    }
  }
  return points
}

export function layoutKnowledgeGraph(nodes: readonly KnowledgeNode[], edges: readonly KnowledgeEdge[], aspect = 1.55) {
  const all = new Map(nodes.map(node => [node.id, node]))
  const adjacency = new Map(nodes.map(node => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (edge.from === edge.to || !all.has(edge.from) || !all.has(edge.to)) continue
    adjacency.get(edge.from)!.add(edge.to)
    adjacency.get(edge.to)!.add(edge.from)
  }
  const visited = new Set<string>(), components: KnowledgeNode[][] = [], isolated: KnowledgeNode[] = []
  for (const seed of all.values()) {
    if (visited.has(seed.id)) continue
    if (!adjacency.get(seed.id)!.size) {
      if (seed.center) components.push([seed])
      else isolated.push(seed)
      continue
    }
    const component = [seed]
    visited.add(seed.id)
    for (let i = 0; i < component.length; i++) {
      for (const id of adjacency.get(component[i].id)!) {
        if (!visited.has(id)) { visited.add(id); component.push(all.get(id)!) }
      }
    }
    components.push(component)
  }
  components.sort((a,b) => b.length - a.length)
  const arranged = components.map(group => { const points = placeComponent(group, adjacency, all, aspect); return { points, box: graphBounds(points, []) } })
  const area = arranged.reduce((sum, { box }) => sum + (box.right - box.left + 32) * (box.bottom - box.top + 29), 0)
  const sheetWidth = Math.max(Math.sqrt(area * 1.5), ...arranged.map(({box}) => box.right - box.left), Math.min(isolated.length, 4) * 148)
  const placed: PlacedNode[] = []
  let left = 0, top = 0, rowHeight = 0
  for (const { points, box } of arranged) {
    const width = box.right - box.left, height = box.bottom - box.top
    if (left && left + width > sheetWidth + .01) { top += rowHeight + 28; left = 0; rowHeight = 0 }
    points.forEach(p => placed.push({ ...p, x: p.x - box.left + left, y: p.y - box.top + top }))
    left += width + 30
    rowHeight = Math.max(rowHeight, height)
  }
  const groups = new Map<string, KnowledgeNode[]>()
  for (const node of isolated.sort((a,b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'))) {
    const label = node.group || '其他'
    const group = groups.get(label) ?? []
    group.push(node)
    groups.set(label, group)
  }
  if (!isolated.length) return { placed, bands: [] as GraphBand[] }
  const main = graphBounds(placed, [])
  const mainWidth = placed.length ? main.right - main.left : 0
  const mainHeight = placed.length ? main.bottom - main.top : 0
  // Keep the main network legible. A broad desktop can put the disconnected
  // groups alongside it, while a portrait viewport usually needs them below.
  let best = { columns: 1, side: false, score: 0 }
  const maxColumns = Math.min(8, Math.max(...[...groups.values()].map(members => members.length)))
  for (let columns = 1; columns <= maxColumns; columns++) {
    const groupWidth = columns * 148 + 12
    const groupHeight = [...groups.values()].reduce((h, members) => h + 39 + Math.ceil(members.length / columns) * 24, -7)
    for (const side of [false, true]) {
      const space = mainWidth ? 24 : 0
      const width = side ? mainWidth + space + groupWidth : Math.max(mainWidth, groupWidth)
      const height = side ? Math.max(mainHeight, groupHeight) : mainHeight + space + groupHeight
      const score = Math.min(aspect / width, 1 / height)
      if (score > best.score) best = { columns, side, score }
    }
  }
  const x = best.side && placed.length ? main.right + 24 : 0
  top = !best.side && placed.length ? main.bottom + 24 : 0
  const bands: GraphBand[] = []
  for (const [group, members] of groups) {
    const height = 32 + Math.ceil(members.length / best.columns) * 24
    bands.push({ left: x, top, right: x + best.columns * 148 + 12, bottom: top + height, title: group + ' · 当前无连线 ' + members.length })
    members.forEach((node,i) => placed.push({ ...node, isolated: true,
      x: x + 14 + i % best.columns * 148, y: top + 36 + Math.floor(i / best.columns) * 24 }))
    top += height + 7
  }
  return { placed, bands }
}

export function bundleOffsets(edges: readonly KnowledgeEdge[]) {
  const pairs = new Map<string, KnowledgeEdge[]>(), offsets = new Map<string, number>()
  for (const edge of edges) {
    const key = JSON.stringify([edge.from, edge.to].sort())
    const pair = pairs.get(key) ?? []
    pair.push(edge); pairs.set(key, pair)
  }
  for (const pair of pairs.values()) {
    pair.forEach((edge,i) => {
      const offset = pair.length === 1 ? 0 : (i - (pair.length - 1) / 2) * 52
      offsets.set(edge.id, edge.from < edge.to ? offset : -offset)
    })
  }
  return offsets
}

export function edgeCurve(from: PlacedNode, to: PlacedNode, offset: number) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx,dy) || 1
  const control = { x: (from.x + to.x) / 2 - dy / length * offset, y: (from.y + to.y) / 2 + dx / length * offset }
  function endpoint(node: PlacedNode) {
    const dx = control.x - node.x, dy = control.y - node.y, length = Math.hypot(dx,dy) || 1
    const r = radius(node) + 2
    return { x: node.x + dx / length * r, y: node.y + dy / length * r }
  }
  const start = endpoint(from), end = endpoint(to)
  return {
    path: 'M ' + start.x + ' ' + start.y + ' Q ' + control.x + ' ' + control.y + ' ' + end.x + ' ' + end.y,
    at(t: number) {
      const q = 1 - t
      return { x: q*q*start.x + 2*q*t*control.x + t*t*end.x, y: q*q*start.y + 2*q*t*control.y + t*t*end.y }
    },
  }
}

