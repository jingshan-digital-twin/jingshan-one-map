import { chain, type ChainTopic } from '../src/jingshan/chain-taxonomy.ts'
import type { Dataset } from '../src/jingshan/types.ts'

// Amounts in 万元. Every subtotal is derived from these twelve leaves.
const amounts = {
  器材制造: 19_100,
  运动服饰: 6_500,
  场地建设: 23_900,
  场馆运营: 37_300,
  俱乐部运营: 17_900,
  培训陪练: 70_200,
  赛事组织: 47_000,
  住宿接待: 28_600,
  餐饮服务: 42_800,
  景区游览: 19_800,
  运动康养: 7_700,
  购物展销: 29_200,
} satisfies Record<ChainTopic, number>

const outputSource = '按京山市 2025 年全链 35 亿元估值和原产业全景演示数据的环节权重分摊。原合并食宿项按住宿 40%、餐饮 60% 拆分，按 0.01 亿元取整并调平尾差。'

export function createCityOutputEstimateDataset(): Dataset {
  return {
    id: 'industry_output', name: '产业年度产值', category: '产业链诊断', department: '产业全景',
    description: outputSource,
    features: chain.flatMap(stage => stage.topics.map(topic => ({
      id: 'industry-output-estimate-2025-' + topic,
      type: 'Feature' as const,
      geometry: {type: 'GeometryCollection' as const, geometries: []},
      properties: {
        name: '2025 · ' + stage.id + ' · ' + topic,
        kind: 'industry_output', region: '京山市', year: 2025, chainStage: stage.id, chainTopic: topic,
        outputWanYuan: amounts[topic], outputBasis: 'estimate', outputSource,
      },
    }))),
  }
}
