import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  checkRainfall,
  levelByRainfall,
  splitChannels,
  WARNING_LEVELS,
} from '@/data/warning-rules'
import type {
  ActionResult,
  BatchItemResult,
  BatchResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ── 预警发布：批量、单向状态机、幂等、雨量口径 ──────────────────────────

const WARNING_KEY = 'warning'
const WARNING_STATUS = {
  pending: '待发布',
  published: '已发布',
  released: '已解除',
  falseAlarm: '已误报',
} as const

export type WarningSupplement = {
  level?: string
  channels?: string[]
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function warningCode(row: EntryRow): string {
  return String(row.预警编号 ?? `#${row.id}`)
}

function summarize(results: BatchItemResult[]): BatchResult {
  return {
    items: results,
    successCount: results.filter((item) => item.ok).length,
    skipCount: results.filter((item) => item.outcome === 'skipped').length,
    deniedCount: results.filter((item) => !item.ok && item.outcome === 'denied').length,
  }
}

/**
 * 批量发布。只处理待发布：已是已发布的幂等跳过（不会多出第二条记录），
 * 已解除/已误报属于状态往前走，回不去，直接挡回。
 * 发布级别以触发雨量所在雨量档为准；缺级别/缺渠道的条目必须在 supplements 里补齐。
 */
export function publishWarnings(
  ids: number[],
  supplements: Record<number, WarningSupplement> = {},
): BatchResult {
  const rows = listRows(WARNING_KEY)
  const next = [...rows]
  const results: BatchItemResult[] = []

  for (const id of ids) {
    const index = next.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      results.push({ id, code: `#${id}`, ok: false, outcome: 'denied', message: '记录不存在' })
      continue
    }
    const row = next[index]
    const code = warningCode(row)
    const current = String(row.status)

    if (current === WARNING_STATUS.published) {
      results.push({ id, code, ok: true, outcome: 'skipped', message: '已发布，重复提交自动跳过，未新增记录' })
      continue
    }
    if (current === WARNING_STATUS.released || current === WARNING_STATUS.falseAlarm) {
      results.push({ id, code, ok: false, outcome: 'denied', message: `当前为「${current}」，状态单向流转，不能再发布` })
      continue
    }
    if (current !== WARNING_STATUS.pending) {
      results.push({ id, code, ok: false, outcome: 'denied', message: `当前为「${current}」，不是待发布状态` })
      continue
    }

    const rain = checkRainfall(row.触发雨量)
    if (!rain.ok) {
      results.push({ id, code, ok: false, outcome: 'denied', message: rain.reason })
      continue
    }
    const derivedLevel = levelByRainfall(rain.value)
    const supplement = supplements[id]
    const filledLevel = String(row.预警级别 ?? '').trim() || String(supplement?.level ?? '').trim()
    const filledChannels =
      splitChannels(row.发布渠道).length > 0
        ? splitChannels(row.发布渠道)
        : (supplement?.channels ?? [])

    if (!filledLevel || !WARNING_LEVELS.includes(filledLevel as (typeof WARNING_LEVELS)[number])) {
      results.push({ id, code, ok: false, outcome: 'denied', message: '预警级别未补齐，暂缓发布' })
      continue
    }
    if (filledChannels.length === 0) {
      results.push({ id, code, ok: false, outcome: 'denied', message: '发布渠道未补齐，暂缓发布' })
      continue
    }

    const originalLevel = String(row.预警级别 ?? '').trim()
    next[index] = {
      ...row,
      status: WARNING_STATUS.published,
      pending: true,
      预警级别: derivedLevel,
      发布渠道: filledChannels.join('、'),
      发布时间: today(),
    }
    const adjusted = originalLevel !== '' && originalLevel !== derivedLevel
    results.push({
      id,
      code,
      ok: true,
      outcome: 'published',
      message: adjusted
        ? `已按 ${rain.value}mm 雨量口径发布为${derivedLevel}（原填${originalLevel}）`
        : `已发布：${derivedLevel}，渠道 ${filledChannels.join('、')}`,
    })
  }

  saveRows(WARNING_KEY, next)
  return summarize(results)
}

/** 批量解除：只有已发布能解除；待发布不能跳级解除，已解除幂等跳过，已误报不能回头。 */
export function releaseWarnings(ids: number[]): BatchResult {
  const rows = listRows(WARNING_KEY)
  const next = [...rows]
  const results: BatchItemResult[] = []

  for (const id of ids) {
    const index = next.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      results.push({ id, code: `#${id}`, ok: false, outcome: 'denied', message: '记录不存在' })
      continue
    }
    const row = next[index]
    const code = warningCode(row)
    const current = String(row.status)

    if (current === WARNING_STATUS.released) {
      results.push({ id, code, ok: true, outcome: 'skipped', message: '已解除，重复提交自动跳过，未新增记录' })
      continue
    }
    if (current === WARNING_STATUS.published) {
      next[index] = { ...row, status: WARNING_STATUS.released, pending: false, 解除时间: today() }
      results.push({ id, code, ok: true, outcome: 'released', message: '已解除' })
      continue
    }
    if (current === WARNING_STATUS.falseAlarm) {
      results.push({ id, code, ok: false, outcome: 'denied', message: '已误报，状态单向流转，不能解除' })
    } else {
      results.push({ id, code, ok: false, outcome: 'denied', message: `「${current}」不能直接解除，须先发布` })
    }
  }

  saveRows(WARNING_KEY, next)
  return summarize(results)
}

/** 单条误报：只允许已发布标记误报，其余状态不开口子 */
export function markFalseAlarm(id: number): ActionResult {
  const rows = listRows(WARNING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条预警信息' }
  }
  const current = String(rows[index].status)
  if (current === WARNING_STATUS.falseAlarm) {
    return { ok: false, message: '已是「已误报」，重复操作不生效' }
  }
  if (current !== WARNING_STATUS.published) {
    return { ok: false, message: `「${current}」状态不能标记误报，只有已发布可以` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], status: WARNING_STATUS.falseAlarm, pending: false }
  saveRows(WARNING_KEY, next)
  return { ok: true, message: '已标记误报' }
}

export type PendingRelocationWarning = {
  warning: EntryRow
  wall: EntryRow | null
}

/**
 * 发布结论落到支挡结构清单：发布对象命中结构编号的已发布预警，
 * 在对应支挡结构上派生一条待转移预警。数据仍只有预警这一份，重复发布不会多一条。
 */
export function listPendingRelocationWarnings(): PendingRelocationWarning[] {
  const published = listRows(WARNING_KEY).filter(
    (row) => String(row.status) === WARNING_STATUS.published,
  )
  const walls = listRows('wall')
  return published.map((warning) => {
    const target = String(warning.发布对象 ?? '').trim()
    const wall =
      walls.find((item) => String(item.结构编号 ?? '').trim() === target) ?? null
    return { warning, wall }
  })
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
