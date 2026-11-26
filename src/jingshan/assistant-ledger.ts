import type { CityFeature, Dataset } from './types'

const aliases: Record<string, string[]> = {
  venues: ['场馆', '球馆'], court_footprints: ['网球场地', '实测场地'],
  businesses: ['企业', '产业主体'], events: ['赛事'], schools: ['学校'],
  charging: ['充电站', '充电'], commerce_hotels: ['限上住宿'], commerce_food: ['限上餐饮'],
  parking: ['停车'], investment_needs: ['招商需求'], parcels: ['地块'], investment_reserve_parcels:['地块','储备地块','选址地块'], projects: ['项目'],
}
export type LedgerHit = { layer: string; category: string; feature: CityFeature }
export type LedgerLayer = Pick<Dataset,'id'|'name'|'features'>
export type LedgerReply = { text: string; hits?: LedgerHit[]; layerId?: string }

function searchText(text:string) {
  return text.replace(/^(那么|那|换成|再查|请问|请|帮我|我想|查询|查找|搜索|查一下|看看|查看|列出|统计|找一下|有多少|有哪些|有几家|有几处|有几条)+/g, '')
    .replace(/(一共|共有|有多少|有几|多少|有哪些|都有哪些|有哪几|在哪里|在哪儿|在哪|的名单|的记录|台账|记录|有|的|家|处|条|个|呢|吗|[？?。，\s])+$/g, '').replace(/^的/, '')
}

export function queryLedger(question: string, layers: LedgerLayer[], area: string,
  inScope: (feature: CityFeature) => boolean, selected: string, previous?: LedgerReply): LedgerReply {
  if (!layers.length) return { text: '当前场景暂无可查询的已发布台账。' }
  const q = question.toLowerCase().trim()
  const available = layers.filter(layer => !selected || selected === layer.id)
  const inventories = available.map(layer => ({ layer, records: layer.features.filter(inScope) }))
  if (/^(台账概览|有哪些台账|查看台账概览)[？?。]?$/.test(q)) {
    return { text: area + '的台账记录如下：\n' + inventories.map(({ layer, records }) =>
      layer.name + '　' + records.length + ' 条').join('\n') }
  }
  const text = searchText(q)
  const named = inventories.flatMap(({layer,records}) => records
    .filter(feature => {
      const name=feature.properties.name?.trim().toLowerCase()
      return name && (name===q || name===text)
    }).map(feature => ({layer:layer.id,category:layer.name,feature})))
  if (named.length) {
    const sameLayer=named.every(hit=>hit.layer===named[0].layer)
    return {layerId:sameLayer ? named[0].layer : undefined, hits:named,
      text:area+'的'+(sameLayer ? named[0].category : '场景台账')+'中匹配到 '+named.length+' 条记录。'}
  }
  const terms = inventories.flatMap(({ layer }) => [layer.name, ...(aliases[layer.id] ?? [])]
    .filter(term => q.includes(term.toLowerCase())).map(term => ({ layer, term })))
  const term = terms.sort((a, b) => b.term.length - a.term.length)[0]
  const followUp = /^(那|那么|换成|再查)|呢[？?]?$/.test(q)
  const layerId = term?.layer.id ?? (followUp ? previous?.layerId : undefined) ?? selected
  const search = searchText(q.replace(term?.term.toLowerCase() ?? '', ''))
  const hits = inventories.filter(({ layer }) => !layerId || layerId === layer.id)
    .flatMap(({ layer, records }) => records.filter(feature => !search || search === area ||
      [feature.properties.name, feature.properties.region].some(value => value?.toLowerCase().includes(search)) ||
      (feature.properties.name && q.includes(feature.properties.name.toLowerCase())))
      .map(feature => ({ layer: layer.id, category: layer.name, feature })))
  const label = available.find(layer => layer.id === layerId)?.name ?? '场景台账'
  if (!hits.length) return { layerId, text: area + '的' + label + '中未找到匹配记录。可以输入更短的名称或镇街再查。' }
  return { layerId, text: area + '的' + label + '中匹配到 ' + hits.length + ' 条记录。', hits }
}
