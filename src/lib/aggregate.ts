/**
 * 聚合纯函数：仓库指标、语言占比（口径见 aggregateLanguages）、事件汇总。
 * 全部无副作用，供各 Tab 与单测使用。
 */
import type { AccountEvent, DeepCommitLite, GitCodeRepo } from '../api/types'

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

// ============================================================
// 深度挖掘：以下全部基于已有快照数据（零新增请求）
// ============================================================

/** 事件类型中文标签（未收录的 key 原样展示） */
export const ACTION_LABELS: Record<string, string> = {
  pushed: '推送',
  created: '创建',
  updated: '更新',
  deleted: '删除',
  forked: 'Fork',
  starred: '加星',
  commented: '评论',
  issue_commented: 'Issue 评论',
  issues: 'Issue',
  issue_opened: '新建 Issue',
  issue_closed: '关闭 Issue',
  pull_request: 'Pull Request',
  pull_request_commented: 'PR 评论',
  pull_request_opened: '发起 PR',
  pull_request_closed: '关闭/合并 PR',
  member: '成员变动',
  unknown: '未知',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export interface ActionStat {
  action: string
  label: string
  count: number
}

/** 事件类型分布（按次数降序） */
export function actionBreakdown(events: AccountEvent[]): ActionStat[] {
  const counts = new Map<string, number>()
  for (const e of events) {
    counts.set(e.action, (counts.get(e.action) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([action, count]) => ({ action, label: actionLabel(action), count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 7×24 工作习惯矩阵：行=周一..周日（0-6），列=0-23 时（本地时间）。
 * 星期取事件日期，小时取 createdAt（缺失则跳过该格）。
 */
export function weekdayHourMatrix(events: AccountEvent[]): number[][] {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !e.createdAt) continue
    const day = new Date(`${e.date}T00:00:00`).getDay()
    const hour = new Date(e.createdAt).getHours()
    if (!Number.isFinite(day) || !Number.isFinite(hour)) continue
    const row = (day + 6) % 7 // 周一=0
    if (hour >= 0 && hour < 24) matrix[row][hour] += 1
  }
  return matrix
}

export interface CumulativePoint {
  date: string
  cumulative: number
}

/** 按日累积提交曲线（仅活跃日采样） */
export function cumulativeCommits(events: AccountEvent[]): CumulativePoint[] {
  const byDate: Record<string, number> = {}
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue
    byDate[e.date] = (byDate[e.date] ?? 0) + e.commitCount
  }
  const days = Object.keys(byDate).sort()
  const out: CumulativePoint[] = []
  let acc = 0
  for (const d of days) {
    acc += byDate[d]
    out.push({ date: d, cumulative: acc })
  }
  return out
}

export interface PushSizeStats {
  /** 有效推送次数（commitCount>0 的事件） */
  pushes: number
  /** 平均每次推送提交数（1 位小数） */
  avg: number
  /** 单次推送最大提交数 */
  max: number
  buckets: { label: string; count: number }[]
}

/** 推送粒度画像：一次 push 带几个提交 */
export function pushSizeStats(events: AccountEvent[]): PushSizeStats {
  let pushes = 0
  let total = 0
  let max = 0
  const buckets = [
    { label: '1', min: 1, max: 1, count: 0 },
    { label: '2-3', min: 2, max: 3, count: 0 },
    { label: '4-5', min: 4, max: 5, count: 0 },
    { label: '6-10', min: 6, max: 10, count: 0 },
    { label: '11+', min: 11, max: Infinity, count: 0 },
  ]
  for (const e of events) {
    const n = e.commitCount
    if (n <= 0) continue
    pushes += 1
    total += n
    if (n > max) max = n
    for (const b of buckets) {
      if (n >= b.min && n <= b.max) {
        b.count += 1
        break
      }
    }
  }
  return {
    pushes,
    avg: pushes > 0 ? Math.round((total / pushes) * 10) / 10 : 0,
    max,
    buckets: buckets.map(({ label, count }) => ({ label, count })),
  }
}

/** 最长空窗期（连续无提交天数，取相邻活跃日间隔-1 的最大值） */
export function longestGapDays(commitsByDate: Record<string, number>): number {
  const days = Object.keys(commitsByDate)
    .filter((d) => commitsByDate[d] > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  let maxGap = 0
  for (let i = 1; i < days.length; i++) {
    const gap =
      (Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`)) /
        86_400_000 -
      1
    if (gap > maxGap) maxGap = gap
  }
  return Math.round(maxGap)
}

export interface MonthCount {
  /** YYYY-MM */
  month: string
  count: number
}

function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 仓库创作时间线（按创建月计数，缺失月份补 0，升序） */
export function repoCreationTimeline(
  repos: GitCodeRepo[],
  excluded: string[],
): MonthCount[] {
  const excludedSet = new Set(excluded)
  const counts = new Map<string, number>()
  for (const repo of repos) {
    const path = repoPath(repo)
    if (path === '' || excludedSet.has(path)) continue
    const m = monthKey(repo.created_at)
    if (!m) continue
    counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  const months = [...counts.keys()].sort()
  if (months.length === 0) return []
  const out: MonthCount[] = []
  // 补齐首尾之间的空月
  let cursor = new Date(`${months[0]}-01T00:00:00`)
  const end = new Date(`${months[months.length - 1]}-01T00:00:00`)
  for (; cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    out.push({ month: key, count: counts.get(key) ?? 0 })
  }
  return out
}

export interface RepoFreshness {
  within30: number
  within180: number
  within365: number
  /** 超过一年没有 push/update 的休眠仓库 */
  dormant: number
}

/** 仓库新鲜度分布（按 pushed_at，缺失回退 updated_at/created_at） */
export function repoFreshness(
  repos: GitCodeRepo[],
  excluded: string[],
  nowMs: number = Date.now(),
): RepoFreshness {
  const excludedSet = new Set(excluded)
  const f: RepoFreshness = { within30: 0, within180: 0, within365: 0, dormant: 0 }
  const DAY = 86_400_000
  for (const repo of repos) {
    const path = repoPath(repo)
    if (path === '' || excludedSet.has(path)) continue
    const ts = new Date(repo.pushed_at ?? repo.updated_at ?? repo.created_at ?? '').getTime()
    if (Number.isNaN(ts)) {
      f.dormant += 1
      continue
    }
    const age = (nowMs - ts) / DAY
    if (age <= 30) f.within30 += 1
    else if (age <= 180) f.within180 += 1
    else if (age <= 365) f.within365 += 1
    else f.dormant += 1
  }
  return f
}

export interface StarTopItem {
  path: string
  stars: number
  forks: number
}

/** Top 被星仓库（降序，0 star 不入榜） */
export function topStargazed(
  repos: GitCodeRepo[],
  excluded: string[],
  topN = 10,
): StarTopItem[] {
  const excludedSet = new Set(excluded)
  return repos
    .filter((repo) => {
      const path = repoPath(repo)
      return path !== '' && !excludedSet.has(path) && (repo.stargazers_count ?? 0) > 0
    })
    .map((repo) => ({
      path: repoPath(repo),
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
    }))
    .sort((a, b) => b.stars - a.stars || b.forks - a.forks)
    .slice(0, topN)
}

/**
 * 语言占比第二口径：Star 加权。
 * 权重 = 仓库内语言百分比 × max(1, 仓库 Star 数)，避免零星仓库被完全淹没；
 * repoCount 含义与仓库数加权口径一致。
 */
export function languageStarWeighted(
  repos: GitCodeRepo[],
  languagesByRepo: Record<string, Record<string, number>>,
  excluded: string[],
): LanguageStat[] {
  const excludedSet = new Set(excluded)
  const stats = new Map<string, { repoCount: number; weight: number }>()
  for (const repo of repos) {
    const path = repoPath(repo)
    if (path === '' || excludedSet.has(path)) continue
    const starFactor = Math.max(1, repo.stargazers_count ?? 0)
    const langs = languagesByRepo[path] ?? {}
    for (const [lang, pct] of Object.entries(langs)) {
      if (typeof pct !== 'number' || pct <= 0 || !lang) continue
      const cur = stats.get(lang) ?? { repoCount: 0, weight: 0 }
      cur.weight += pct * starFactor
      stats.set(lang, cur)
    }
    let major: string | null = repo.language ?? null
    const entries = Object.entries(langs).filter(([, v]) => v > 0)
    if (!major && entries.length > 0) major = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    if (major) {
      const cur = stats.get(major) ?? { repoCount: 0, weight: 0 }
      cur.repoCount += 1
      stats.set(major, cur)
    }
  }
  const total = [...stats.values()].reduce((s, v) => s + v.weight, 0)
  return [...stats.entries()]
    .map(([language, v]) => ({
      language,
      repoCount: v.repoCount,
      weight: v.weight,
      percent: total > 0 ? (v.weight / total) * 100 : 0,
    }))
    .sort((a, b) => b.weight - a.weight || b.repoCount - a.repoCount)
}

export interface NamespaceStat {
  /** 仓库路径的 owner 段 */
  ns: string
  repos: number
  stars: number
  commits: number
}

function nsOf(path: string): string {
  const idx = path.indexOf('/')
  return idx > 0 ? path.slice(0, idx) : path || '(未知)'
}

/** 仓库归属命名空间（owner 段，小写比较用） */
export function repoNamespace(path: string): string {
  return nsOf(path)
}

/** 个人/组织（命名空间）分组：仓库数、Star、年度提交（来自事件流前缀匹配） */
export function namespaceStats(
  repos: GitCodeRepo[],
  events: AccountEvent[],
  excluded: string[],
): NamespaceStat[] {
  const excludedSet = new Set(excluded)
  const map = new Map<string, NamespaceStat>()
  const get = (ns: string): NamespaceStat => {
    let cur = map.get(ns)
    if (!cur) {
      cur = { ns, repos: 0, stars: 0, commits: 0 }
      map.set(ns, cur)
    }
    return cur
  }
  for (const repo of repos) {
    const path = repoPath(repo)
    if (path === '' || excludedSet.has(path)) continue
    const stat = get(nsOf(path))
    stat.repos += 1
    stat.stars += repo.stargazers_count ?? 0
  }
  for (const e of events) {
    if (!e.repoPath || e.commitCount <= 0) continue
    get(nsOf(e.repoPath)).commits += e.commitCount
  }
  return [...map.values()].sort((a, b) => b.repos - a.repos || b.commits - a.commits)
}

export interface RepoMonthlyStack {
  /** YYYY-MM × 12（当年 1-12 月） */
  months: string[]
  series: { repo: string; data: number[] }[]
}

/** Top 活跃仓库的月度提交堆叠（当年） */
export function repoMonthlyStack(
  events: AccountEvent[],
  year: number,
  topN = 5,
): RepoMonthlyStack {
  const months = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
  )
  const perRepo = new Map<string, number[]>()
  for (const e of events) {
    if (e.commitCount <= 0 || !e.repoPath) continue
    const m = e.date.slice(0, 7)
    const idx = months.indexOf(m)
    if (idx < 0) continue
    let arr = perRepo.get(e.repoPath)
    if (!arr) {
      arr = new Array(12).fill(0)
      perRepo.set(e.repoPath, arr)
    }
    arr[idx] += e.commitCount
  }
  const top = [...perRepo.entries()]
    .map(([repo, data]) => ({ repo, total: data.reduce((s, v) => s + v, 0), data }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
  return { months, series: top.map(({ repo, data }) => ({ repo, data })) }
}

/** 深度抓取提交的小时直方图（0-23，作者时间，本地时区） */
export function commitHourHistogram(
  commitsByRepo: Record<string, DeepCommitLite[]> | undefined,
): number[] {
  const hist = new Array(24).fill(0)
  if (!commitsByRepo) return hist
  for (const list of Object.values(commitsByRepo)) {
    for (const c of list) {
      const h = new Date(c.date).getHours()
      if (Number.isFinite(h) && h >= 0 && h < 24) hist[h] += 1
    }
  }
  return hist
}

/** 深度抓取提交总数 */
export function deepCommitCount(
  commitsByRepo: Record<string, DeepCommitLite[]> | undefined,
): number {
  if (!commitsByRepo) return 0
  return Object.values(commitsByRepo).reduce((s, list) => s + list.length, 0)
}

export interface DeepCommitMeta {
  /** 提交样本总数 */
  total: number
  /** 有提交样本的仓库数 */
  repos: number
  /** 最早/最晚作者时间（ISO） */
  first: string | null
  last: string | null
}

/** 深度抓取提交的元信息（展示用） */
export function deepCommitMeta(
  commitsByRepo: Record<string, DeepCommitLite[]> | undefined,
): DeepCommitMeta {
  const meta: DeepCommitMeta = { total: 0, repos: 0, first: null, last: null }
  if (!commitsByRepo) return meta
  for (const list of Object.values(commitsByRepo)) {
    if (list.length === 0) continue
    meta.repos += 1
    meta.total += list.length
    for (const c of list) {
      if (!c.date) continue
      if (!meta.first || c.date < meta.first) meta.first = c.date
      if (!meta.last || c.date > meta.last) meta.last = c.date
    }
  }
  return meta
}
