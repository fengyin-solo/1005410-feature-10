import type { EntryRow } from './types'

// 预警业务口径的唯一来源：发布渠道、预警级别、雨量阈值判定都在这里，
// 预警发布页和支挡结构页点开看时取的是同一套，不允许各写各的。

/** 发布渠道（全系统同一套，顺序即展示顺序） */
export const WARNING_CHANNELS = [
  '短信平台',
  '应急广播',
  '铜锣员逐户通知',
  '政务公众号',
  '电视走字',
  '一键报警终端',
] as const

export type WarningChannel = (typeof WARNING_CHANNELS)[number]

/** 预警级别，由弱到强；触发雨量落入哪个雨量档，级别就算哪一级 */
export const WARNING_LEVELS = ['蓝色预警', '黄色预警', '橙色预警', '红色预警'] as const

export type WarningLevel = (typeof WARNING_LEVELS)[number]

/** 各级别对应的 24h 累计雨量下限（毫米），业务口径：雨量说了算 */
export const LEVEL_RAINFALL_MIN: Record<WarningLevel, number> = {
  蓝色预警: 50,
  黄色预警: 100,
  橙色预警: 150,
  红色预警: 250,
}

/** 24h 累计雨量的物理可信区间，越界（含负值、超量）一律挡回 */
export const RAINFALL_MIN = 0
export const RAINFALL_MAX = 500

export type RainfallCheck =
  | { ok: true; value: number }
  | { ok: false; reason: string }

/** 解析触发雨量，允许带 mm/毫米 等单位后缀；空值、非数字、越界都算不通过 */
export function checkRainfall(raw: unknown): RainfallCheck {
  const text = String(raw ?? '').trim()
  if (text === '' || text === '—') {
    return { ok: false, reason: '触发雨量未填' }
  }
  const matched = text.match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return { ok: false, reason: `触发雨量「${text}」无法识别为数值` }
  }
  const value = Number(matched[0])
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `触发雨量「${text}」不是有效数值` }
  }
  if (value < RAINFALL_MIN || value > RAINFALL_MAX) {
    return {
      ok: false,
      reason: `触发雨量 ${value}mm 越界，合理区间为 ${RAINFALL_MIN}~${RAINFALL_MAX}mm`,
    }
  }
  return { ok: true, value }
}

/** 按雨量档反算级别：以触发雨量为准，人工填的级别不作数 */
export function levelByRainfall(value: number): WarningLevel {
  if (value >= LEVEL_RAINFALL_MIN.红色预警) {
    return '红色预警'
  }
  if (value >= LEVEL_RAINFALL_MIN.橙色预警) {
    return '橙色预警'
  }
  if (value >= LEVEL_RAINFALL_MIN.黄色预警) {
    return '黄色预警'
  }
  return '蓝色预警'
}

export function isWarningLevel(value: unknown): value is WarningLevel {
  return WARNING_LEVELS.includes(value as WarningLevel)
}

export function isWarningChannel(value: unknown): value is WarningChannel {
  return WARNING_CHANNELS.includes(value as WarningChannel)
}

/** 把发布渠道字段拆成集合展示，单个和多个都兼容 */
export function splitChannels(raw: unknown): WarningChannel[] {
  return String(raw ?? '')
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter((item): item is WarningChannel => isWarningChannel(item))
}

export type WarningBucket = 'ready' | 'incomplete' | 'rejected'

export type PrecheckItem = {
  row: EntryRow
  bucket: WarningBucket
  /** 雨量判定后的应发级别；雨量不合格时为空 */
  derivedLevel: WarningLevel | null
  /** 级别缺失但雨量能反算时给出的补填建议 */
  suggestedLevel: WarningLevel | null
  reasons: string[]
}

export type PrecheckGroups = {
  ready: PrecheckItem[]
  incomplete: PrecheckItem[]
  rejected: PrecheckItem[]
}

/**
 * 发布前分组：
 * - rejected：触发雨量越界/不可识别的，挡回，不允许补一下就发
 * - incomplete：预警级别或发布渠道没填的，挑出来补填后单独处理
 * - ready：级别、渠道齐全，按雨量口径核对后照常发布
 */
export function precheckWarnings(rows: EntryRow[]): PrecheckGroups {
  const groups: PrecheckGroups = { ready: [], incomplete: [], rejected: [] }
  for (const row of rows) {
    const reasons: string[] = []
    const levelRaw = String(row.预警级别 ?? '').trim()
    const channelRaw = String(row.发布渠道 ?? '').trim()
    const rain = checkRainfall(row.触发雨量)

    if (!rain.ok) {
      groups.rejected.push({
        row,
        bucket: 'rejected',
        derivedLevel: null,
        suggestedLevel: null,
        reasons: [rain.reason],
      })
      continue
    }

    const derivedLevel = levelByRainfall(rain.value)
    const levelMissing = levelRaw === '' || levelRaw === '—'
    const levelInvalid = !levelMissing && !isWarningLevel(levelRaw)
    if (levelInvalid) {
      reasons.push(`预警级别「${levelRaw}」不在口径范围内（${WARNING_LEVELS.join('、')}）`)
    } else if (!levelMissing && levelRaw !== derivedLevel) {
      reasons.push(`填报级别 ${levelRaw} 与触发雨量 ${rain.value}mm 不符，按口径应为 ${derivedLevel}`)
    }

    const channels = splitChannels(channelRaw)
    if (channels.length === 0) {
      reasons.push(channelRaw === '' ? '发布渠道未填' : `发布渠道「${channelRaw}」不在统一渠道清单内`)
    }

    if (levelMissing) {
      reasons.push('预警级别未填')
    }

    const needSupplement = levelMissing || levelInvalid || channels.length === 0
    const item: PrecheckItem = {
      row,
      bucket: needSupplement ? 'incomplete' : 'ready',
      derivedLevel,
      suggestedLevel: levelMissing || levelInvalid ? derivedLevel : null,
      reasons,
    }
    groups[item.bucket].push(item)
  }
  return groups
}
