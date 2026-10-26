import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from '../components/EChart'
import EmptyState from '../components/EmptyState'
import RangePicker from '../components/RangePicker'
import ScopeGuide from '../components/ScopeGuide'
import { useAppStore } from '../state/AppStore'
import {
  aggregateLanguages,
  longestGapDays,
  longestStreak,
  maxDailyCommits,
  peakIndex,
  peakMonthInRange,
  pushSizeStats,
  repoMetrics,
  summarizeEvents,
} from '../lib/aggregate'
import { formatCount, formatDate } from '../lib/format'
import { collectEvents, formatRangeLabel, rangeYears, yearStatuses } from '../lib/range'
import { chart, palette } from '../theme'


function truncate(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

export default function ReportTab() {
  const { snapshot, crawl, startCrawl, range, backfill } = useAppStore()

  const rangeLabel = formatRangeLabel(range)
  const events = useMemo(() => collectEvents(snapshot?.eventsByYear, range), [snapshot, range])
  const loading = backfill !== null && backfill.current !== null
  const allScopeBlocked = useMemo(() => {
    const years = rangeYears(range)
    if (years.length === 0 || !snapshot) return false
    return (
      events.length === 0 &&
      years.every((y) => snapshot.eventsUnavailable?.[String(y)] === 'scope')
    )
  }, [range, snapshot, events.length])

  const allEmptyEvents = useMemo(() => {
    const st = yearStatuses(range, snapshot?.eventsByYear, snapshot?.eventsUnavailable)
    return st.length > 0 && st.every((x) => x.kind === 'empty')
  }, [range, snapshot])

  const summary = useMemo(() => summarizeEvents(events), [events])
  const languages = useMemo(() => {
    if (!snapshot) return []
    return aggregateLanguages(
      snapshot.repos,
      snapshot.languagesByRepo,
      snapshot.excludedRepos,
    ).slice(0, 8)
  }, [snapshot])
  const metrics = useMemo(
    () => (snapshot ? repoMetrics(snapshot.repos, snapshot.excludedRepos) : null),
    [snapshot],
  )

  const langOption = useMemo<EChartsOption>(() => {
    const top = languages.slice(0, 8)
    return {
      tooltip: { ...chart.tooltip },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: chart.split } },
      },
      yAxis: {
        type: 'category',
        data: top.map((l) => `${l.language}（${l.repoCount} 仓）`).reverse(),
        axisLabel: { color: chart.label, fontSize: 12 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: top.map((l) => Number(l.percent.toFixed(1))).reverse(),
          itemStyle: {
            color: palette.accent,
            borderRadius: [0, 3, 3, 0],
          },
          label: { show: true, position: 'right', color: chart.axis, fontSize: 11 },
        },
      ],
    }
  }, [languages])

  if (!snapshot) {
    return (
      <EmptyState
        title="还没有区间报告"
        hint={crawl.kind === 'running' ? '正在抓取，请稍候…' : '抓取完成后这里会生成可截图分享的时间段总结。'}
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
  const peak = peakMonthInRange(events, range)
  const peakHour = peakIndex(summary.eventsByHour)
  const streak = longestStreak(summary.commitsByDate)
  const maxDaily = maxDailyCommits(summary.commitsByDate)
  const gap = longestGapDays(summary.commitsByDate)
  const pushSizes = pushSizeStats(events)

  return (
    <section className="report-tab">
      <div className="activity-toolbar">
        <RangePicker />
        <span className="muted">整页截图即可分享你的报告。</span>
      </div>

      {allScopeBlocked ? (
        <div className="card">
          <h3>{rangeLabel}报告</h3>
          <ScopeGuide />
        </div>
      ) : events.length === 0 ? (
        loading ? (
          <EmptyState title={`正在补抓 ${backfill?.current ?? ''} 年动态…`} />
        ) : (
          <EmptyState
            title={`${rangeLabel}没有动态数据`}
            hint={
              allEmptyEvents
                ? '平台 events 接口对该区间返回 0 条（该接口只记录平台侧动态，私有仓库活动可能不在其中）。提交级数据在「活跃度」页的深度抓取里，不受此限制。'
                : '换个区间试试。'
            }
          />
        )
      ) : (
        <>
          <div className="report-hero">
            <div className="report-hero-head">
              {user.avatar_url && (
                <img className="report-avatar" src={user.avatar_url} alt="" />
              )}
              <div>
                <p className="report-year-label">{formatRangeLabel(range)}</p>
                <h2>{user.name || user.login} 的代码报告</h2>
              </div>
            </div>
            <div className="report-hero-numbers">
              <div>
                <strong>{formatCount(summary.totalCommits)}</strong>
                <span>次提交</span>
              </div>
              <div>
                <strong>{summary.activeDays}</strong>
                <span>个活跃日</span>
              </div>
              <div>
                <strong>{summary.byRepo.length}</strong>
                <span>个活跃仓库</span>
              </div>
              <div>
                <strong>{streak}</strong>
                <span>天最长连续</span>
              </div>
            </div>
            <p className="report-hero-range muted">
              {formatDate(summary.firstDate)} — {formatDate(summary.lastDate)} · 单日最高{' '}
              {maxDaily} 次提交
            </p>
          </div>

          <div className="chart-grid">
            <div className="card report-card">
              <h3>节奏画像</h3>
              <ul className="report-facts">
                <li>
                  最活跃月份是 <strong>{peak ? peak.month : '—'}</strong>
                  {peak && `（${formatCount(peak.commits)} 次提交）`}
                </li>
                <li>
                  高产时段在 <strong>{peakHour} 点</strong>前后
                  （{formatCount(summary.eventsByHour[peakHour])} 次动态）
                </li>
                <li>
                  提交习惯：平均每次推送 <strong>{pushSizes.avg}</strong> 个提交，
                  单次最多 <strong>{pushSizes.max}</strong> 个
                </li>
                <li>
                  最长连续活跃 <strong>{streak}</strong> 天，
                  最长空窗 <strong>{gap}</strong> 天
                </li>
                <li>
                  区间内 <strong>{formatCount(summary.totalEvents)}</strong> 次动态，
                  覆盖 <strong>{summary.activeDays}</strong> 天
                </li>
                <li>
                  计入统计的仓库 <strong>{metrics?.included ?? '—'}</strong> 个
                  （共 {metrics?.total ?? '—'}，排除 {metrics?.excluded ?? 0}）
                </li>
              </ul>
            </div>
            <div className="card report-card">
              <h3>区间最活跃仓库 Top 5</h3>
              <ol className="report-top-repos">
                {summary.byRepo.slice(0, 5).map((r) => (
                  <li key={r.repo}>
                    <span className="report-repo-name">{truncate(r.repo)}</span>
                    <span className="report-repo-commits">
                      {formatCount(r.commits)} 次提交
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="card report-card">
            <h3>语言构成（按仓库数加权）</h3>
            {languages.length === 0 ? (
              <p className="muted">暂无语言数据。</p>
            ) : (
              <EChart option={langOption} height={Math.max(160, languages.length * 30 + 50)} />
            )}
            <p className="muted report-calibre">
              口径：GitCode 语言接口返回各仓库内语言百分比（非代码行数），账号级占比为各仓库百分比按仓库加权求和；
              括号内「主语言仓库数」指以该语言为主语言的仓库个数。
            </p>
          </div>
        </>
      )}
    </section>
  )
}
