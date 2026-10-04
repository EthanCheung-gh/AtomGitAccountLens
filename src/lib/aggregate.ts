/**
 * 聚合纯函数：仓库指标、语言占比（口径见 aggregateLanguages）、事件汇总。
 * 全部无副作用，供各 Tab 与单测使用。
 */
import type { AccountEvent, GitCodeRepo } from '../api/types'

/** 仓库规范路径 "owner/repo"（优先 path_with_namespace） */
export function repoPath(repo: GitCodeRepo): string {
  if (repo.path_with_namespace) return repo.path_with_namespace
  const ns = repo.namespace?.path
  if (ns && repo.path) return `${ns}/${repo.path}`
  if (repo.full_name) return repo.full_name
  return repo.path ?? repo.name ?? ''
}

/** 拆出 owner 与 repo 名（用于逐仓库 API 调用），无法拆分时返回 null */
export function repoOwnerName(repo: GitCodeRepo): { owner: string; repo: string } | null {
  const path = repoPath(repo)
  const idx = path.indexOf('/')
  if (idx <= 0 || idx === path.length - 1) return null
  return { owner: path.slice(0, idx), repo: path.slice(idx + 1) }
}

export interface RepoMetrics {
  total: number
  included: number
  excluded: number
  stars: number
  forks: number
  publicCount: number
  privateCount: number
  forkedCount: number
  /** 近 365 天有 push 的仓库数（计入统计口径内） */
  activeCount: number
  newestPushAt: string | null
}

export function repoMetrics(repos: GitCodeRepo[], excluded: string[]): RepoMetrics {
  const excludedSet = new Set(excluded)
  const m: RepoMetrics = {
    total: repos.length,
    included: 0,
    excluded: 0,
    stars: 0,
    forks: 0,
    publicCount: 0,
    privateCount: 0,
    forkedCount: 0,
    activeCount: 0,
    newestPushAt: null,
  }
  const yearAgo = Date.now() - 365 * 24 * 3600 * 1000
  for (const repo of repos) {
    const path = repoPath(repo)
    const isExcluded = path !== '' && excludedSet.has(path)
    if (isExcluded) {
      m.excluded += 1
      continue
    }
    m.included += 1
    m.stars += repo.stargazers_count ?? 0
    m.forks += repo.forks_count ?? 0
    if (repo.private) m.privateCount += 1
    else m.publicCount += 1
    if (repo.fork) m.forkedCount += 1
    const pushed = repo.pushed_at ?? repo.updated_at ?? null
    if (pushed) {
      if (!m.newestPushAt || pushed > m.newestPushAt) m.newestPushAt = pushed
      if (new Date(pushed).getTime() >= yearAgo) m.activeCount += 1
    }
  }
  return m
}

export interface LanguageStat {
  language: string
  /** 主语言为该语言的仓库数 */
  repoCount: number
  /** 权重 = 各仓库中该语言百分比之和（0-100/仓库） */
  weight: number
  /** 占总权重的百分比 */
  percent: number
}

/**
 * 账号级语言占比。
 *
 * 口径（写入 README）：
 * - GitCode 的 /repos/{o}/{r}/languages 返回的是各语言百分比（非字节数），
 *   因此账号级占比 = 各仓库百分比的加权和 / 总权重；
 * - 「主语言」取仓库 language 字段，缺失时取该仓库语言表中百分比最高者；
 * - repoCount 表示主语言为该语言的仓库数，与 percent（加权占比）是两个视角。
 */
export function aggregateLanguages(
  repos: GitCodeRepo[],
  languagesByRepo: Record<string, Record<string, number>>,
  excluded: string[],
): LanguageStat[] {
  const excludedSet = new Set(excluded)
  const stats = new Map<string, { repoCount: number; weight: number }>()

  const add = (lang: string, weight: number) => {
    if (!lang) return
    const cur = stats.get(lang) ?? { repoCount: 0, weight: 0 }
    cur.weight += weight
    stats.set(lang, cur)
  }

  for (const repo of repos) {
    const path = repoPath(repo)
    if (path === '' || excludedSet.has(path)) continue
    const langs = languagesByRepo[path] ?? {}
    const entries = Object.entries(langs).filter(([, v]) => typeof v === 'number' && v > 0)
    for (const [lang, pct] of entries) add(lang, pct)

    // 主语言计数
    let major: string | null = repo.language ?? null
    if (!major && entries.length > 0) {
      major = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    }
    if (major) {
      const cur = stats.get(major) ?? { repoCount: 0, weight: 0 }
      cur.repoCount += 1
      stats.set(major, cur)
    }
  }

  const totalWeight = [...stats.values()].reduce((s, v) => s + v.weight, 0)
  return [...stats.entries()]
    .map(([language, v]) => ({
      language,
      repoCount: v.repoCount,
      weight: v.weight,
      percent: totalWeight > 0 ? (v.weight / totalWeight) * 100 : 0,
    }))
    .sort((a, b) => b.weight - a.weight || b.repoCount - a.repoCount)
}

export interface RepoActivity {
  repo: string
  events: number
  commits: number
}

export interface EventsSummary {
  totalEvents: number
  totalCommits: number
  activeDays: number
  /** YYYY-MM-DD → 提交数（热力图数据源） */
  commitsByDate: Record<string, number>
  /** 0-23 点的事件数（本地时区） */
  eventsByHour: number[]
  /** 0-11 月的提交数 */
  commitsByMonth: number[]
  byRepo: RepoActivity[]
  firstDate: string | null
  lastDate: string | null
}

export function summarizeEvents(events: AccountEvent[]): EventsSummary {
  const s: EventsSummary = {
    totalEvents: events.length,
    totalCommits: 0,
    activeDays: 0,
    commitsByDate: {},
    eventsByHour: new Array(24).fill(0),
    commitsByMonth: new Array(12).fill(0),
    byRepo: [],
    firstDate: null,
    lastDate: null,
  }
  const repoMap = new Map<string, RepoActivity>()

  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue
    if (!s.firstDate || e.date < s.firstDate) s.firstDate = e.date
    if (!s.lastDate || e.date > s.lastDate) s.lastDate = e.date

    s.commitsByDate[e.date] = (s.commitsByDate[e.date] ?? 0) + e.commitCount
    s.totalCommits += e.commitCount

    const month = Number(e.date.slice(5, 7)) - 1
    if (month >= 0 && month < 12) s.commitsByMonth[month] += e.commitCount

    if (e.createdAt) {
      const hour = new Date(e.createdAt).getHours()
      if (Number.isFinite(hour) && hour >= 0 && hour < 24) s.eventsByHour[hour] += 1
    }

    if (e.repoPath) {
      const cur =
        repoMap.get(e.repoPath) ?? { repo: e.repoPath, events: 0, commits: 0 }
      cur.events += 1
      cur.commits += e.commitCount
      repoMap.set(e.repoPath, cur)
    }
  }

  s.activeDays = Object.keys(s.commitsByDate).length
  s.byRepo = [...repoMap.values()].sort(
    (a, b) => b.commits - a.commits || b.events - a.events,
  )
  return s
}

/** 仓库的主语言（与 aggregateLanguages 同口径） */
export function repoMajorLanguage(
  repo: GitCodeRepo,
  langs: Record<string, number> | undefined,
): string | null {
  if (repo.language) return repo.language
  if (!langs) return null
  const entries = Object.entries(langs).filter(([, v]) => v > 0)
  if (entries.length === 0) return null
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
}

/** 最长连续活跃天数（commitsByDate 中提交数 > 0 的日期连成最长一段） */
export function longestStreak(commitsByDate: Record<string, number>): number {
  const days = Object.keys(commitsByDate)
    .filter((d) => commitsByDate[d] > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  let best = 0
  let run = 0
  let prev: number | null = null
  const DAY_MS = 86_400_000
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`)
    if (Number.isNaN(t)) continue
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1
    if (run > best) best = run
    prev = t
  }
  return best
}

/** 峰值下标（并列取最先；全 0 返回 0） */
export function peakIndex(arr: readonly number[]): number {
  let idx = 0
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[idx]) idx = i
  }
  return idx
}

/** 单日最高提交数 */
export function maxDailyCommits(commitsByDate: Record<string, number>): number {
  let max = 0
  for (const v of Object.values(commitsByDate)) {
    if (v > max) max = v
  }
  return max
}
