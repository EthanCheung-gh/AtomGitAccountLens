import { useState } from 'react'
import CrawlBanner from './components/CrawlBanner'
import TokenGate from './components/TokenGate'
import { useAppStore } from './state/AppStore'
import OverviewTab from './tabs/OverviewTab'
import ReposTab from './tabs/ReposTab'
import ActivityTab from './tabs/ActivityTab'
import ReportTab from './tabs/ReportTab'

export type TabId = 'overview' | 'repos' | 'activity' | 'report'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'repos', label: '仓库画像' },
  { id: 'activity', label: '活跃度' },
  { id: 'report', label: '年度报告' },
]

export default function App() {
  const { user, booting, signIn, signOut } = useAppStore()
  const [tab, setTab] = useState<TabId>('overview')

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <h1>AtomGitAccountLens</h1>
            <p className="brand-sub">GitCode / AtomGit 账号全景透镜</p>
          </div>
        </div>
        <div className="header-slot">
          {user && (
            <div className="user-chip">
              {user.avatar_url ? (
                <img className="user-avatar" src={user.avatar_url} alt="" />
              ) : (
                <span className="user-avatar user-avatar-fallback" aria-hidden="true">
                  {user.login.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="user-meta">
                <span className="user-login">{user.name || user.login}</span>
                <button type="button" className="link-btn" onClick={signOut}>
                  退出
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {booting ? (
        <section className="placeholder">正在用本设备记住的令牌登录…</section>
      ) : !user ? (
        <TokenGate onSignIn={signIn} />
      ) : (
        <>
          <CrawlBanner />
          <nav className="tab-bar" aria-label="分析分区">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab-item ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <main className="tab-content">
            {tab === 'overview' && <OverviewTab />}
            {tab === 'repos' && <ReposTab />}
            {tab === 'activity' && <ActivityTab />}
            {tab === 'report' && <ReportTab />}
          </main>
        </>
      )}

      <footer className="app-footer">
        数据仅存于你的浏览器 · 令牌不经过任何第三方服务器 · API: api.gitcode.com/api/v5
      </footer>
    </div>
  )
}
