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
import { GitCodeClient, apiErrorMessage, isApiError } from '../api/client'
import type { GitCodeUser } from '../api/types'
import { crawlAccount, deepCrawlCommits, fetchEventsYear } from '../lib/crawler'
import type { CrawlProgress, DeepCrawlScope } from '../lib/crawler'
import {
  AnalysisSnapshot,
  clearRememberedToken,
  clearSnapshot,
  loadRememberedToken,
  loadSnapshot,
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

export type DeepCrawlState =
  | { kind: 'idle' }
  | { kind: 'running'; current: number; total: number; message: string }
  | { kind: 'done'; at: string; fetched: number; failed: number }
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
  signIn(token: string, remember: boolean): Promise<GitCodeUser>
  signOut(): void
  getClient(): GitCodeClient
  startCrawl(): void
  abortCrawl(): void
  toggleExclude(repoPath: string): void
  /** 拉取某一年事件并并入快照（已有或不可用则跳过） */
  fetchYear(year: number): Promise<void>
  /** 深度抓取最近提交（增量：已抓过的仓库跳过） */
  startDeepCrawl(): void
  abortDeepCrawl(): void
  /** 深度抓取范围偏好：personal=仅本人命名空间（默认），all=含加入的社区/组织仓库 */
  deepScope: DeepCrawlScope
  setDeepScope(scope: DeepCrawlScope): void
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

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

  const clientRef = useRef<{ token: string; client: GitCodeClient } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const deepAbortRef = useRef<AbortController | null>(null)
  const deepKindRef = useRef<DeepCrawlState['kind']>('idle')
  const deepScopeRef = useRef<DeepCrawlScope>('personal')
  const crawlKindRef = useRef<CrawlState['kind']>('idle')
  const snapshotRef = useRef<AnalysisSnapshot | null>(null)

  crawlKindRef.current = crawl.kind
  deepKindRef.current = deepCrawl.kind
  deepScopeRef.current = deepScope
  snapshotRef.current = snapshot

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

  const fetchYear = useCallback(
    async (year: number) => {
      const snap = snapshotRef.current
      if (!snap || !token) return
      const key = String(year)
      if (snap.eventsByYear[key] || snap.eventsUnavailable?.[key]) return
      setEventFetch({ year, error: null })
      const outcome = await fetchEventsYear(getClient(), snap.login, year, {})
      if (outcome.status === 'ok') {
        commitSnapshot({
          ...snap,
          eventsByYear: { ...snap.eventsByYear, [key]: outcome.events },
        })
        setEventFetch(null)
      } else if (outcome.status === 'scope') {
        commitSnapshot({
          ...snap,
          eventsUnavailable: { ...(snap.eventsUnavailable ?? {}), [key]: 'scope' },
        })
        setEventFetch(null)
      } else {
        setEventFetch({ year, error: outcome.message })
      }
    },
    [token, getClient, commitSnapshot],
  )

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
      signIn,
      signOut,
      getClient,
      startCrawl,
      abortCrawl,
      toggleExclude,
      fetchYear,
      startDeepCrawl,
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
      signIn,
      signOut,
      getClient,
      startCrawl,
      abortCrawl,
      toggleExclude,
      fetchYear,
      startDeepCrawl,
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
