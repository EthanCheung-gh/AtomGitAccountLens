/**
 * GitCode OpenAPI 客户端（/api/v5，Gitee v5 风格）。
 *
 * - 认证：Authorization: Bearer（CORS 允许头含 Authorization；不用 PRIVATE-TOKEN，
 *   预检会失败；不用 ?access_token= query，避免令牌进日志）
 * - 限流：所有请求过 RateLimiter 闸（默认 300 次/分）；429/5xx 指数退避重试
 * - 中断：全链路透传 AbortSignal
 */
import { RateLimiter, sleepAbort } from '../lib/rateLimiter'
import type { DeepCommitLite, GitCodeRepo, GitCodeUser, RawGitCodeEvent } from './types'

export const GITCODE_API_BASE = 'https://api.gitcode.com/api/v5'
export const TOKEN_CREATE_URL = 'https://gitcode.com/setting/token-classic'

export type ApiErrorCode =
  | 'unauthorized' // 401：令牌无效/过期
  | 'forbidden' // 403：令牌缺 scope（如 read_user）
  | 'rateLimited' // 429 且重试耗尽
  | 'notFound' // 404
  | 'network' // 断网/DNS/CORS
  | 'server' // 5xx 且重试耗尽
  | 'aborted' // 用户中断
  | 'unknown'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = opts.status
    this.retryAfterMs = opts.retryAfterMs
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause
  }
}

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'unauthorized':
        return '令牌无效或已过期，请重新生成后输入。'
      case 'forbidden':
        return '令牌权限不足（403）：请确认创建令牌时勾选了 read_user 等读取权限。'
      case 'rateLimited':
        return '请求过于频繁（429），已自动退避重试仍被限流，请稍后再试。'
      case 'notFound':
        return '资源不存在（404）。'
      case 'network':
        return '网络错误：无法连接 api.gitcode.com（请检查网络或代理设置）。'
      case 'server':
        return 'GitCode 服务端错误（5xx），已自动重试仍失败，请稍后再试。'
      case 'aborted':
        return '已中断。'
      default:
        return err.message || '未知错误。'
    }
  }
  if (err instanceof DOMException && err.name === 'AbortError') return '已中断。'
  return err instanceof Error ? err.message : String(err)
}

export function isApiError(err: unknown, code: ApiErrorCode): boolean {
  return err instanceof ApiError && err.code === code
}

interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULT_RETRY: Required<RetryPolicy> = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
}

function buildUrl(
  base: string,
  query?: Record<string, string | number | undefined>,
): string {
  if (!query) return base
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>
      const msg = rec.error_message ?? rec.message ?? rec.error
      if (typeof msg === 'string' && msg) return msg
    }
  } catch {
    /* 忽略解析失败 */
  }
  return res.statusText || `HTTP ${res.status}`
}

export class GitCodeClient {
  readonly limiter = new RateLimiter()
  private readonly retry: Required<RetryPolicy>

  constructor(
    readonly token: string,
    retry: RetryPolicy = DEFAULT_RETRY,
  ) {
    this.retry = { ...DEFAULT_RETRY, ...retry }
  }

  private async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = buildUrl(GITCODE_API_BASE + path, query)
    let attempt = 0
    for (;;) {
      let res: Response
      try {
        res = await this.limiter.run(
          () =>
            fetch(url, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: 'application/json',
              },
              signal,
            }),
          signal,
        )
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new ApiError('aborted', '已中断', { cause: err })
        }
        if (err instanceof ApiError) throw err
        throw new ApiError('network', '无法连接 GitCode API', { cause: err })
      }

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (err) {
          throw new ApiError('unknown', '响应不是合法 JSON', {
            status: res.status,
            cause: err,
          })
        }
      }

      const retryAfterHeader = res.headers.get('Retry-After')
      const retryAfterMs = retryAfterHeader
        ? Math.max(0, Number(retryAfterHeader) * 1000 || 0)
        : undefined

      // 429/5xx：退避重试
      if (res.status === 429 || res.status >= 500) {
        if (attempt + 1 >= this.retry.maxAttempts) {
          const msg = await readErrorMessage(res)
          throw new ApiError(
            res.status === 429 ? 'rateLimited' : 'server',
            `${msg}（重试 ${attempt + 1} 次后放弃）`,
            { status: res.status, retryAfterMs },
          )
        }
        const backoff = Math.min(
          this.retry.maxDelayMs,
          Math.max(
            this.retry.baseDelayMs * 2 ** attempt,
            retryAfterMs ?? 0,
          ),
        )
        await sleepAbort(backoff, signal)
        attempt += 1
        continue
      }

      const msg = await readErrorMessage(res)
      if (res.status === 401) {
        throw new ApiError('unauthorized', msg, { status: 401 })
      }
      if (res.status === 403) {
        throw new ApiError('forbidden', msg, { status: 403 })
      }
      if (res.status === 404) {
        throw new ApiError('notFound', msg, { status: 404 })
      }
      throw new ApiError('unknown', msg, { status: res.status })
    }
  }

  /** 当前认证用户资料（含 top_languages、followers 计数） */
  async getUser(signal?: AbortSignal): Promise<GitCodeUser> {
    return this.get<GitCodeUser>('/user', undefined, signal)
  }

  /** 授权用户仓库列表（分页，per_page 上限 100） */
  async listUserRepos(
    opts: { page?: number; perPage?: number; visibility?: string } = {},
    signal?: AbortSignal,
  ): Promise<GitCodeRepo[]> {
    const { page = 1, perPage = 100, visibility = 'all' } = opts
    return this.get<GitCodeRepo[]>(
      '/user/repos',
      { page, per_page: perPage, visibility },
      signal,
    )
  }

  /** 仓库语言分布（值为百分比 0-100，非字节） */
  async getRepoLanguages(
    owner: string,
    repo: string,
    signal?: AbortSignal,
  ): Promise<Record<string, number>> {
    return this.get<Record<string, number>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`,
      undefined,
      signal,
    )
  }

  /**
   * 用户年度事件流。响应形状（日期键对象 + 可选 next 游标）用 normalizeEventsPage 归一化。
   * 需要带 read_user scope 的令牌。
   */
  async listUserEvents(
    login: string,
    year: number,
    next?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.get<unknown>(
      `/users/${encodeURIComponent(login)}/events`,
      { year, next },
      signal,
    )
  }

  /** 仓库提交列表（单页；per_page 上限 100）。深度抓取用 */
  async listRepoCommits(
    owner: string,
    repo: string,
    opts: { page?: number; perPage?: number } = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { page = 1, perPage = 100 } = opts
    return this.get<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
      { page, per_page: perPage },
      signal,
    )
  }
}

// ---------- events 归一化（纯函数，供单测） ----------

export interface NormalizedEventsPage {
  /** 日期（YYYY-MM-DD）→ 事件数组 */
  byDate: Record<string, RawGitCodeEvent[]>
  /** 下一页游标（不存在表示结束） */
  next: string | undefined
}

/** 判定一个对象像不像事件（有可解析的 created_at 才能分组） */
function looksLikeEvent(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const e = item as Record<string, unknown>
  return typeof e.created_at === 'string' && e.created_at.length >= 10
}

/**
 * 深度兜底：不假设响应形状，递归收集所有「看起来像事件」的对象。
 * GitCode 的 events 分页结构在文档里并不稳定（可能是日期键、月键、items 包裹、
 * data 包裹等），与其逐个猜，不如扫一遍再按 created_at 分组。
 */
function deepCollectEvents(raw: unknown, maxDepth = 5): RawGitCodeEvent[] {
  const out: RawGitCodeEvent[] = []
  const seen = new Set<object>()

  const visit = (node: unknown, depth: number) => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return
    if (seen.has(node as object)) return
    seen.add(node as object)
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 300)) {
        if (looksLikeEvent(item)) out.push(item as RawGitCodeEvent)
        else visit(item, depth + 1)
      }
      return
    }
    if (looksLikeEvent(node)) {
      out.push(node as RawGitCodeEvent)
      return
    }
    for (const value of Object.values(node as Record<string, unknown>)) visit(value, depth + 1)
  }

  visit(raw, 0)
  return out
}

/** 把平铺事件数组按 created_at 分组到日期 */
function groupByDate(list: unknown[]): Record<string, RawGitCodeEvent[]> {
  const byDate: Record<string, RawGitCodeEvent[]> = {}
  for (const item of list) {
    const e = item as RawGitCodeEvent
    const date = typeof e.created_at === 'string' ? e.created_at.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    ;(byDate[date] ??= []).push(e)
  }
  return byDate
}

export function normalizeEventsPage(raw: unknown): NormalizedEventsPage {
  if (Array.isArray(raw)) {
    const direct = groupByDate(raw)
    if (Object.keys(direct).length > 0) return { byDate: direct, next: undefined }
    return { byDate: groupByDate(deepCollectEvents(raw)), next: undefined }
  }
  if (raw && typeof raw === 'object') {
    const byDate: Record<string, RawGitCodeEvent[]> = {}
    let next: string | undefined
    /** 兜底：事件数组被包在某个字段里（items / data / 月键等），先全收再按 created_at 分组 */
    const looseLists: unknown[] = []

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key === 'next' || key === 'prev' || key === 'last_id') {
        if (typeof value === 'string' && value) next = value
        continue
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Array.isArray(value)) {
        byDate[key] = value as RawGitCodeEvent[]
        continue
      }
      if (Array.isArray(value) && value.some(looksLikeEvent)) {
        looseLists.push(...value)
        continue
      }
      // 再深一层：字段本身是「日期键对象」
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(k2) && Array.isArray(v2)) {
            byDate[k2] = v2 as RawGitCodeEvent[]
          }
        }
      }
    }

    if (Object.keys(byDate).length === 0 && looseLists.length > 0) {
      return { byDate: groupByDate(looseLists), next }
    }
    if (Object.keys(byDate).length === 0) {
      // 最后兜底：形状未知时深度扫描（含按「YYYY-MM」月键分组、多层包裹等情况）
      const deep = deepCollectEvents(raw)
      if (deep.length > 0) return { byDate: groupByDate(deep), next }
    }
    return { byDate, next }
  }
  return { byDate: {}, next: undefined }
}

/** 描述未知响应形状（用于接口诊断，不含任何凭证） */
export function describeEventsResponse(raw: unknown): string {
  if (raw === null) return 'null'
  if (Array.isArray(raw)) {
    const first = raw[0]
    const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 8).join(',') : '-'
    return `数组 ${raw.length} 项 · 元素字段 ${keys}`
  }
  if (typeof raw === 'object') {
    const keys = Object.keys(raw as Record<string, unknown>)
    const preview = keys.slice(0, 8).join(',')
    return `对象 ${keys.length} 个键 · ${preview}${keys.length > 8 ? '…' : ''}`
  }
  return typeof raw
}

/** 归一化最近提交为精简记录（sha 截 7 位、message 截 80 字符，取作者时间优先，附作者登录名） */
export function normalizeDeepCommits(raw: unknown): DeepCommitLite[] {
  if (!Array.isArray(raw)) return []
  const out: DeepCommitLite[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as {
      sha?: unknown
      author?: { login?: unknown } | null
      commit?: {
        author?: { date?: unknown; login?: unknown }
        committer?: { date?: unknown; login?: unknown }
        message?: unknown
      } | null
    }
    const sha = typeof c.sha === 'string' ? c.sha.slice(0, 7) : ''
    const date =
      (typeof c.commit?.author?.date === 'string' && c.commit.author.date) ||
      (typeof c.commit?.committer?.date === 'string' && c.commit.committer.date) ||
      ''
    const message = typeof c.commit?.message === 'string' ? c.commit.message : ''
    const author =
      (typeof c.commit?.author?.login === 'string' && c.commit.author.login) ||
      (typeof c.author?.login === 'string' && c.author.login) ||
      undefined
    if (!sha && !date) continue
    out.push({
      sha,
      date,
      message: message.replace(/\s+/g, ' ').trim().slice(0, 80),
      ...(author ? { author } : {}),
    })
  }
  return out
}
