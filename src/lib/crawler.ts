/**
 * 抓取管线：用户 → 仓库（分页）→ 逐仓库语言 → 年度事件。
 * 进度回调 + AbortSignal 全链路可中断；单仓库失败不炸整体。
 */
import { isApiError, normalizeDeepCommits, normalizeEventsPage } from '../api/client'
import type { GitCodeClient } from '../api/client'
import type {
  AccountEvent,
  DeepCommitLite,
  GitCodeRepo,
  GitCodeUser,
  RawGitCodeEvent,
} from '../api/types'
import { repoNamespace, repoOwnerName, repoPath } from './aggregate'

export type CrawlPhase = 'repos' | 'languages' | 'events'

export interface CrawlProgress {
  phase: CrawlPhase
  current: number
  /** 0 表示不确定（如分页总数未知） */
  total: number
  message: string
}

export interface CrawlResult {
  user: GitCodeUser
  repos: GitCodeRepo[]
  languagesByRepo: Record<string, Record<string, number>>
  eventsByYear: Record<string, AccountEvent[]>
  eventsUnavailable: Record<string, 'scope' | 'error'>
}

const MAX_REPO_PAGES = 50 // 每页 100 → 上限 5000 仓库
const MAX_EVENT_PAGES = 100

function normalizeEvent(date: string, raw: RawGitCodeEvent): AccountEvent {
  const project = raw.project ?? null
  let path = project?.path_with_namespace ?? ''
  if (!path && project) {
    const ns =
      typeof project.namespace === 'string'
        ? project.namespace
        : project.namespace?.path
    if (ns && project.path) path = `${ns}/${project.path}`
    else if (project.path) path = project.path
  }
  return {
    date,
    action: raw.action_name ?? 'unknown',
    repoPath: path,
    commitCount:
      typeof raw.push_data?.commit_count === 'number' ? raw.push_data.commit_count : 0,
    createdAt: raw.created_at ?? null,
  }
}

function sortEvents(events: AccountEvent[]): AccountEvent[] {
  return [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** 拉取某一年的事件流（带 next 游标翻页）；403 → scope，其他错误 → error */
export async function fetchEventsYear(
  client: GitCodeClient,
  login: string,
  year: number,
  opts: { signal?: AbortSignal; onProgress?: (p: CrawlProgress) => void } = {},
): Promise<{ status: 'ok'; events: AccountEvent[] } | { status: 'scope' | 'error'; message: string }> {
  const collected: AccountEvent[] = []
  let next: string | undefined
  try {
    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      opts.onProgress?.({
        phase: 'events',
        current: page,
        total: 0,
        message: `拉取 ${year} 年动态（第 ${page} 页）…`,
      })
      const raw = await client.listUserEvents(login, year, next, opts.signal)
      const normalized = normalizeEventsPage(raw)
      for (const [date, list] of Object.entries(normalized.byDate)) {
        for (const item of list) collected.push(normalizeEvent(date, item))
      }
      next = normalized.next
      if (!next) break
    }
    return { status: 'ok', events: sortEvents(collected) }
  } catch (err) {
    if (isApiError(err, 'forbidden')) {
      return { status: 'scope', message: '令牌缺少 read_user 权限，无法读取动态' }
    }
    if (isApiError(err, 'aborted')) throw err
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function crawlAccount(
  client: GitCodeClient,
  opts: {
    user?: GitCodeUser
    years?: number[]
    onProgress?: (p: CrawlProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<CrawlResult> {
  const { onProgress, signal } = opts
  const years = opts.years ?? [new Date().getFullYear()]

  // 1. 当前用户
  const user = opts.user ?? (await client.getUser(signal))

  // 2. 仓库（分页，per_page=100）
  const repos: GitCodeRepo[] = []
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    onProgress?.({
      phase: 'repos',
      current: page,
      total: 0,
      message: `拉取仓库清单（第 ${page} 页）…`,
    })
    const batch = await client.listUserRepos({ page, perPage: 100, visibility: 'all' }, signal)
    repos.push(...batch)
    if (batch.length < 100) break
  }

  // 3. 逐仓库语言分布（失败单仓库降级为空表）
  const languagesByRepo: Record<string, Record<string, number>> = {}
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]
    onProgress?.({
      phase: 'languages',
      current: i + 1,
      total: repos.length,
      message: `拉取语言分布（${i + 1}/${repos.length}）`,
    })
    const path = repoPath(repo)
    const ownerName = repoOwnerName(repo)
    if (!path || !ownerName) {
      languagesByRepo[path] = {}
      continue
    }
    try {
      languagesByRepo[path] = await client.getRepoLanguages(
        ownerName.owner,
        ownerName.repo,
        signal,
      )
    } catch (err) {
      if (isApiError(err, 'aborted')) throw err
      languagesByRepo[path] = {} // 404/403 等单仓库失败：记空表继续
    }
  }

  // 4. 年度事件（scope 缺失不阻断整体）
  const eventsByYear: Record<string, AccountEvent[]> = {}
  const eventsUnavailable: Record<string, 'scope' | 'error'> = {}
  for (const year of years) {
    const outcome = await fetchEventsYear(client, user.login, year, {
      signal,
      onProgress,
    })
    if (outcome.status === 'ok') {
      eventsByYear[String(year)] = outcome.events
    } else {
      eventsUnavailable[String(year)] = outcome.status
    }
  }

  return { user, repos, languagesByRepo, eventsByYear, eventsUnavailable }
}

export interface DeepCrawlResult {
  commitsByRepo: Record<string, DeepCommitLite[]>
  /** 拉取失败（非 404、非中断）的仓库数 */
  failedCount: number
  /** 达到单仓库页数上限被截断的仓库路径（每仓库上限 50 页 × 100 条） */
  truncated: string[]
}

/** 深度抓取范围：personal = 仅本人命名空间仓库；all = 含加入的社区/组织仓库 */
export type DeepCrawlScope = 'personal' | 'all'

/** 单仓库提交翻页上限（50 页 × 100 条 = 5000 条），防止超大仓库拖垮配额与存储 */
export const MAX_COMMIT_PAGES_PER_REPO = 50

/**
 * 深度抓取：逐仓库**全时段**翻页拉取提交（per_page=100，直至短页）。
 * - skip 中的仓库不再重复拉（增量）；404/私有受限仓库记空表继续
 * - scope='personal' 时只抓 namespace === login 的本人仓库，
 *   排除加入的社区/组织仓库（配合作者过滤也可放心包含）
 * - 单仓库超过上限时截断并记入 truncated
 */
export async function deepCrawlCommits(
  client: GitCodeClient,
  repos: GitCodeRepo[],
  opts: {
    skip?: Set<string>
    scope?: DeepCrawlScope
    login?: string
    onProgress?: (p: CrawlProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<DeepCrawlResult> {
  const { onProgress, signal } = opts
  const skip = opts.skip ?? new Set<string>()
  const scope = opts.scope ?? 'all'
  const loginLower = opts.login?.toLowerCase() ?? null
  const targets = repos.filter((r) => {
    const path = repoPath(r)
    if (path === '' || skip.has(path) || repoOwnerName(r) === null) return false
    if (scope === 'personal' && loginLower) {
      return repoNamespace(path).toLowerCase() === loginLower
    }
    return true
  })
  const commitsByRepo: Record<string, DeepCommitLite[]> = {}
  let failedCount = 0
  const truncated: string[] = []
  for (let i = 0; i < targets.length; i++) {
    const repo = targets[i]
    const path = repoPath(repo)
    const ownerName = repoOwnerName(repo)!
    const collected: DeepCommitLite[] = []
    let page = 1
    for (; page <= MAX_COMMIT_PAGES_PER_REPO; page++) {
      onProgress?.({
        phase: 'events',
        current: i + 1,
        total: targets.length,
        message: `深度抓取提交（${i + 1}/${targets.length}）${path} · 第 ${page} 页 · 已 ${collected.length} 条`,
      })
      try {
        const raw = await client.listRepoCommits(
          ownerName.owner,
          ownerName.repo,
          { page, perPage: 100 },
          signal,
        )
        const batch = normalizeDeepCommits(raw)
        collected.push(...batch)
        if (batch.length < 100) break
      } catch (err) {
        if (isApiError(err, 'aborted')) throw err
        if (page === 1) {
          commitsByRepo[path] = [] // 首页即失败：空表（404/权限）
          if (!isApiError(err, 'notFound')) failedCount += 1
        }
        // 后续页失败：保留已抓到的部分
        break
      }
    }
    if (collected.length > 0) {
      commitsByRepo[path] = collected
      if (page > MAX_COMMIT_PAGES_PER_REPO) truncated.push(path)
    }
  }
  return { commitsByRepo, failedCount, truncated }
}
