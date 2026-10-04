/**
 * localStorage 封装：令牌「记住本设备」（可选）与分析结果快照（不含令牌）。
 * Storage 可注入，便于单测。
 */
import type { AccountEvent, DeepCommitLite, GitCodeRepo, GitCodeUser } from '../api/types'

const TOKEN_KEY = 'agl:token'
const SNAPSHOT_KEY = 'agl:snapshot:v1'

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
  /** events 拉取失败的年份 → 原因（'scope' | 'error'） */
  eventsUnavailable?: Record<string, 'scope' | 'error'>
  /** 深度抓取：repoPath → 最近提交（可选，用户手动触发后填充） */
  commitsRecentByRepo?: Record<string, DeepCommitLite[]>
}

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
