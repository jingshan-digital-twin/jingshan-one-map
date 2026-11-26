import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bundleOffsets, edgeCurve, graphBounds, layoutKnowledgeGraph, nodeBounds } from '../src/jingshan/knowledge-graph-layout.ts'

const company = (id, group = '中游') => ({ id, name: '京山市' + id + '体育产业有限公司', group, kind: 'enterprise' })
const relationship = (id, from, to, label) => ({ id, from, to, label, kind: 'business', direction: 'out' })

test('只有当前企业时保留中心节点及完整标签', () => {
  const center = { ...company('网产'), center: true }
  const { placed, bands } = layoutKnowledgeGraph([center], [], .75)
  assert.equal(placed.length, 1)
  assert.equal(placed[0].id, center.id)
  assert.equal(placed[0].isolated, false)
  assert.deepEqual(bands, [])
})

test('完整图保留跨企业关系和未连线主体，适配宽屏与竖屏', () => {
  const nodes = [{ ...company('网产'), center:true }, company('顺星','上游'), company('世杰'), company('酒店','下游'),
    ...Array.from({length:20},(_,i) => company('单独主体' + i, i < 8 ? '上游' : '下游'))]
  const edges = [relationship('招标','网产','顺星','招标与中标'), relationship('赛事','网产','世杰','共同承办'),
    relationship('配套','世杰','酒店','采购服务')]
  for (const aspect of [.6,2]) {
    const { placed,bands } = layoutKnowledgeGraph(nodes,edges,aspect)
    assert.deepEqual(new Set(placed.map(node => node.id)),new Set(nodes.map(node => node.id)))
    assert.equal(placed.filter(node => node.isolated).length,20)
    assert.equal(bands.length,2)
    const bounds=graphBounds(placed,bands)
    for (const n of placed) {
      const b=nodeBounds(n)
      assert.ok(b.left>=bounds.left && b.right<=bounds.right && b.top>=bounds.top && b.bottom<=bounds.bottom)
    }
    const active=placed.filter(n=>!n.isolated)
    active.forEach((n,i)=>active.slice(i+1).forEach(other=>{
      const a=nodeBounds(n),b=nodeBounds(other)
      assert.ok(a.left>=b.right || a.right<=b.left || a.bottom<=b.top || a.top>=b.bottom)
    }))
  }
})
test('同一对主体的并行关系保持独立曲线，反向边也可选中', () => {
  const edges=[relationship('a','甲','乙','供货'),relationship('b','乙','甲','提供服务')]
  const offsets=bundleOffsets(edges)
  const a={...company('甲'),x:0,y:0,isolated:false}, b={...company('乙'),x:100,y:0,isolated:false}
  assert.notEqual(edgeCurve(a,b,offsets.get('a')).at(.5).y,edgeCurve(b,a,offsets.get('b')).at(.5).y)
})

