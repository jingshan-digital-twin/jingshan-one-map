import type { EventAssessment } from './event-plan-types.ts'

// A generated plan is already being processed. Only explicit platform closure ends it.
export function assessmentStatus(plan?: EventAssessment): '待研判' | '处理中' | '已完结' {
  if (!plan || plan.withdrawnAt) return '待研判'
  return plan.status === 'completed' && !!plan.completedAt ? '已完结' : '处理中'
}

export function assessmentVersion(plan?: EventAssessment): number {
  if (!plan) return 0
  // Earlier plans incremented revision when submitting, before planVersion was stored separately.
  return plan.planVersion ?? Math.max(1, plan.revision - (plan.taskIds.length ? 1 : 0))
}

export function assessmentProgress(plan?: EventAssessment) {
  const ids = plan?.taskIds ?? []
  const feedback = ids.map(id => plan?.feedback?.find(item => item.taskId === id))
  const completed = feedback.filter(item => item?.status === 'completed').length
  const opinions = feedback.filter(item => item?.status === 'completed' && !!item.comment?.trim()).length
  const adopted = feedback.filter(item => item?.status === 'completed' && !!item.comment?.trim() && item.disposition === 'adopted').length
  return {
    total: ids.length, completed, opinions, adopted,
    canComplete: !!plan && plan.status === 'review' && !plan.completedAt && !plan.withdrawnAt && ids.length > 0 &&
      new Set(ids).size === ids.length && plan.departments.length === ids.length && completed === ids.length,
  }
}
