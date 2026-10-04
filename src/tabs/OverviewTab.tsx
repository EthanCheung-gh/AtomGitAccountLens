import { useMemo } from 'react'
import EmptyState from '../components/EmptyState'
import ScopeGuide from '../components/ScopeGuide'
import StatCard from '../components/StatCard'
import { useAppStore } from '../state/AppStore'
import { repoMetrics, summarizeEvents } from '../lib/aggregate'
import { currentYear, formatCount, formatDate, formatDateTime } from '../lib/format'

export default function OverviewTab() {
  const { snapshot, crawl, startCrawl, snapshotSaveFailed } = useAppStore()

  const view = useMemo(() => {
    if (!snapshot) return null
    const year = currentYear()
    const metrics = repoMetrics(snapshot.repos, snapshot.excludedRepos)
    const yearKey = String(year)
    const events = snapshot.eventsByYear[yearKey] ?? []
    const summary = summarizeEvents(events)
    const eventsState = snapshot.eventsUnavailable?.[yearKey]
    return { year, metrics, summary, eventsState }
  }, [snapshot])

  if (!snapshot) {
    return (
      <EmptyState
        title="还没有分析数据"
        hint={
          crawl.kind === 'running'
            ? '正在抓取，请稍候…'
            : '登录成功后会自动抓取；也可以手动开始。'
        }
      >
        {crawl.kind !== 'running' && (
          <button type="button" className="btn primary" onClick={startCrawl}>
            开始抓取
          </button>
        )}
      </EmptyState>
    )
  }

  const { user } = snapshot
  const { metrics, summary, eventsState, year } = view!
  const topLanguages = (user.top_languages ?? []).filter(Boolean).slice(0, 8)

  return (
    <section className="overview">
      {snapshotSaveFailed && (
        <p className="snapshot-warning">
          分析快照写入本设备失败（存储配额不足或隐私模式），刷新后需要重新抓取。
        </p>
      )}

      <div className="overview-grid">
        <div className="card profile-card">
          <div className="profile-head">
            {user.avatar_url ? (
              <img className="profile-avatar" src={user.avatar_url} alt="" />
            ) : (
              <span className="profile-avatar fallback" aria-hidden="true">
                {user.login.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="profile-id">
              <h2>{user.name || user.login}</h2>
              <a
                href={user.html_url ?? `https://gitcode.com/${user.login}`}
                target="_blank"
                rel="noreferrer"
              >
                @{user.login}
              </a>
            </div>
          </div>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          <p className="muted">
            加入于 {formatDate(user.created_at)}
            {user.email ? ` · ${user.email}` : ''}
          </p>
        </div>

        <div className="stat-grid">
          <StatCard label="计入统计的仓库" value={metrics.included} hint={`共 ${metrics.total} 个，排除 ${metrics.excluded} 个`} />
          <StatCard label="累计 Star" value={formatCount(metrics.stars)} />
          <StatCard label="累计 Fork" value={formatCount(metrics.forks)} hint={`Fork 来的仓库 ${metrics.forkedCount} 个`} />
          <StatCard label="近一年活跃仓库" value={metrics.activeCount} hint="365 天内有 push" />
          <StatCard label="Followers" value={formatCount(user.followers)} />
          <StatCard label="Following" value={formatCount(user.following)} />
          {eventsState === 'scope' ? (
            <div className="stat-card stat-card-guide">
              <div className="stat-value muted">{year} 年提交</div>
              <ScopeGuide compact />
            </div>
          ) : eventsState === 'error' ? (
            <StatCard label={`${year} 年提交`} value="—" hint="动态数据拉取失败，可重新抓取重试" />
          ) : (
            <StatCard
              label={`${year} 年提交`}
              value={formatCount(summary.totalCommits)}
              hint={`${summary.totalEvents} 次动态 · 活跃 ${summary.activeDays} 天`}
            />
          )}
        </div>
      </div>

      <div className="card lang-card">
        <h3>账号主语言（GitCode 官方口径 top_languages）</h3>
        {topLanguages.length === 0 ? (
          <p className="muted">GitCode 未返回 top_languages 数据。</p>
        ) : (
          <div className="lang-bars">
            {topLanguages.map((lang, i) => (
              <span key={lang} className="lang-chip" style={{ opacity: 1 - i * 0.09 }}>
                {lang}
              </span>
            ))}
          </div>
        )}
        <p className="muted">
          说明：GitCode API 不提供代码行数，规模指标以仓库数与提交数为代理，不虚构行数统计。
        </p>
      </div>

      <p className="muted snapshot-meta">数据抓取于 {formatDateTime(snapshot.createdAt)}</p>
    </section>
  )
}
