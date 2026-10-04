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
import { GitCodeClient } from '../api/client'
import type { GitCodeUser } from '../api/types'
import {
  clearRememberedToken,
  loadRememberedToken,
  saveRememberedToken,
} from '../lib/storage'

export interface AppStoreValue {
  token: string | null
  user: GitCodeUser | null
  remembered: boolean
  /** 启动时正在用记住的令牌静默验证 */
  booting: boolean
  signIn(token: string, remember: boolean): Promise<GitCodeUser>
  signOut(): void
  getClient(): GitCodeClient
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<GitCodeUser | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [booting, setBooting] = useState(false)
  const clientRef = useRef<{ token: string; client: GitCodeClient } | null>(null)

  const getClient = useCallback((): GitCodeClient => {
    if (!token) throw new Error('尚未登录')
    if (clientRef.current?.token !== token) {
      clientRef.current = { token, client: new GitCodeClient(token) }
    }
    return clientRef.current.client
  }, [token])

  const signIn = useCallback(
    async (inputToken: string, remember: boolean): Promise<GitCodeUser> => {
      const client = new GitCodeClient(inputToken)
      const me = await client.getUser() // 无效令牌/网络错误在此抛出
      if (remember) {
        const ok = saveRememberedToken(inputToken)
        setRemembered(ok)
        if (!ok) {
          // 记住失败不阻断登录，仅不落盘
        }
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
    clearRememberedToken()
    setRemembered(false)
    setToken(null)
    setUser(null)
  }, [])

  // 启动：若有记住的令牌，静默验证
  useEffect(() => {
    const rememberedToken = loadRememberedToken()
    if (!rememberedToken) return
    setBooting(true)
    let cancelled = false
    new GitCodeClient(rememberedToken)
      .getUser()
      .then((me) => {
        if (cancelled) return
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
    () => ({ token, user, remembered, booting, signIn, signOut, getClient }),
    [token, user, remembered, booting, signIn, signOut, getClient],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext)
  if (!ctx) throw new Error('useAppStore 必须在 AppStoreProvider 内使用')
  return ctx
}
