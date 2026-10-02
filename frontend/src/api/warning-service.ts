import { listRows, saveRows } from '@/data/local-store'
import {
  RAINFALL_RANGE,
  TRIGGER_MIN,
  WARNING_CHANNELS,
  canTransit,
  deriveLevelByRainfall,
  isRainfallOutOfRange,
  parseRainfall,
} from '@/data/warning-rules'
import type { EntryRow } from '@/data/types'

// 预警发布的批量操作与单向流转都收在这里：页面只负责渲染，判定口径统一走这一层。

const WARNING_KEY = 'warning'
/** 支挡结构模块下的「待转移预警清单」，与预警发布共用一个本地存储。 */
const TRANSFER_KEY = 'wall-transfer'

export type BatchKind = 'published' | 'cancelled' | 'needs-fix' | 'rejected' | 'skipped'

export type BatchItem = {
  id: number
  code: string
  kind: BatchKind
  message: string
}

export type BatchResult = {
  action: string
  items: BatchItem[]
  done: number
  needsFix: number
  rejected: number
  skipped: number
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function summarize(action: string, items: BatchItem[]): BatchResult {
  return {
    action,
    items,
    done: items.filter((item) => item.kind === 'published' || item.kind === 'cancelled').length,
    needsFix: items.filter((item) => item.kind === 'needs-fix').length,
    rejected: items.filter((item) => item.kind === 'rejected').length,
    skipped: items.filter((item) => item.kind === 'skipped').length,
  }
}

/** 发布结论落到支挡结构的清单：按预警编号去重，重复提交不会多出第二条。 */
function appendTransferRows(published: EntryRow[]): number {
  if (published.length === 0) {
    return 0
  }
  const rows = listRows(TRANSFER_KEY)
  const existing = new Set(rows.map((row) => String(row['预警编号'])))
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const added: EntryRow[] = []
  for (const row of published) {
    const code = String(row['预警编号'])
    if (existing.has(code)) {
      continue
    }
    existing.add(code)
    nextId += 1
    added.push({
      id: nextId,
      status: '待转移',
      pending: true,
      abnormal: false,
      预警编号: code,
      发布对象: row['发布对象'] ?? '',
      预警级别: row['预警级别'] ?? '',
      触发雨量: row['触发雨量'] ?? '',
      发布渠道: row['发布渠道'] ?? '',
      发布时间: row['发布时间'] ?? '',
    })
  }
  if (added.length > 0) {
    saveRows(TRANSFER_KEY, [...rows, ...added])
  }
  return added.length
}

/**
 * 单条发布判定：状态只进不退；雨量越界直接挡回；
 * 级别或渠道没填的挑出来单独处理；级别与雨量口径不一致时以雨量为准。
 */
function publishOne(row: EntryRow): { item: BatchItem; row: EntryRow | null } {
  const code = String(row['预警编号'] ?? row.id)
  const status = String(row.status)
  if (status === '已发布') {
    return { item: { id: Number(row.id), code, kind: 'skipped', message: '已是「已发布」，不重复处理' }, row: null }
  }
  if (!canTransit(status, '已发布')) {
    return { item: { id: Number(row.id), code, kind: 'skipped', message: `「${status}」是终态，只进不退，不能再发布` }, row: null }
  }
  const rainfall = parseRainfall(row['触发雨量'])
  if (rainfall === null) {
    return { item: { id: Number(row.id), code, kind: 'rejected', message: '触发雨量缺失或不是数值，已挡回' }, row: null }
  }
  if (isRainfallOutOfRange(rainfall)) {
    return {
      item: {
        id: Number(row.id),
        code,
        kind: 'rejected',
        message: `触发雨量 ${rainfall}mm 越界（量程 ${RAINFALL_RANGE.min}–${RAINFALL_RANGE.max}mm），已挡回`,
      },
      row: null,
    }
  }
  if (rainfall < TRIGGER_MIN) {
    return { item: { id: Number(row.id), code, kind: 'rejected', message: `触发雨量 ${rainfall}mm 未达蓝色起报线 ${TRIGGER_MIN}mm，已挡回` }, row: null }
  }
  const level = String(row['预警级别'] ?? '').trim()
  const channel = String(row['发布渠道'] ?? '').trim()
  const missing: string[] = []
  if (level === '') {
    missing.push('预警级别')
  }
  if (channel === '') {
    missing.push('发布渠道')
  } else if (!(WARNING_CHANNELS as readonly string[]).includes(channel)) {
    return { item: { id: Number(row.id), code, kind: 'needs-fix', message: `发布渠道「${channel}」不在统一目录内，挑出来单独处理` }, row: null }
  }
  if (missing.length > 0) {
    return { item: { id: Number(row.id), code, kind: 'needs-fix', message: `${missing.join('、')}没填，挑出来单独处理` }, row: null }
  }
  const derived = deriveLevelByRainfall(rainfall) as string
  const corrected = derived !== level
  const next: EntryRow = {
    ...row,
    status: '已发布',
    pending: true,
    abnormal: false,
    预警级别: derived,
    发布时间: today(),
    预警状态: '已发布',
  }
  return {
    item: {
      id: Number(row.id),
      code,
      kind: 'published',
      message: corrected
        ? `已发布；按雨量口径 ${rainfall}mm 定为「${derived}」，已校正原填的「${level}」`
        : `已发布，级别「${derived}」与雨量口径一致`,
    },
    row: next,
  }
}

/** 批量发布：选中的一起发，逐条报结果；重复提交不会改状态、也不会多出转移记录。 */
export function publishWarnings(ids: number[]): BatchResult {
  const rows = listRows(WARNING_KEY)
  const items: BatchItem[] = []
  const changed = new Map<number, EntryRow>()
  const published: EntryRow[] = []
  for (const id of ids) {
    const row = rows.find((item) => Number(item.id) === id)
    if (!row) {
      items.push({ id, code: String(id), kind: 'skipped', message: '没有找到这条预警，可能已被移除' })
      continue
    }
    const outcome = publishOne(changed.get(id) ?? row)
    items.push(outcome.item)
    if (outcome.row) {
      changed.set(id, outcome.row)
      published.push(outcome.row)
    }
  }
  if (changed.size > 0) {
    saveRows(WARNING_KEY, rows.map((row) => changed.get(Number(row.id)) ?? row))
    appendTransferRows(published)
  }
  return summarize('批量发布', items)
}

/** 批量解除：只有「已发布」能解除，其余逐条说明。 */
export function cancelWarnings(ids: number[]): BatchResult {
  const rows = listRows(WARNING_KEY)
  const items: BatchItem[] = []
  const changed = new Map<number, EntryRow>()
  for (const id of ids) {
    const row = rows.find((item) => Number(item.id) === id)
    if (!row) {
      items.push({ id, code: String(id), kind: 'skipped', message: '没有找到这条预警，可能已被移除' })
      continue
    }
    const code = String(row['预警编号'] ?? id)
    const status = String(row.status)
    if (status === '已解除') {
      items.push({ id, code, kind: 'skipped', message: '已是「已解除」，不重复处理' })
      continue
    }
    if (!canTransit(status, '已解除')) {
      items.push({ id, code, kind: 'skipped', message: `「${status}」不允许解除，只进不退` })
      continue
    }
    changed.set(id, { ...row, status: '已解除', pending: false, abnormal: false, 解除时间: today(), 预警状态: '已解除' })
    items.push({ id, code, kind: 'cancelled', message: '已解除' })
  }
  if (changed.size > 0) {
    saveRows(WARNING_KEY, rows.map((row) => changed.get(Number(row.id)) ?? row))
  }
  return summarize('批量解除', items)
}

/** 单独处理：补录级别、渠道后再走同一条发布判定，口径不变。 */
export function completeAndPublish(id: number, patch: { 预警级别: string; 发布渠道: string }): BatchItem {
  const rows = listRows(WARNING_KEY)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { id, code: String(id), kind: 'skipped', message: '没有找到这条预警，可能已被移除' }
  }
  const filled: EntryRow = { ...row, 预警级别: patch.预警级别.trim(), 发布渠道: patch.发布渠道.trim() }
  const outcome = publishOne(filled)
  if (outcome.row) {
    saveRows(WARNING_KEY, rows.map((item) => (Number(item.id) === id ? outcome.row as EntryRow : item)))
    appendTransferRows([outcome.row])
  }
  return outcome.item
}

/** 行内误报：只许从「已发布」走，终态不再动。 */
export function markFalseAlarm(id: number): BatchItem {
  const rows = listRows(WARNING_KEY)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { id, code: String(id), kind: 'skipped', message: '没有找到这条预警，可能已被移除' }
  }
  const code = String(row['预警编号'] ?? id)
  const status = String(row.status)
  if (status === '已误报') {
    return { id, code, kind: 'skipped', message: '已是「已误报」，不重复处理' }
  }
  if (!canTransit(status, '已误报')) {
    return { id, code, kind: 'skipped', message: `「${status}」不允许标记误报，只进不退` }
  }
  saveRows(
    WARNING_KEY,
    rows.map((item) =>
      Number(item.id) === id ? { ...item, status: '已误报', pending: false, abnormal: true, 预警状态: '已误报' } : item,
    ),
  )
  return { id, code, kind: 'cancelled', message: '已标记误报' }
}

export function listTransferWarnings(): EntryRow[] {
  return listRows(TRANSFER_KEY)
}

/** 转移清单的确认转移：同样是单向的，待转移 → 已转移。 */
export function confirmTransfer(id: number): { ok: boolean; message: string } {
  const rows = listRows(TRANSFER_KEY)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: '没有找到这条待转移预警' }
  }
  if (String(row.status) === '已转移') {
    return { ok: false, message: '这条预警已登记转移，不重复处理' }
  }
  saveRows(
    TRANSFER_KEY,
    rows.map((item) => (Number(item.id) === id ? { ...item, status: '已转移', pending: false } : item)),
  )
  return { ok: true, message: `预警 ${row['预警编号']} 已登记转移` }
}
