/**
 * 抓取管线：用户 → 仓库（分页）→ 逐仓库语言 → 年度事件。
 * 进度回调 + AbortSignal 全链路可中断；单仓库失败不炸整体。
 */
import { isApiError, normalizeEventsPage } from '../api/client'
import type { GitCodeClient } from '../api/client'
import type { AccountEvent, GitCodeRepo, GitCodeUser, RawGitCodeEvent } from '../api/types'
import { repoOwnerName, repoPath } from './aggregate'

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
