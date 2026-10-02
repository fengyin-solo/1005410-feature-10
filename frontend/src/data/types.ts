/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 批量处理时每一条的处置结论，逐条报结果用 */
export type BatchItemResult = {
  id: number
  code: string
  ok: boolean
  /** published 发布成功 / released 解除成功 / skipped 幂等跳过 / denied 被挡回 */
  outcome: 'published' | 'released' | 'skipped' | 'denied'
  message: string
}

export type BatchResult = {
  items: BatchItemResult[]
  successCount: number
  skipCount: number
  deniedCount: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
