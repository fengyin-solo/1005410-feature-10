// 预警发布的业务口径：渠道目录、级别阈值、雨量边界、单向流转都集中在这里，
// 预警发布页和支挡结构页的「待转移预警清单」共用这一份，保证两处看到的是同一套。

/** 发布渠道统一目录：预警发布与支挡结构的转移清单都从这里取，不允许另起一套。 */
export const WARNING_CHANNELS = ['短信平台', '应急广播', '微信群', '铜锣哨子', '入户敲门'] as const

/** 预警级别，按由轻到重排列。 */
export const WARNING_LEVELS = ['蓝色', '黄色', '橙色', '红色'] as const

/** 触发雨量的合法量程（毫米）：超出这个区间就是越界值，直接挡回。 */
export const RAINFALL_RANGE = { min: 0, max: 500 } as const

/**
 * 级别判定口径：以触发雨量为准。达到哪一档阈值就是哪一级，
 * 手工填的级别与雨量口径不一致时，按雨量口径校正。
 */
export const LEVEL_THRESHOLDS: { level: (typeof WARNING_LEVELS)[number]; min: number }[] = [
  { level: '红色', min: 150 },
  { level: '橙色', min: 100 },
  { level: '黄色', min: 50 },
  { level: '蓝色', min: 25 },
]

/** 触发雨量的起报下限：低于这个值够不上蓝色，不能发布。 */
export const TRIGGER_MIN = 25

/** 单向状态机：只许往前走，已解除、已误报是终态，回头的口子不开。 */
export const WARNING_TRANSITIONS: Record<string, string[]> = {
  待发布: ['已发布'],
  已发布: ['已解除', '已误报'],
  已解除: [],
  已误报: [],
}

export function canTransit(from: string, to: string): boolean {
  return (WARNING_TRANSITIONS[from] ?? []).includes(to)
}

/** 解析触发雨量：不是数值返回 null。 */
export function parseRainfall(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  const text = String(raw ?? '').trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** 越界判定：量程之外的读数不可信，发布时挡回。 */
export function isRainfallOutOfRange(value: number): boolean {
  return value < RAINFALL_RANGE.min || value > RAINFALL_RANGE.max
}

/** 按业务口径由触发雨量定级别；低于起报下限返回 null。 */
export function deriveLevelByRainfall(value: number): string | null {
  for (const { level, min } of LEVEL_THRESHOLDS) {
    if (value >= min) {
      return level
    }
  }
  return null
}
