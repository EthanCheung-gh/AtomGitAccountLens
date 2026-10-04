import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from '../components/EChart'
import EmptyState from '../components/EmptyState'
import ProgressBar from '../components/ProgressBar'
import { useAppStore } from '../state/AppStore'
import {
  aggregateLanguages,
  deepCommitCount,
  languageStarWeighted,
  namespaceStats,
  repoCreationTimeline,
  repoFreshness,
  repoMajorLanguage,
  repoMetrics,
  repoPath,
  topStargazed,
} from '../lib/aggregate'
import { currentYear, formatCount, formatDate } from '../lib/format'

const AXIS_COLOR = '#8b949e'
const SPLIT_LINE = '#21262d'
const TOOLTIP_STYLE = {
  backgroundColor: '#161b22',
  borderColor: '#30363d',
  textStyle: { color: '#e6edf3' },
}

function truncate(name: string, max = 26): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

type LangCalibre = 'repo' | 'star'

export default function ReposTab() {
  const {
    snapshot,
    crawl,
    startCrawl,
    toggleExclude,
    deepCrawl,
    startDeepCrawl,
    abortDeepCrawl,
  } = useAppStore()
  const [query, setQuery] = useState('')
  const [calibre, setCalibre] = useState<LangCalibre>('repo')

  const view = useMemo(() => {
    if (!snapshot) return null
    const excludedSet = new Set(snapshot.excludedRepos)
    const rows = snapshot.repos
      .map((repo) => {
        const path = repoPath(repo)
        return {
          path,
          repo,
          excluded: path !== '' && excludedSet.has(path),
          major: repoMajorLanguage(repo, snapshot.languagesByRepo[path]),
        }
      })
      .sort((a, b) => {
        const pa = a.repo.pushed_at ?? a.repo.updated_at ?? ''
        const pb = b.repo.pushed_at ?? b.repo.updated_at ?? ''
        return pb.localeCompare(pa)
      })
    const metrics = repoMetrics(snapshot.repos, snapshot.excludedRepos)
    return { rows, metrics }
  }, [snapshot])

  const languages = useMemo(() => {
    if (!snapshot) return []
    return aggregateLanguages(
      snapshot.repos,
      snapshot.languagesByRepo,
      snapshot.excludedRepos,
    ).slice(0, 10)
  }, [snapshot])

  const langStar = useMemo(() => {
    if (!snapshot) return []
    return languageStarWeighted(
      snapshot.repos,
      snapshot.languagesByRepo,
      snapshot.excludedRepos,
    ).slice(0, 10)
  }, [snapshot])

  const activeLangs = calibre === 'repo' ? languages : langStar

  const langOption = useMemo<EChartsOption>(() => {
    const top = activeLangs.slice(0, 10)
    return {
      tooltip: TOOLTIP_STYLE,
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'category',
        data: top.map((l) => `${l.language}（${l.repoCount} 仓）`).reverse(),
        axisLabel: { color: '#e6edf3', fontSize: 12 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: top.map((l) => Number(l.percent.toFixed(1))).reverse(),
          itemStyle: {
            color: calibre === 'repo' ? '#58a6ff' : '#d2a8ff',
            borderRadius: [0, 3, 3, 0],
          },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [activeLangs, calibre])

  const creationTimeline = useMemo(
    () => (snapshot ? repoCreationTimeline(snapshot.repos, snapshot.excludedRepos) : []),
    [snapshot],
  )
  const creationOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 44, right: 16, top: 18, bottom: 30 },
      xAxis: {
        type: 'time',
        axisLabel: { color: AXIS_COLOR, fontSize: 11, formatter: '{yyyy}-{MM}' },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          data: creationTimeline.map((m) => [`${m.month}-01`, m.count]),
          areaStyle: { opacity: 0.25 },
          lineStyle: { color: '#39d353', width: 2 },
          itemStyle: { color: '#39d353' },
        },
      ],
    }),
    [creationTimeline],
  )

  const freshness = useMemo(
    () => (snapshot ? repoFreshness(snapshot.repos, snapshot.excludedRepos) : null),
    [snapshot],
  )
  const freshnessOption = useMemo<EChartsOption>(() => {
    const data = freshness
      ? [freshness.within30, freshness.within180, freshness.within365, freshness.dormant]
      : [0, 0, 0, 0]
    return {
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 40, right: 12, top: 18, bottom: 30 },
      xAxis: {
        type: 'category',
        data: ['30 天内', '半年内', '一年内', '休眠 >1 年'],
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      series: [
        {
          type: 'bar',
          data,
          itemStyle: { color: '#58a6ff', borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [freshness])

  const topStars = useMemo(
    () => (snapshot ? topStargazed(snapshot.repos, snapshot.excludedRepos, 10) : []),
    [snapshot],
  )
  const topStarsOption = useMemo<EChartsOption>(() => {
    const items = topStars.slice(0, 10)
    return {
      tooltip: TOOLTIP_STYLE,
      grid: { left: 8, right: 44, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'category',
        data: items.map((t) => truncate(t.path)).reverse(),
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((t) => t.stars).reverse(),
          itemStyle: { color: '#e3b341', borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [topStars])

  const nsStats = useMemo(() => {
    if (!snapshot) return []
    const events = snapshot.eventsByYear[String(currentYear())] ?? []
    return namespaceStats(snapshot.repos, events, snapshot.excludedRepos)
  }, [snapshot])
  const nsOption = useMemo<EChartsOption>(() => {
    const items = nsStats.slice(0, 8)
    return {
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      legend: {
        top: 0,
        textStyle: { color: AXIS_COLOR, fontSize: 11 },
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 44, right: 12, top: 34, bottom: 30 },
      xAxis: {
        type: 'category',
        data: items.map((n) => truncate(n.ns, 12)),
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '仓库',
          nameTextStyle: { color: AXIS_COLOR },
          minInterval: 1,
          axisLabel: { color: AXIS_COLOR, fontSize: 11 },
          splitLine: { lineStyle: { color: SPLIT_LINE } },
        },
        {
          type: 'value',
          name: '提交',
          nameTextStyle: { color: AXIS_COLOR },
          minInterval: 1,
          axisLabel: { color: AXIS_COLOR, fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '仓库数',
          type: 'bar',
          data: items.map((n) => n.repos),
          itemStyle: { color: '#58a6ff', borderRadius: [3, 3, 0, 0] },
        },
        {
          name: `${currentYear()} 年提交`,
          type: 'bar',
          yAxisIndex: 1,
          data: items.map((n) => n.commits),
          itemStyle: { color: '#39d353', borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [nsStats])

  const deepTotal = useMemo(
    () => deepCommitCount(snapshot?.commitsRecentByRepo),
    [snapshot],
  )

  if (!snapshot) {
    return (
      <EmptyState
        title="还没有仓库数据"
        hint={crawl.kind === 'running' ? '正在抓取仓库清单…' : '抓取完成后可在此勾选排除不参与统计的仓库。'}
      >
        {crawl.kind !== 'running' && (
          <button type="button" className="btn primary" onClick={startCrawl}>
            开始抓取
          </button>
        )}
      </EmptyState>
    )
  }

  const { rows, metrics } = view!
  const q = query.trim().toLowerCase()
  const filtered = q
    ? rows.filter(
        (r) =>
          r.path.toLowerCase().includes(q) ||
          (r.repo.description ?? '').toLowerCase().includes(q),
      )
    : rows

  return (
    <section className="repos-tab">
      {activeLangs.length > 0 && (
        <div className="card repos-lang-card">
          <div className="repos-lang-head">
            <h3>账号语言构成（计入统计的仓库）</h3>
            <div className="calibre-toggle" role="group" aria-label="语言统计口径">
              <button
                type="button"
                className={calibre === 'repo' ? 'active' : ''}
                onClick={() => setCalibre('repo')}
              >
                仓库数加权
              </button>
              <button
                type="button"
                className={calibre === 'star' ? 'active' : ''}
                onClick={() => setCalibre('star')}
              >
                Star 加权
              </button>
            </div>
          </div>
          <EChart option={langOption} height={Math.max(160, activeLangs.length * 28 + 50)} />
          <p className="muted">
            {calibre === 'repo'
              ? '口径：GitCode 语言接口返回仓库内各语言百分比（非代码行数），此处为各仓库百分比按仓库数加权的账号级占比；括号内为主语言为该语言的仓库数。'
              : '口径：Star 加权 = 仓库内语言百分比 × max(1, 仓库 Star 数)，突出被社区认可的技术栈；括号内为主语言仓库数。'}
            勾选/取消仓库即时重算。
          </p>
        </div>
      )}

      {creationTimeline.length > 0 && (
        <div className="card chart-card">
          <h3>仓库创作时间线（按创建月份）</h3>
          <EChart option={creationOption} height={220} />
        </div>
      )}

      <div className="chart-grid">
        {freshness && (
          <div className="card chart-card">
            <h3>仓库新鲜度（按最近推送）</h3>
            <EChart option={freshnessOption} height={230} />
          </div>
        )}
        {topStars.length > 0 && (
          <div className="card chart-card">
            <h3>Top 被星仓库（Star 数）</h3>
            <EChart option={topStarsOption} height={Math.max(160, topStars.length * 28 + 50)} />
          </div>
        )}
      </div>

      {nsStats.length > 1 && (
        <div className="card chart-card">
          <h3>个人 / 组织（命名空间）分布</h3>
          <EChart option={nsOption} height={240} />
          <p className="muted">仓库数来自仓库清单；提交数为 {currentYear()} 年事件流按仓库路径前缀归属。</p>
        </div>
      )}

      <div className="repos-toolbar">
        <div className="repos-toolbar-info">
          <strong>{metrics.total}</strong> 个仓库 · 排除 <strong>{metrics.excluded}</strong> ·
          计入统计 <strong>{metrics.included}</strong>
        </div>
        <input
          className="input repos-search"
          type="search"
          placeholder="搜索仓库/描述…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn" onClick={startCrawl} disabled={crawl.kind === 'running'}>
          {crawl.kind === 'running' ? '抓取中…' : '重新抓取'}
        </button>
        {deepCrawl.kind === 'running' ? (
          <div className="deep-crawl-inline">
            <ProgressBar current={deepCrawl.current} total={deepCrawl.total} />
            <button type="button" className="btn danger" onClick={abortDeepCrawl}>
              中断
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={startDeepCrawl}
            disabled={crawl.kind === 'running'}
            title="逐仓库拉取最近 100 条提交（走限流队列，可中断，增量续抓）"
          >
            {deepTotal > 0 ? `深度抓取（已 ${formatCount(deepTotal)} 条）` : '深度抓取提交'}
          </button>
        )}
      </div>

      {deepCrawl.kind === 'error' && (
        <p className="activity-error">
          深度抓取失败：{deepCrawl.message}
          <button type="button" className="btn" onClick={startDeepCrawl}>
            重试
          </button>
        </p>
      )}

      <p className="muted">
        取消勾选即把该仓库排除出统计口径（总览、活跃度、年度报告同步生效）。
      </p>

      <ul className="repo-list">
        {filtered.map((row, i) => (
          <li
            key={row.path || `repo-${row.repo.id ?? i}`}
            className={`repo-row ${row.excluded ? 'excluded' : ''}`}
          >
            <label className="repo-check">
              <input
                type="checkbox"
                checked={!row.excluded}
                onChange={() => toggleExclude(row.path)}
                aria-label={`${row.excluded ? '包含' : '排除'} ${row.path}`}
              />
            </label>
            <div className="repo-main">
              <a
                href={row.repo.html_url ?? `https://gitcode.com/${row.path}`}
                target="_blank"
                rel="noreferrer"
                className="repo-name"
              >
                {row.path || '(未知路径)'}
              </a>
              {row.repo.description && (
                <p className="repo-desc">{row.repo.description}</p>
              )}
              <div className="repo-tags">
                {row.repo.private && <span className="tag tag-private">私有</span>}
                {row.repo.fork && <span className="tag">Fork</span>}
                {row.major && <span className="tag tag-lang">{row.major}</span>}
              </div>
            </div>
            <div className="repo-stats">
              <span title="Star">★ {formatCount(row.repo.stargazers_count ?? 0)}</span>
              <span title="Fork">⑂ {formatCount(row.repo.forks_count ?? 0)}</span>
              <span className="repo-push" title="最近推送">
                {formatDate(row.repo.pushed_at ?? row.repo.updated_at)}
              </span>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="repo-empty muted">没有匹配「{query}」的仓库。</li>
        )}
      </ul>
    </section>
  )
}
