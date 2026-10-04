import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import DeepCrawlAnalysis from '../components/DeepCrawlAnalysis'
import DeepCrawlControls from '../components/DeepCrawlControls'
import EChart from '../components/EChart'
import EmptyState from '../components/EmptyState'
import ScopeGuide from '../components/ScopeGuide'
import StatCard from '../components/StatCard'
import { useAppStore } from '../state/AppStore'
import {
  actionBreakdown,
  cumulativeCommits,
  pushSizeStats,
  repoMonthlyStack,
  summarizeEvents,
  weekdayHourMatrix,
} from '../lib/aggregate'
import { currentYear, formatCount } from '../lib/format'

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

export default function ActivityTab() {
  const { snapshot, crawl, startCrawl, eventFetch, fetchYear } = useAppStore()
  const [year, setYear] = useState<number>(currentYear())

  const years = useMemo<number[]>(() => {
    if (!snapshot) return []
    const created = snapshot.user.created_at
      ? new Date(snapshot.user.created_at).getFullYear()
      : currentYear()
    const start = Math.min(created, currentYear())
    const list: number[] = []
    for (let y = currentYear(); y >= start; y--) list.push(y)
    return list
  }, [snapshot])

  // 切换到未抓取的年份时增量拉取
  useEffect(() => {
    void fetchYear(year)
  }, [year, fetchYear])

  const yearKey = String(year)
  const events = snapshot?.eventsByYear[yearKey]
  const unavailable = snapshot?.eventsUnavailable?.[yearKey]
  const loading = eventFetch?.year === year && eventFetch.error === null
  const fetchError = eventFetch?.year === year ? eventFetch.error : null

  // 所有 hooks 必须在条件 return 之前（React 规则）
  const summary = useMemo(() => summarizeEvents(events ?? []), [events])

  const heatmapOption = useMemo<EChartsOption>(() => {
    const data = Object.entries(summary.commitsByDate).map(([date, count]) => [date, count])
    const maxDaily = data.reduce((m, d) => Math.max(m, d[1] as number), 0)
    return {
      tooltip: {
        ...TOOLTIP_STYLE,
        formatter: (p: unknown) => {
          const v = (p as { value: [string, number] }).value
          return `${v[0]}：${v[1]} 次提交`
        },
      },
      visualMap: {
        min: 0,
        max: Math.max(1, maxDaily),
        type: 'continuous',
        orient: 'horizontal',
        left: 'center',
        top: 0,
        itemHeight: 120,
        inRange: {
          color: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
        },
        textStyle: { color: AXIS_COLOR },
      },
      calendar: {
        range: [`${year}-01-01`, `${year}-12-31`],
        cellSize: ['auto', 14],
        left: 44,
        right: 16,
        top: 44,
        bottom: 4,
        itemStyle: {
          color: '#0d1117',
          borderColor: '#161b22',
          borderWidth: 2,
        },
        splitLine: { show: false },
        yearLabel: { show: false },
        monthLabel: { nameMap: 'cn', color: AXIS_COLOR, fontSize: 11 },
        dayLabel: { nameMap: 'cn', color: AXIS_COLOR, fontSize: 10 },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data,
        },
      ],
    }
  }, [summary, year])

  const topRepoOption = useMemo<EChartsOption>(() => {
    const top = summary.byRepo.slice(0, 10)
    const names = top.map((r) => truncate(r.repo)).reverse()
    const values = top.map((r) => r.commits).reverse()
    return {
      tooltip: { ...TOOLTIP_STYLE },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: values,
          itemStyle: { color: '#d29922', borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [summary])

  // ---- 深挖图表（同一 events 数据源） ----
  const actions = useMemo(() => actionBreakdown(events ?? []).slice(0, 10), [events])
  const actionOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'category',
        data: actions.map((a) => a.label).reverse(),
        axisLabel: { color: '#e6edf3', fontSize: 12 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: actions.map((a) => a.count).reverse(),
          itemStyle: { color: '#a371f7', borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }),
    [actions],
  )

  const weekdayHour = useMemo(() => weekdayHourMatrix(events ?? []), [events])
  const weekdayHourOption = useMemo<EChartsOption>(() => {
    const max = Math.max(1, ...weekdayHour.flat())
    const data: [number, number, number][] = []
    weekdayHour.forEach((row, y) => row.forEach((v, x) => data.push([x, y, v])))
    return {
      tooltip: {
        ...TOOLTIP_STYLE,
        formatter: (p: unknown) => {
          const d = (p as { value: [number, number, number] }).value
          const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
          return `${days[d[1]]} ${d[0]}时：${d[2]} 次动态`
        },
      },
      grid: { left: 44, right: 12, top: 10, bottom: 44 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => `${h}`),
        axisLabel: { color: AXIS_COLOR, interval: 1, fontSize: 10 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
        name: '时',
        nameTextStyle: { color: AXIS_COLOR },
      },
      yAxis: {
        type: 'category',
        data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      visualMap: {
        min: 0,
        max,
        type: 'continuous',
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 12,
        itemHeight: 90,
        inRange: { color: ['#161b22', '#1f3a5f', '#1f6feb', '#58a6ff', '#cfe3ff'] },
        textStyle: { color: AXIS_COLOR },
      },
      series: [{ type: 'heatmap', data, label: { show: false } }],
    }
  }, [weekdayHour])

  const cumulative = useMemo(() => cumulativeCommits(events ?? []), [events])
  const cumulativeOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 48, right: 16, top: 18, bottom: 28 },
      xAxis: {
        type: 'time',
        min: `${year}-01-01`,
        max: `${year}-12-31`,
        axisLabel: { color: AXIS_COLOR, fontSize: 11, formatter: '{MMM}' },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: cumulative.map((p) => [p.date, p.cumulative]),
          areaStyle: { opacity: 0.25 },
          lineStyle: { color: '#39d353', width: 2 },
          itemStyle: { color: '#39d353' },
        },
      ],
    }),
    [cumulative, year],
  )

  const pushSizes = useMemo(() => pushSizeStats(events ?? []), [events])
  const pushOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 40, right: 12, top: 18, bottom: 30 },
      xAxis: {
        type: 'category',
        data: pushSizes.buckets.map((b) => `${b.label} 个`),
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      series: [
        {
          type: 'bar',
          data: pushSizes.buckets.map((b) => b.count),
          itemStyle: { color: '#f0883e', borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [pushSizes],
  )

  const monthlyStack = useMemo(() => repoMonthlyStack(events ?? [], year, 5), [events, year])
  const monthlyStackOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { color: AXIS_COLOR, fontSize: 11 },
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 44, right: 12, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: monthlyStack.months.map((m) => m.slice(5)),
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
        name: '月',
        nameTextStyle: { color: AXIS_COLOR },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      series: monthlyStack.series.map((s) => ({
        name: truncate(s.repo, 18),
        type: 'bar',
        stack: 'commits',
        emphasis: { focus: 'series' as const },
        data: s.data,
      })),
    }),
    [monthlyStack],
  )

  if (!snapshot) {
    return (
      <EmptyState
        title="还没有活跃度数据"
        hint={crawl.kind === 'running' ? '正在抓取，请稍候…' : '抓取完成后这里会展示年度贡献热力图。'}
      >
        {crawl.kind !== 'running' && (
          <button type="button" className="btn primary" onClick={startCrawl}>
            开始抓取
          </button>
        )}
      </EmptyState>
    )
  }

  return (
    <section className="activity-tab">
      <div className="activity-toolbar">
        <label className="activity-year-label" htmlFor="activity-year">
          年度
        </label>
        <select
          id="activity-year"
          className="input activity-year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
        {loading && <span className="muted">正在拉取 {year} 年动态…</span>}
      </div>

      {fetchError && (
        <p className="activity-error">
          拉取 {year} 年数据失败：{fetchError}
          <button type="button" className="btn" onClick={() => void fetchYear(year)}>
            重试
          </button>
        </p>
      )}

      {unavailable === 'scope' ? (
        <>
          <div className="card">
            <h3>{year} 年动态</h3>
            <ScopeGuide />
          </div>
          <div className="card chart-card">
            <h3>深度抓取（提交级分析，不依赖动态权限）</h3>
            <DeepCrawlControls />
            <DeepCrawlAnalysis />
          </div>
        </>
      ) : unavailable === 'error' ? (
        <>
          <EmptyState title={`${year} 年动态拉取失败`} hint="可回到仓库画像页点「重新抓取」重试。" />
          <div className="card chart-card">
            <h3>深度抓取（提交级分析，不依赖动态权限）</h3>
            <DeepCrawlControls />
            <DeepCrawlAnalysis />
          </div>
        </>
      ) : !events || events.length === 0 ? (
        loading ? (
          <EmptyState title={`正在拉取 ${year} 年动态…`} />
        ) : (
          <>
            <EmptyState title={`${year} 年没有动态数据`} hint="换个年份试试，或先用深度抓取做提交级分析。" />
            <div className="card chart-card">
              <h3>深度抓取（提交级分析，不依赖动态权限）</h3>
              <DeepCrawlControls />
              <DeepCrawlAnalysis />
            </div>
          </>
        )
      ) : (
        <>
          <div className="stat-grid activity-stats">
            <StatCard label={`${year} 年提交`} value={formatCount(summary.totalCommits)} />
            <StatCard label="动态事件" value={formatCount(summary.totalEvents)} />
            <StatCard label="活跃天数" value={summary.activeDays} hint="有提交的日子" />
            <StatCard
              label="最活跃仓库"
              value={summary.byRepo[0] ? truncate(summary.byRepo[0].repo, 14) : '—'}
              hint={summary.byRepo[0] ? `${formatCount(summary.byRepo[0].commits)} 次提交` : undefined}
            />
          </div>

          <div className="card chart-card">
            <h3>贡献热力图（按日提交数）</h3>
            <EChart option={heatmapOption} height={190} />
          </div>

          <div className="chart-grid">
            <div className="card chart-card">
              <h3>工作习惯（周 × 时段，本地时间）</h3>
              <EChart option={weekdayHourOption} height={280} />
            </div>
            <div className="card chart-card">
              <h3>事件类型分布（Top 10）</h3>
              {actions.length > 0 ? (
                <EChart option={actionOption} height={Math.max(160, actions.length * 28 + 40)} />
              ) : (
                <p className="muted">暂无事件。</p>
              )}
            </div>
          </div>

          <div className="card chart-card">
            <h3>年度累积提交曲线</h3>
            <EChart option={cumulativeOption} height={230} />
          </div>

          <div className="chart-grid">
            <div className="card chart-card">
              <h3>
                推送粒度（平均 {pushSizes.avg} 个提交/次 · 单次最大 {pushSizes.max}）
              </h3>
              <EChart option={pushOption} height={230} />
            </div>
            <div className="card chart-card">
              <h3>提交级时段（深度抓取）</h3>
              <DeepCrawlControls />
              <DeepCrawlAnalysis />
            </div>
          </div>

          <div className="card chart-card">
            <h3>活跃仓库月度堆叠（Top 5，提交数）</h3>
            {monthlyStack.series.length > 0 ? (
              <EChart option={monthlyStackOption} height={260} />
            ) : (
              <p className="muted">暂无数据。</p>
            )}
          </div>

          <div className="card chart-card">
            <h3>最活跃仓库 Top 10（提交数）</h3>
            <EChart
              option={topRepoOption}
              height={Math.max(160, summary.byRepo.slice(0, 10).length * 30 + 40)}
            />
          </div>
        </>
      )}
    </section>
  )
}
