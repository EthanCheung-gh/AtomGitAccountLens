import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from '../components/EChart'
import EmptyState from '../components/EmptyState'
import { useAppStore } from '../state/AppStore'
import {
  aggregateLanguages,
  repoMajorLanguage,
  repoMetrics,
  repoPath,
} from '../lib/aggregate'
import { formatCount, formatDate } from '../lib/format'

const AXIS_COLOR = '#8b949e'
const SPLIT_LINE = '#21262d'

export default function ReposTab() {
  const { snapshot, crawl, startCrawl, toggleExclude } = useAppStore()
  const [query, setQuery] = useState('')

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

  const langOption = useMemo<EChartsOption>(() => {
    const top = languages.slice(0, 10)
    return {
      tooltip: {
        backgroundColor: '#161b22',
        borderColor: '#30363d',
        textStyle: { color: '#e6edf3' },
      },
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
          itemStyle: { color: '#58a6ff', borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [languages])

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
      {languages.length > 0 && (
        <div className="card repos-lang-card">
          <h3>账号语言构成（计入统计的仓库）</h3>
          <EChart option={langOption} height={Math.max(160, languages.length * 28 + 50)} />
          <p className="muted">
            口径：GitCode 语言接口返回仓库内各语言百分比（非代码行数），此处为各仓库百分比按仓库数加权的账号级占比；
            括号内为主语言为该语言的仓库数。勾选/取消仓库即时重算。
          </p>
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
      </div>

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
