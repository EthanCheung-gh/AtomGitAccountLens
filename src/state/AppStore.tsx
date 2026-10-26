import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  GitCodeClient,
  apiErrorMessage,
  describeEventsResponse,
  isApiError,
  normalizeEventsPage,
} from '../api/client'
import type { GitCodeUser } from '../api/types'
import { crawlAccount, deepCrawlCommits, fetchEventsYear } from '../lib/crawler'
import type { CrawlProgress, DeepCrawlScope } from '../lib/crawler'
import { missingYears, presetRange, rangeYears } from '../lib/range'
import type { DateRange } from '../lib/range'
import {
  AnalysisSnapshot,
  clearRememberedToken,
  clearSnapshot,
  EVENTS_CALIBRE,
  loadRange,
  loadRememberedToken,
  loadSnapshot,
  saveRange,
  saveRememberedToken,
  saveSnapshot,
} from '../lib/storage'

export type CrawlState =
  | { kind: 'idle' }
  | { kind: 'running'; progress: CrawlProgress }
  | { kind: 'done'; at: string }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' }

export interface EventFetchState {
  year: number
  error: string | null
}

/** 接口探测结果：某年 events 响应的真实形状（诊断用） */
export interface ProbeState {
  year: number
  summary: string
}

/** 区间补抓进度：缺哪几年、抓到第几年、哪些年份平台返回 0 条 */
export interface BackfillState {
  years: number[]
  done: number
  current: number | null
  error: string | null
  /** 抓取成功但 0 条的年份（平台确认该年无动态） */
  empty: number[]
}

export type DeepCrawlState =
  | { kind: 'idle' }
  | { kind: 'running'; current: number; total: number; message: string }
  | { kind: 'done'; at: string; fetched: number; failed: number; truncated: number }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' }

export interface AppStoreValue {
  token: string | null
  user: GitCodeUser | null
  remembered: boolean
  /** 启动时正在用记住的令牌静默验证 */
  booting: boolean
  snapshot: AnalysisSnapshot | null
  /** 快照写入 localStorage 失败（配额/隐私模式）时为 true */
  snapshotSaveFailed: boolean
  crawl: CrawlState
  /** 某年度事件正在拉取/失败（年选择器触发的增量抓取） */
  eventFetch: EventFetchState | null
  /** 提交级深度抓取（可选功能，逐仓库最近 100 条提交） */
  deepCrawl: DeepCrawlState
  /** 全站时间区间（活跃度与年报共用，非自然年可选） */
  range: DateRange
  setRange(range: DateRange): void
  /** 区间覆盖年份的自动补抓进度（无缺失为 null） */
  backfill: BackfillState | null
  /** 强制重抓区间内的动态（清掉「平台 0 条」与空表后重抓） */
  refreshRange(): void
  /** 最近一次接口探测结果（未探测为 null） */
  probe: ProbeState | null
  /** 探测某年 events 的原始响应形状，用于判断「0 条」是平台无数据还是解析不上 */
  probeEvents(year: number): Promise<void>
  signIn(token: string, remember: boolean): Promise<GitCodeUser>
  signOut(): void
  getClient(): GitCodeClient
  startCrawl(): void
  abortCrawl(): void
  toggleExclude(repoPath: string): void
  /** 拉取某一年事件并并入快照（已有或不可用则跳过） */
  fetchYear(year: number): Promise<void>
  /** 深度抓取最近提交（增量：已抓到的仓库跳过） */
  startDeepCrawl(): void
  /** 清空已深度抓取的提交并全量重抓（旧数据/换范围后用） */
  resetDeepCrawl(): void
  abortDeepCrawl(): void
  /** 深度抓取范围偏好：personal=仅本人命名空间（默认），all=含加入的社区/组织仓库 */
  deepScope: DeepCrawlScope
  setDeepScope(scope: DeepCrawlScope): void
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

/** 删除对象里的某个键（保持其余内容不变） */
function omitKey<T>(obj: Record<string, T> | undefined, key: string): Record<string, T> | undefined {
  if (!obj || !(key in obj)) return obj
  const next = { ...obj }
  delete next[key]
  return next
}

function isAbort(err: unknown): boolean {
  return (
    isApiError(err, 'aborted') || (err instanceof DOMException && err.name === 'AbortError')
  )
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<GitCodeUser | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [booting, setBooting] = useState(false)
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null)
  const [snapshotSaveFailed, setSnapshotSaveFailed] = useState(false)
  const [crawl, setCrawl] = useState<CrawlState>({ kind: 'idle' })
  const [eventFetch, setEventFetch] = useState<EventFetchState | null>(null)
  const [deepCrawl, setDeepCrawl] = useState<DeepCrawlState>({ kind: 'idle' })
  const [deepScope, setDeepScope] = useState<DeepCrawlScope>('personal')
  const [range, setRangeState] = useState<DateRange>(() => loadRange() ?? presetRange('12m'))
  const [backfill, setBackfill] = useState<BackfillState | null>(null)
  const [probe, setProbe] = useState<ProbeState | null>(null)

  const clientRef = useRef<{ token: string; client: GitCodeClient } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const deepAbortRef = useRef<AbortController | null>(null)
  const deepKindRef = useRef<DeepCrawlState['kind']>('idle')
  const deepScopeRef = useRef<DeepCrawlScope>('personal')
  const crawlKindRef = useRef<CrawlState['kind']>('idle')
  const snapshotRef = useRef<AnalysisSnapshot | null>(null)
  const rangeRef = useRef<DateRange>(range)
  const backfillingRef = useRef(false)
  /** 本区间内已尝试过补抓的年份（失败年份不再自动重试，避免死循环） */
  const attemptedYearsRef = useRef<Set<number>>(new Set())

  crawlKindRef.current = crawl.kind
  deepKindRef.current = deepCrawl.kind
  deepScopeRef.current = deepScope
  snapshotRef.current = snapshot
  rangeRef.current = range

  const getClient = useCallback((): GitCodeClient => {
    if (!token) throw new Error('尚未登录')
    if (clientRef.current?.token !== token) {
      clientRef.current = { token, client: new GitCodeClient(token) }
    }
    return clientRef.current.client
  }, [token])

  const startCrawl = useCallback(() => {
    if (!token || !user) return
    if (crawlKindRef.current === 'running') return
    const controller = new AbortController()
    abortRef.current = controller
    setCrawl({
      kind: 'running',
      progress: { phase: 'repos', current: 0, total: 0, message: '准备抓取…' },
    })

    const prev = snapshotRef.current
    crawlAccount(getClient(), {
      user,
      years: [new Date().getFullYear()],
      signal: controller.signal,
      onProgress: (progress) => setCrawl({ kind: 'running', progress }),
    })
      .then((result) => {
        const excluded =
          prev && prev.login === result.user.login ? prev.excludedRepos : []
        const snap: AnalysisSnapshot = {
          version: 1,
          eventsCalibre: EVENTS_CALIBRE,
          createdAt: new Date().toISOString(),
          login: result.user.login,
          user: result.user,
          repos: result.repos,
          languagesByRepo: result.languagesByRepo,
          eventsByYear: result.eventsByYear,
          excludedRepos: excluded,
          eventsUnavailable: result.eventsUnavailable,
          // 同账号重新抓取时保留已深度抓取的提交（新增仓库可再增量补抓）
          commitsRecentByRepo:
            prev && prev.login === result.user.login
              ? prev.commitsRecentByRepo
              : undefined,
        }
        const ok = saveSnapshot(snap)
        setSnapshotSaveFailed(!ok)
        snapshotRef.current = snap
        setSnapshot(snap)
        setCrawl({ kind: 'done', at: snap.createdAt })
      })
      .catch((err: unknown) => {
        if (isAbort(err)) {
          setCrawl({ kind: 'aborted' })
        } else {
          setCrawl({ kind: 'error', message: apiErrorMessage(err) })
        }
      })
  }, [token, user, getClient])

  const abortCrawl = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const toggleExclude = useCallback((path: string) => {
    const prev = snapshotRef.current
    if (!prev) return
    const set = new Set(prev.excludedRepos)
    if (set.has(path)) set.delete(path)
    else set.add(path)
    const next: AnalysisSnapshot = { ...prev, excludedRepos: [...set] }
    const ok = saveSnapshot(next)
    setSnapshotSaveFailed(!ok)
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  /** 将新的快照写入状态与 localStorage */
  const commitSnapshot = useCallback((next: AnalysisSnapshot) => {
    const ok = saveSnapshot(next)
    setSnapshotSaveFailed(!ok)
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  /**
   * 拉取单年事件并写入快照。
   * 判据是「有没有数据」而不是「有没有这个键」：历史版本曾把 0 条结果写成空数组，
   * 用真值判断会把空数组当成已抓，导致该年份永远不再重抓（区间一片空的根因）。
   */
  const fetchYearInto = useCallback(
    async (
      year: number,
    ): Promise<{ status: 'ok' | 'scope' | 'error'; message?: string; count: number }> => {
      const snap = snapshotRef.current
      if (!snap || !token) return { status: 'error', message: '尚未登录', count: 0 }
      const key = String(year)
      const existing = snap.eventsByYear[key]
      if ((existing?.length ?? 0) > 0) return { status: 'ok', count: existing!.length }
      if (snap.eventsUnavailable?.[key]) {
        return { status: 'ok', count: 0 }
      }
      const outcome = await fetchEventsYear(getClient(), snap.login, year, {})
      const base = snapshotRef.current
      if (!base) return { status: outcome.status === 'ok' ? 'ok' : outcome.status, count: 0 }
      if (outcome.status === 'ok') {
        if (outcome.events.length > 0) {
          commitSnapshot({
            ...base,
            eventsByYear: { ...base.eventsByYear, [key]: outcome.events },
            eventsUnavailable: omitKey(base.eventsUnavailable, key),
          })
          return { status: 'ok', count: outcome.events.length }
        }
        // 平台确认 0 条：单独标记，既不算缺数据也不再重复抓
        commitSnapshot({
          ...base,
          eventsUnavailable: { ...(base.eventsUnavailable ?? {}), [key]: 'empty' },
        })
        return { status: 'ok', count: 0 }
      }
      if (outcome.status === 'scope') {
        commitSnapshot({
          ...base,
          eventsUnavailable: { ...(base.eventsUnavailable ?? {}), [key]: 'scope' },
        })
        return { status: 'scope', message: outcome.message, count: 0 }
      }
      return { status: 'error', message: outcome.message, count: 0 }
    },
    [token, getClient, commitSnapshot],
  )

  const fetchYear = useCallback(
    async (year: number) => {
      const snap = snapshotRef.current
      if (!snap || !token) return
      const key = String(year)
      if ((snap.eventsByYear[key]?.length ?? 0) > 0 || snap.eventsUnavailable?.[key]) return
      setEventFetch({ year, error: null })
      const res = await fetchYearInto(year)
      if (res.status === 'error') setEventFetch({ year, error: res.message ?? '拉取失败' })
      else setEventFetch(null)
    },
    [token, fetchYearInto],
  )

  /** 串行补抓区间内缺失的年份，进度写入 backfill */
  const backfillYears = useCallback(
    async (years: number[]) => {
      if (backfillingRef.current || years.length === 0) return
      backfillingRef.current = true
      const empty: number[] = []
      setBackfill({ years, done: 0, current: years[0], error: null, empty })
      try {
        for (let i = 0; i < years.length; i++) {
          const year = years[i]
          attemptedYearsRef.current.add(year)
          setBackfill({ years, done: i, current: year, error: null, empty })
          const res = await fetchYearInto(year)
          if (res.status === 'error') {
            setBackfill({
              years,
              done: i,
              current: null,
              error: `${year} 年补抓失败：${res.message ?? '未知错误'}`,
              empty,
            })
            return
          }
          if (res.status === 'ok' && res.count === 0) empty.push(year)
        }
        setBackfill({ years, done: years.length, current: null, error: null, empty })
      } finally {
        backfillingRef.current = false
      }
    },
    [fetchYearInto],
  )

  /**
   * 强制重抓区间内的动态：清掉空表与「平台 0 条」标记后重新抓一轮。
   * 用于历史遗留的空快照（旧版本把 0 条写成空数组，被判为已抓而永不重抓）。
   */
  const refreshRange = useCallback(() => {
    const snap = snapshotRef.current
    if (!snap || !token || backfillingRef.current) return
    const years = rangeYears(rangeRef.current)
    const nextEvents = { ...snap.eventsByYear }
    let nextUnavailable = { ...(snap.eventsUnavailable ?? {}) }
    let changed = false
    for (const y of years) {
      const key = String(y)
      if (nextEvents[key] && nextEvents[key].length === 0) {
        delete nextEvents[key]
        changed = true
      }
      if (nextUnavailable[key] === 'empty') {
        nextUnavailable = omitKey(nextUnavailable, key) ?? {}
        changed = true
      }
    }
    if (changed) commitSnapshot({ ...snap, eventsByYear: nextEvents, eventsUnavailable: nextUnavailable })
    attemptedYearsRef.current.clear()
    const todo = missingYears(rangeRef.current, nextEvents, nextUnavailable)
    if (todo.length > 0) void backfillYears(todo)
  }, [token, commitSnapshot, backfillYears])

  const probeEvents = useCallback(
    async (year: number) => {
      const snap = snapshotRef.current
      if (!snap || !token) return
      try {
        const raw = await getClient().listUserEvents(snap.login, year)
        const page = normalizeEventsPage(raw)
        const days = Object.keys(page.byDate).length
        const events = Object.values(page.byDate).reduce((n, list) => n + list.length, 0)
        setProbe({
          year,
          summary: `${describeEventsResponse(raw)} · 解析出 ${days} 天 / ${events} 条`,
        })
      } catch (err) {
        setProbe({ year, summary: `请求失败：${apiErrorMessage(err)}` })
      }
    },
    [token, getClient],
  )

  const setRange = useCallback((next: DateRange) => {
    rangeRef.current = next
    setRangeState(next)
    saveRange(next)
    attemptedYearsRef.current.clear() // 换区间允许重新尝试失败的年份
    setBackfill(null)
  }, [])

  const startDeepCrawl = useCallback(() => {
    const snap = snapshotRef.current
    if (!snap || !token) return
    if (deepKindRef.current === 'running') return
    // 增量：只跳过已拿到提交样本的仓库；空结果（失败/空仓库）可重试
    const skip = new Set(
      Object.entries(snap.commitsRecentByRepo ?? {})
        .filter(([, list]) => list.length > 0)
        .map(([path]) => path),
    )
    const controller = new AbortController()
    deepAbortRef.current = controller
    setDeepCrawl({ kind: 'running', current: 0, total: 0, message: '准备深度抓取…' })
    deepCrawlCommits(getClient(), snap.repos, {
      skip,
      scope: deepScopeRef.current,
      login: snap.login,
      signal: controller.signal,
      onProgress: ({ current, total, message }) =>
        setDeepCrawl({ kind: 'running', current, total, message }),
    })
      .then((result) => {
        const prev = snapshotRef.current
        if (!prev) return
        const merged: AnalysisSnapshot = {
          ...prev,
          commitsRecentByRepo: {
            ...(prev.commitsRecentByRepo ?? {}),
            ...result.commitsByRepo,
          },
        }
        commitSnapshot(merged)
        setDeepCrawl({
          kind: 'done',
          at: new Date().toISOString(),
          fetched: Object.keys(result.commitsByRepo).length,
          failed: result.failedCount,
          truncated: result.truncated.length,
        })
      })
      .catch((err: unknown) => {
        if (isAbort(err)) {
          setDeepCrawl({ kind: 'aborted' })
        } else {
          setDeepCrawl({ kind: 'error', message: apiErrorMessage(err) })
        }
      })
  }, [token, getClient, commitSnapshot])

  const abortDeepCrawl = useCallback(() => {
    deepAbortRef.current?.abort()
  }, [])

  /** 清空深度提交数据并立即全量重抓 */
  const resetDeepCrawl = useCallback(() => {
    const snap = snapshotRef.current
    if (!snap || !token) return
    if (deepKindRef.current === 'running') return
    const next: AnalysisSnapshot = { ...snap, commitsRecentByRepo: {} }
    commitSnapshot(next)
    startDeepCrawl()
  }, [token, commitSnapshot, startDeepCrawl])

  const setDeepScopeWithRef = useCallback((scope: DeepCrawlScope) => {
    deepScopeRef.current = scope
    setDeepScope(scope)
  }, [])

  const signIn = useCallback(
    async (inputToken: string, remember: boolean): Promise<GitCodeUser> => {
      const client = new GitCodeClient(inputToken)
      const me = await client.getUser() // 无效令牌/网络错误在此抛出
      if (remember) {
        setRemembered(saveRememberedToken(inputToken))
      } else {
        clearRememberedToken()
        setRemembered(false)
      }
      setToken(inputToken)
      setUser(me)
      return me
    },
    [],
  )

  const signOut = useCallback(() => {
    abortRef.current?.abort()
    deepAbortRef.current?.abort()
    clearRememberedToken()
    clearSnapshot()
    setRemembered(false)
    setToken(null)
    setUser(null)
    setSnapshot(null)
    setSnapshotSaveFailed(false)
    setCrawl({ kind: 'idle' })
    setEventFetch(null)
    setDeepCrawl({ kind: 'idle' })
    setBackfill(null)
    backfillingRef.current = false
    attemptedYearsRef.current.clear()
  }, [])

  // 登录后：没有可复用快照时自动开抓（切换账号时先清掉旧快照）
  useEffect(() => {
    if (!user) return
    const snap = snapshotRef.current
    if (snap && snap.login !== user.login) {
      clearSnapshot()
      snapshotRef.current = null
      setSnapshot(null)
    } else if (snap) {
      return // 同账号快照可复用
    }
    if (crawlKindRef.current === 'idle' || crawlKindRef.current === 'aborted') {
      startCrawl()
    }
  }, [user, startCrawl])

  // 迁移：旧快照的 'empty' 标记与「缺仓库字段」的年度数据都不可信，需重抓一次
  useEffect(() => {
    const snap = snapshotRef.current
    if (!snap) return
    if ((snap.eventsCalibre ?? 1) >= EVENTS_CALIBRE) return

    const nextUnavailable = { ...(snap.eventsUnavailable ?? {}) }
    for (const [key, kind] of Object.entries(nextUnavailable)) {
      if (kind === 'empty') delete nextUnavailable[key]
    }

    // 仓库字段全空的年份：旧解析器只读 project 字段，这些数据按仓库维度不可用
    const nextEvents = { ...snap.eventsByYear }
    for (const [key, list] of Object.entries(nextEvents)) {
      if (list.length > 0 && list.every((e) => !e.repoPath)) delete nextEvents[key]
    }

    commitSnapshot({
      ...snap,
      eventsCalibre: EVENTS_CALIBRE,
      eventsByYear: nextEvents,
      eventsUnavailable: nextUnavailable,
    })
    attemptedYearsRef.current.clear()
  }, [snapshot, commitSnapshot])

  // 区间覆盖到未抓取的年份时自动补抓（不与首轮抓取、已有补抓叠加）
  useEffect(() => {
    if (!user || !snapshot || !token) return
    if (crawl.kind === 'running' || backfillingRef.current) return
    const todo = missingYears(
      range,
      snapshot.eventsByYear,
      snapshot.eventsUnavailable,
    ).filter((y) => !attemptedYearsRef.current.has(y))
    if (todo.length === 0) return
    void backfillYears(todo)
  }, [user, snapshot, range, crawl.kind, token, backfillYears])

  // 启动：若有记住的令牌，静默验证并恢复快照
  useEffect(() => {
    const rememberedToken = loadRememberedToken()
    if (!rememberedToken) return
    setBooting(true)
    let cancelled = false
    new GitCodeClient(rememberedToken)
      .getUser()
      .then((me) => {
        if (cancelled) return
        const snap = loadSnapshot()
        if (snap && snap.login === me.login) setSnapshot(snap)
        setToken(rememberedToken)
        setUser(me)
        setRemembered(true)
      })
      .catch(() => {
        if (cancelled) return
        clearRememberedToken() // 令牌已失效，回到输入页
      })
      .finally(() => {
        if (!cancelled) setBooting(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AppStoreValue>(
    () => ({
      token,
      user,
      remembered,
      booting,
      snapshot,
      snapshotSaveFailed,
      crawl,
      eventFetch,
      deepCrawl,
      range,
      setRange,
      backfill,
      refreshRange,
      probe,
      probeEvents,
      signIn,
      signOut,
      getClient,
      startCrawl,
      abortCrawl,
      toggleExclude,
      fetchYear,
      startDeepCrawl,
      resetDeepCrawl,
      abortDeepCrawl,
      deepScope,
      setDeepScope: setDeepScopeWithRef,
    }),
    [
      token,
      user,
      remembered,
      booting,
      snapshot,
      snapshotSaveFailed,
      crawl,
      eventFetch,
      deepCrawl,
      range,
      setRange,
      backfill,
      refreshRange,
      probe,
      probeEvents,
      signIn,
      signOut,
      getClient,
      startCrawl,
      abortCrawl,
      toggleExclude,
      fetchYear,
      startDeepCrawl,
      resetDeepCrawl,
      abortDeepCrawl,
      deepScope,
      setDeepScopeWithRef,
    ],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext)
  if (!ctx) throw new Error('useAppStore 必须在 AppStoreProvider 内使用')
  return ctx
}
