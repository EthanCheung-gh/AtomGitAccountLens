/**
 * localStorage 封装：令牌「记住本设备」（可选）与分析结果快照（不含令牌）。
 * Storage 可注入，便于单测。
 */
import type { AccountEvent, DeepCommitLite, GitCodeRepo, GitCodeUser } from '../api/types'
import type { DateRange } from './range'

const TOKEN_KEY = 'agl:token'
const SNAPSHOT_KEY = 'agl:snapshot:v1'
const RANGE_KEY = 'agl:range:v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function safeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

// ---------- 令牌 ----------

export function loadRememberedToken(storage?: StorageLike | null): string | null {
  const s = storage ?? safeStorage()
  if (!s) return null
  try {
    return s.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

/** @returns 是否写入成功（隐私模式/配额满时失败） */
export function saveRememberedToken(token: string, storage?: StorageLike | null): boolean {
  const s = storage ?? safeStorage()
  if (!s) return false
  try {
    s.setItem(TOKEN_KEY, token)
    return true
  } catch {
    return false
  }
}

export function clearRememberedToken(storage?: StorageLike | null): void {
  const s = storage ?? safeStorage()
  try {
    s?.removeItem(TOKEN_KEY)
  } catch {
    /* 忽略 */
  }
}

// ---------- 分析快照 ----------

export interface AnalysisSnapshot {
  version: 1
  createdAt: string
  login: string
  user: GitCodeUser
  repos: GitCodeRepo[]
  /** repoPath → 语言百分比表 */
  languagesByRepo: Record<string, Record<string, number>>
  /** year → 归一化事件（按日期升序排序后） */
  eventsByYear: Record<string, AccountEvent[]>
  /** 被排除的仓库 path（聚合时跳过） */
  excludedRepos: string[]
  /** events 拉取异常的年份 → 原因（'scope' 无权限 / 'error' 失败 / 'empty' 平台确认 0 条） */
  eventsUnavailable?: Record<string, 'scope' | 'error' | 'empty'>
  /** 深度抓取：repoPath → 最近提交（可选，用户手动触发后填充） */
  commitsRecentByRepo?: Record<string, DeepCommitLite[]>
  /**
   * 事件解析口径版本：低于当前版本时，快照里的 'empty' 标记视为不可信
   * （旧版本把「解析不出」当成「平台无数据」），加载后会自动重抓一次。
   */
  eventsCalibre?: number
}

/** 当前事件解析口径版本：2 = 形状无关解析（配合深扫，见 normalizeEventsPage） */
export const EVENTS_CALIBRE = 2

function isSnapshot(value: unknown): value is AnalysisSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<AnalysisSnapshot>
  return (
    v.version === 1 &&
    typeof v.createdAt === 'string' &&
    typeof v.login === 'string' &&
    !!v.user &&
    typeof v.user === 'object' &&
    Array.isArray(v.repos) &&
    !!v.languagesByRepo &&
    typeof v.languagesByRepo === 'object' &&
    !!v.eventsByYear &&
    typeof v.eventsByYear === 'object' &&
    Array.isArray(v.excludedRepos)
  )
}

export function loadSnapshot(storage?: StorageLike | null): AnalysisSnapshot | null {
  const s = storage ?? safeStorage()
  if (!s) return null
  try {
    const raw = s.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** @returns 是否写入成功（快照过大超配额时失败，调用方需提示） */
export function saveSnapshot(
  snapshot: AnalysisSnapshot,
  storage?: StorageLike | null,
): boolean {
  const s = storage ?? safeStorage()
  if (!s) return false
  try {
    s.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}

export function clearSnapshot(storage?: StorageLike | null): void {
  const s = storage ?? safeStorage()
  try {
    s?.removeItem(SNAPSHOT_KEY)
  } catch {
    /* 忽略 */
  }
}

// ---------- 时间区间偏好 ----------

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** 读取上次使用的时间区间（非法/缺失返回 null，由调用方回落到默认预设） */
export function loadRange(storage?: StorageLike | null): DateRange | null {
  const s = storage ?? safeStorage()
  if (!s) return null
  try {
    const raw = s.getItem(RANGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { start, end } = parsed as Partial<DateRange>
    if (typeof start !== 'string' || typeof end !== 'string') return null
    if (!DATE_KEY.test(start) || !DATE_KEY.test(end) || start > end) return null
    return { start, end }
  } catch {
    return null
  }
}

export function saveRange(range: DateRange, storage?: StorageLike | null): void {
  const s = storage ?? safeStorage()
  try {
    s?.setItem(RANGE_KEY, JSON.stringify(range))
  } catch {
    /* 忽略：偏好存不下不影响分析 */
  }
}
