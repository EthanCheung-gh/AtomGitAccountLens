/**
 * 非自然年时间区间：把"按年切片"升级为"任意起止日期"。
 *
 * 口径说明（写入 README）：
 * - 区间是闭区间，日期字符串比较（YYYY-MM-DD 字典序即时间序），避免时区偏移；
 * - 动态（events）只能按年抓取，因此区间覆盖到的年份必须已抓取，未抓取的年份由
 *   `missingYears` 报出来，交给补抓流程；
 * - 提交级数据（全时段抓取）不受年限制，同样用本文件的区间过滤。
 */
import type { AccountEvent, DeepCommitLite } from '../api/types'

export interface DateRange {
  /** YYYY-MM-DD（含） */
  start: string
  /** YYYY-MM-DD（含） */
  end: string
}

export type RangePresetKey = '7d' | '30d' | '90d' | '12m' | 'quarter' | 'year' | 'all'

export const RANGE_PRESETS: { key: RangePresetKey; label: string }[] = [
  { key: '7d', label: '最近 7 天' },
  { key: '30d', label: '最近 30 天' },
  { key: '90d', label: '最近 90 天' },
  { key: '12m', label: '最近 12 个月' },
  { key: 'quarter', label: '本季度' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' },
]

/** 本地日期 → YYYY-MM-DD（不用 toISOString，避免 UTC 偏移把日期推错一天） */
export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base.getTime())
  d.setDate(d.getDate() + days)
  return d
}

/**
 * 预设区间。`earliest` 用于「全部」的左端（通常是账号创建日或最早数据日）。
 */
export function presetRange(
  key: RangePresetKey,
  opts: { today?: Date; earliest?: string | null } = {},
): DateRange {
  const today = opts.today ?? new Date()
  const end = toDateKey(today)
  switch (key) {
    case '7d':
      return { start: toDateKey(shiftDays(today, -6)), end }
    case '30d':
      return { start: toDateKey(shiftDays(today, -29)), end }
    case '90d':
      return { start: toDateKey(shiftDays(today, -89)), end }
    case '12m': {
      const d = new Date(today.getTime())
      d.setFullYear(d.getFullYear() - 1)
      d.setDate(d.getDate() + 1) // 含今天正好满 12 个月
      return { start: toDateKey(d), end }
    }
    case 'quarter': {
      const q = Math.floor(today.getMonth() / 3)
      return { start: `${today.getFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`, end }
    }
    case 'year':
      return { start: `${today.getFullYear()}-01-01`, end }
    case 'all':
    default:
      return { start: opts.earliest && opts.earliest < end ? opts.earliest : end, end }
  }
}

/** 区间覆盖的年份（升序） */
export function rangeYears(range: DateRange): number[] {
  const sy = Number(range.start.slice(0, 4))
  const ey = Number(range.end.slice(0, 4))
  if (!Number.isFinite(sy) || !Number.isFinite(ey)) return []
  const out: number[] = []
  for (let y = sy; y <= ey; y++) out.push(y)
  return out
}

/** 是否为完整自然年（用于把「2026 年」而不是「2026-01-01 ~ 2026-12-31」展示出来） */
export function isFullYear(range: DateRange): number | null {
  const y = range.start.slice(0, 4)
  if (`${y}-01-01` === range.start && `${y}-12-31` === range.end) return Number(y)
  return null
}

/** 日期是否落在区间内（闭区间） */
export function inRange(date: string, range: DateRange): boolean {
  if (!date) return false
  const key = date.slice(0, 10)
  return key >= range.start && key <= range.end
}

/** 区间文案：整年 → 「2026 年」，否则 → 「2025-10-27 ~ 2026-10-26」 */
export function formatRangeLabel(range: DateRange): string {
  const y = isFullYear(range)
  if (y !== null) return `${y} 年`
  return `${range.start} ~ ${range.end}`
}

/** 区间内应抓取但尚未抓取的年份（已确认无权限的年份不重复抓） */
export function missingYears(
  range: DateRange,
  eventsByYear: Record<string, AccountEvent[]> | undefined,
  eventsUnavailable: Record<string, 'scope' | 'error'> | undefined,
): number[] {
  return rangeYears(range).filter((y) => {
    const key = String(y)
    const has = (eventsByYear?.[key]?.length ?? 0) > 0
    return !has && !eventsUnavailable?.[key]
  })
}

/** 汇总区间内的动态事件（跨年合并后再过滤，保证口径与图表一致） */
export function collectEvents(
  eventsByYear: Record<string, AccountEvent[]> | undefined,
  range: DateRange,
): AccountEvent[] {
  if (!eventsByYear) return []
  const out: AccountEvent[] = []
  for (const list of Object.values(eventsByYear)) {
    for (const e of list) if (inRange(e.date, range)) out.push(e)
  }
  return out
}

/** 区间内的提交（拍平 repo → 提交，保留仓库名用于分组） */
export function collectCommits(
  commitsByRepo: Record<string, DeepCommitLite[]> | undefined,
  range: DateRange,
  login?: string,
): { repo: string; commit: DeepCommitLite }[] {
  if (!commitsByRepo) return []
  const out: { repo: string; commit: DeepCommitLite }[] = []
  for (const [repo, list] of Object.entries(commitsByRepo)) {
    for (const c of list) {
      if (!inRange(c.date, range)) continue
      if (login && c.author && c.author.toLowerCase() !== login.toLowerCase()) continue
      out.push({ repo, commit: c })
    }
  }
  return out
}
