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
import { crawlAccount } from '../lib/crawler'
import type { CrawlProgress } from '../lib/crawler'
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
  signIn(token: string, remember: boolean): Promise<GitCodeUser>
  signOut(): void
  getClient(): GitCodeClient
  startCrawl(): void
  abortCrawl(): void
  toggleExclude(repoPath: string): void
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

  const clientRef = useRef<{ token: string; client: GitCodeClient } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const crawlKindRef = useRef<CrawlState['kind']>('idle')
  const snapshotRef = useRef<AnalysisSnapshot | null>(null)

  crawlKindRef.current = crawl.kind
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
        }
        const ok = saveSnapshot(snap)
        setSnapshotSaveFailed(!ok)
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
    clearRememberedToken()
    clearSnapshot()
    setRemembered(false)
    setToken(null)
    setUser(null)
    setSnapshot(null)
    setSnapshotSaveFailed(false)
    setCrawl({ kind: 'idle' })
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
      signIn,
      signOut,
      getClient,
      startCrawl,
      abortCrawl,
      toggleExclude,
    }),
    [
      token,
      user,
      remembered,
      booting,
      snapshot,
      snapshotSaveFailed,
      crawl,
      signIn,
      signOut,
      getClient,
      startCrawl,
      abortCrawl,
      toggleExclude,
    ],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext)
  if (!ctx) throw new Error('useAppStore 必须在 AppStoreProvider 内使用')
  return ctx
}
