import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import DeepAnalysisSection from '../components/DeepAnalysisSection'
import DeepCrawlControls from '../components/DeepCrawlControls'
import EChart from '../components/EChart'
import EmptyState from '../components/EmptyState'
import RangePicker from '../components/RangePicker'
import ScopeGuide from '../components/ScopeGuide'
import StatCard from '../components/StatCard'
import { useAppStore } from '../state/AppStore'
import {
  actionBreakdown,
  cumulativeCommits,
  monthKeysInRange,
  pushSizeStats,
  repoMonthlyStackForMonths,
  summarizeEvents,
  weekdayHourMatrix,
} from '../lib/aggregate'
import { formatRangeLabel, rangeYears } from '../lib/range'
import { collectEvents } from '../lib/range'
import { formatCount } from '../lib/format'
import { chart, palette } from '../theme'


/** 取 owner/repo 里的 repo 段（KPI 卡里不需要 owner 前缀） */
function shortRepo(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function truncate(name: string, max = 26): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

export default function ActivityTab() {
  const { snapshot, crawl, startCrawl, range, backfill } = useAppStore()

  const rangeLabel = formatRangeLabel(range)
  const events = useMemo(() => collectEvents(snapshot?.eventsByYear, range), [snapshot, range])
  const loading = backfill !== null && backfill.current !== null
  const fetchError = backfill?.error ?? null
  /** 区间覆盖的年份全都因权限不可用 */
  const allScopeBlocked = useMemo(() => {
    const years = rangeYears(range)
    if (years.length === 0 || !snapshot) return false
    return (
      events.length === 0 &&
      years.every((y) => snapshot.eventsUnavailable?.[String(y)] === 'scope')
    )
  }, [range, snapshot, events.length])

  // 所有 hooks 必须在条件 return 之前（React 规则）
  const summary = useMemo(() => summarizeEvents(events), [events])

  const heatmapOption = useMemo<EChartsOption>(() => {
    const data = Object.entries(summary.commitsByDate).map(([date, count]) => [date, count])
    const maxDaily = data.reduce((m, d) => Math.max(m, d[1] as number), 0)
    return {
      tooltip: {
        ...chart.tooltip,
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
          color: chart.scale,
        },
        textStyle: { color: chart.axis },
      },
      calendar: {
        range: [range.start, range.end],
        cellSize: ['auto', 14],
        left: 44,
        right: 16,
        top: 44,
        bottom: 4,
        itemStyle: {
          color: palette.bg,
          borderColor: palette.panel2,
          borderWidth: 2,
        },
        splitLine: { show: false },
        yearLabel: { show: false },
        monthLabel: { nameMap: 'cn', color: chart.axis, fontSize: 11 },
        dayLabel: { nameMap: 'cn', color: chart.axis, fontSize: 10 },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data,
        },
      ],
    }
  }, [summary, range.start, range.end])

  const topRepoOption = useMemo<EChartsOption>(() => {
    const top = summary.byRepo.slice(0, 10)
    const names = top.map((r) => truncate(r.repo)).reverse()
    const values = top.map((r) => r.commits).reverse()
    return {
      tooltip: { ...chart.tooltip },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: { color: chart.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: values,
          itemStyle: { color: palette.accent, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: chart.axis, fontSize: 11 },
        },
      ],
    }
  }, [summary])

  // ---- 深挖图表（同一 events 数据源） ----
  const actions = useMemo(() => actionBreakdown(events ?? []).slice(0, 10), [events])
  const actionOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
      },
      yAxis: {
        type: 'category',
        data: actions.map((a) => a.label).reverse(),
        axisLabel: { color: chart.label, fontSize: 12 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: actions.map((a) => a.count).reverse(),
          itemStyle: { color: palette.accent, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: chart.axis, fontSize: 11 },
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
        ...chart.tooltip,
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
        axisLabel: { color: chart.axis, interval: 1, fontSize: 10 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
        name: '时',
        nameTextStyle: { color: chart.axis },
      },
      yAxis: {
        type: 'category',
        data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
        axisLabel: { color: chart.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: chart.split } },
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
        inRange: { color: chart.scale },
        textStyle: { color: chart.axis },
      },
      series: [{ type: 'heatmap', data, label: { show: false } }],
    }
  }, [weekdayHour])

  const cumulative = useMemo(() => cumulativeCommits(events ?? []), [events])
  const spanDays = useMemo(() => {
    const a = new Date(`${range.start}T00:00:00`).getTime()
    const b = new Date(`${range.end}T00:00:00`).getTime()
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86400000)) : 0
  }, [range.start, range.end])

  const cumulativeOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      grid: { left: 48, right: 16, top: 18, bottom: 28 },
      xAxis: {
        type: 'time',
        min: range.start,
        max: range.end,
        axisLabel: {
          color: chart.axis,
          fontSize: 11,
          formatter: (value: number) => {
            const d = new Date(value)
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            return spanDays > 90 ? ym : `${d.getMonth() + 1}/${d.getDate()}`
          },
        },
        axisLine: { lineStyle: { color: chart.split } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: cumulative.map((p) => [p.date, p.cumulative]),
          areaStyle: { opacity: 0.25 },
          lineStyle: { color: palette.accent, width: 2 },
          itemStyle: { color: palette.accent },
        },
      ],
    }),
    [cumulative, range.start, range.end],
  )

  const pushSizes = useMemo(() => pushSizeStats(events ?? []), [events])
  const pushOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      grid: { left: 40, right: 12, top: 18, bottom: 30 },
      xAxis: {
        type: 'category',
        data: pushSizes.buckets.map((b) => `${b.label} 个`),
        axisLabel: { color: chart.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
      },
      series: [
        {
          type: 'bar',
          data: pushSizes.buckets.map((b) => b.count),
          itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [pushSizes],
  )

  const monthKeys = useMemo(() => monthKeysInRange(range), [range])
  const monthAxisCrossYear = new Set(monthKeys.map((m) => m.slice(0, 4))).size > 1
  const monthlyStack = useMemo(
    () => repoMonthlyStackForMonths(events, monthKeys, 5),
    [events, monthKeys],
  )
  const monthlyStackOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { color: chart.axis, fontSize: 11 },
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 44, right: 12, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: monthlyStack.months.map((m) =>
          monthAxisCrossYear ? `${m.slice(2, 4)}-${m.slice(5)}` : m.slice(5),
        ),
        axisLabel: { color: chart.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
        name: '月',
        nameTextStyle: { color: chart.axis },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
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
        hint={crawl.kind === 'running' ? '正在抓取，请稍候…' : '抓取完成后这里会展示区间贡献热力图。'}
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
        <RangePicker />
      </div>

      {fetchError && (
        <p className="activity-error">
          补抓区间数据失败：{fetchError}
          <button type="button" className="btn" onClick={startCrawl}>
            重新抓取全部
          </button>
        </p>
      )}

      {allScopeBlocked ? (
        <>
          <div className="card">
            <h3>{rangeLabel}动态</h3>
            <ScopeGuide />
          </div>
          <div className="card chart-card">
            <h3>深度抓取（提交级数据，不依赖动态权限）</h3>
            <DeepCrawlControls />
          </div>
        </>
      ) : fetchError ? (
        <>
          <EmptyState title="区间动态抓取失败" hint="可回到仓库画像页点「重新抓取」重试。" />
          <div className="card chart-card">
            <h3>深度抓取（提交级数据，不依赖动态权限）</h3>
            <DeepCrawlControls />
          </div>
        </>
      ) : !events || events.length === 0 ? (
        loading ? (
          <EmptyState title={`正在补抓 ${backfill?.current ?? ''} 年动态…`} />
        ) : (
          <>
            <EmptyState
              title={`${rangeLabel}没有动态数据`}
              hint="换个区间试试，或先用深度抓取做提交级分析。"
            />
            <div className="card chart-card">
              <h3>深度抓取（提交级数据，不依赖动态权限）</h3>
              <DeepCrawlControls />
            </div>
          </>
        )
      ) : (
        <>
          <div className="stat-grid activity-stats">
            <StatCard label="区间提交" value={formatCount(summary.totalCommits)} />
            <StatCard label="动态事件" value={formatCount(summary.totalEvents)} />
            <StatCard label="活跃天数" value={summary.activeDays} hint="有提交的日子" />
            <StatCard
              label="最活跃仓库"
              value={summary.byRepo[0] ? truncate(shortRepo(summary.byRepo[0].repo), 16) : '—'}
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
            <h3>累积提交曲线</h3>
            <EChart option={cumulativeOption} height={230} />
          </div>

          <div className="chart-grid">
            <div className="card chart-card">
              <h3>
                推送粒度（平均 {pushSizes.avg} 个提交/次 · 单次最大 {pushSizes.max}）
              </h3>
              <EChart option={pushOption} height={230} />
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

      <DeepAnalysisSection />
    </section>
  )
}
