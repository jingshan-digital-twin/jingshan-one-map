import { eventTopics, type AssessmentSelection, type AssessmentTopic, type AssessmentItem } from './event-plan-types.ts'

export function allAssessmentItems(topics: AssessmentTopic[]): AssessmentSelection {
  return Object.fromEntries(topics.map(topic => [topic.id,topic.items.map(item => item.id)])) as AssessmentSelection
}

// Accept identifiers only. Topic contents, geometries and responsibility always come from the saved plan.
export function checkedSelection(topics: AssessmentTopic[], value: unknown): AssessmentSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== eventTopics.length)
    throw new Error('请提交八项专项预案的勾选结果')
  const selection = allAssessmentItems(topics)
  for (const [id,label] of eventTopics) {
    const ids = (value as Record<string,unknown>)[id]
    if (!Array.isArray(ids) || !selection[id] || ids.length > selection[id].length)
      throw new Error('请核对'+label+'的子项')
    const chosen = new Set(ids)
    selection[id] = selection[id].filter(item => chosen.has(item))
    if (selection[id].length !== ids.length) throw new Error(label+'存在重复或无效的子项')
  }
  return selection
}

export function selectedTopics(topics: AssessmentTopic[], selection?: AssessmentSelection): AssessmentTopic[] {
  if (!selection) return topics
  return topics.map(topic => {
    const ids = new Set(selection[topic.id])
    return {...topic, items:topic.items.filter(item => ids.has(item.id))}
  }).filter(topic => topic.items.length)
}

export function sameSelection(a: AssessmentSelection, b: AssessmentSelection) {
  return eventTopics.every(([id]) => a[id].length === b[id].length && a[id].every(item => b[id].includes(item)))
}

export function itemDescription(item: AssessmentItem) {
  return item.controlWindow ? item.detail+' · 管控时段：'+item.controlWindow : item.detail
}
