import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { useAppStore } from '../state/AppStore'
import {
  commitHourHistogram,
  commitMonthlySeries,
  commitTypeBreakdown,
  commitWeekdayHistogram,
  commitWeekdayHourMatrix,
  commitYearlySeries,
  deepCommitMeta,
  recentCommits,
  repoCommitTotals,
} from '../lib/aggregate'
import { formatCount, formatDate, formatDateTime } from '../lib/format'

const AXIS_COLOR = '#8b949e'
const SPLIT_LINE = '#21262d'
const TOOLTIP_STYLE = {
  backgroundColor: '#161b22',
  borderColor: '#30363d',
  textStyle: { color: '#e6edf3' },
}
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function truncate(name: string, max = 26): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

function heatmapOption(matrix: number[][], unit: string): EChartsOption {
  const max = Math.max(1, ...matrix.flat())
  const data: [number, number, number][] = []
  matrix.forEach((row, y) => row.forEach((v, x) => data.push([x, y, v])))
  return {
    tooltip: {
      ...TOOLTIP_STYLE,
      formatter: (p: unknown) => {
        const d = (p as { value: [number, number, number] }).value
        return `${WEEKDAYS[d[1]]} ${d[0]}时：${d[2]} ${unit}`
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
      data: WEEKDAYS,
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
}

/** 提交级深度分析：全时段提交数据的图表套件（样本 > 0 时渲染） */
export default function DeepAnalysisSection() {
  const { snapshot } = useAppStore()
  const [ownOnly, setOwnOnly] = useState(true)
  const commits = snapshot?.commitsRecentByRepo
  const login = ownOnly ? snapshot?.login : undefined

  const meta = useMemo(() => deepCommitMeta(commits), [commits])
  const hourHist = useMemo(() => commitHourHistogram(commits, login), [commits, login])
  const yearly = useMemo(() => commitYearlySeries(commits, login), [commits, login])
  const weekday = useMemo(() => commitWeekdayHistogram(commits, login), [commits, login])
  const matrix = useMemo(() => commitWeekdayHourMatrix(commits, login), [commits, login])
  const monthly = useMemo(() => commitMonthlySeries(commits, login), [commits, login])
  const types = useMemo(() => commitTypeBreakdown(commits, login).slice(0, 8), [commits, login])
  const repoTotals = useMemo(() => repoCommitTotals(commits, login).slice(0, 10), [commits, login])
  const recent = useMemo(() => recentCommits(commits, login, 15), [commits, login])

  const hourOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => `${h}时`),
        axisLabel: { color: AXIS_COLOR, interval: 2, fontSize: 11 },
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
          data: hourHist,
          itemStyle: { color: '#39c5cf', borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [hourHist],
  )

  const yearlyOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: yearly.map((y) => `${y.year}`),
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
          data: yearly.map((y) => y.count),
          itemStyle: { color: '#39d353', borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', color: AXIS_COLOR, fontSize: 10 },
        },
      ],
    }),
    [yearly],
  )

  const weekdayOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: WEEKDAYS,
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
          data: weekday,
          itemStyle: { color: '#58a6ff', borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [weekday],
  )

  const matrixOption = useMemo(() => heatmapOption(matrix, '次提交'), [matrix])

  const monthlyOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
      grid: { left: 48, right: 16, top: 18, bottom: 30 },
      xAxis: {
        type: 'time',
        axisLabel: { color: AXIS_COLOR, fontSize: 11, formatter: '{yyyy}-{MM}' },
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
          data: monthly.map((m) => [`${m.month}-01`, m.count]),
          areaStyle: { opacity: 0.25 },
          lineStyle: { color: '#d2a8ff', width: 2 },
          itemStyle: { color: '#d2a8ff' },
        },
      ],
    }),
    [monthly],
  )

  const typeOption = useMemo<EChartsOption>(() => {
    const items = types.slice(0, 8)
    return {
      tooltip: TOOLTIP_STYLE,
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        splitLine: { lineStyle: { color: SPLIT_LINE } },
      },
      yAxis: {
        type: 'category',
        data: items.map((t) => t.label).reverse(),
        axisLabel: { color: '#e6edf3', fontSize: 12 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((t) => t.count).reverse(),
          itemStyle: { color: '#f0883e', borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [types])

  const repoTotalsOption = useMemo<EChartsOption>(() => {
    const items = repoTotals.slice(0, 10)
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
        data: items.map((t) => truncate(t.repo)).reverse(),
        axisLabel: { color: AXIS_COLOR, fontSize: 11 },
        axisLine: { lineStyle: { color: SPLIT_LINE } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((t) => t.count).reverse(),
          itemStyle: { color: '#d29922', borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
        },
      ],
    }
  }, [repoTotals])

  if (meta.total === 0) return null

  return (
    <section className="deep-section">
      <div className="deep-section-head">
        <h2>提交级深度分析（全时段）</h2>
        <div className="calibre-toggle" role="group" aria-label="提交作者过滤">
          <button
            type="button"
            className={ownOnly ? 'active' : ''}
            onClick={() => setOwnOnly(true)}
          >
            仅本人提交
          </button>
          <button
            type="button"
            className={!ownOnly ? 'active' : ''}
            onClick={() => setOwnOnly(false)}
          >
            全部作者
          </button>
        </div>
      </div>
      <p className="muted deep-section-meta">
        {formatCount(meta.total)} 条提交 · 覆盖 {meta.repos} 个仓库 · 范围{' '}
        {formatDate(meta.first)} — {formatDate(meta.last)}
        {ownOnly ? ' · 按作者登录名过滤（作者未知的提交计入本人）' : ' · 含他人提交'}
      </p>

      <div className="card chart-card">
        <h3>全时段月度提交时间线</h3>
        <EChart option={monthlyOption} height={240} />
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <h3>按年提交量</h3>
          <EChart option={yearlyOption} height={230} />
        </div>
        <div className="card chart-card">
          <h3>周内分布（作者时间）</h3>
          <EChart option={weekdayOption} height={230} />
        </div>
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <h3>提交时段（0-23 时）</h3>
          <EChart option={hourOption} height={230} />
        </div>
        <div className="card chart-card">
          <h3>提交类型分布（Conventional Commits 解析）</h3>
          {types.length > 0 ? (
            <EChart option={typeOption} height={Math.max(160, types.length * 28 + 50)} />
          ) : (
            <p className="muted">暂无数据。</p>
          )}
        </div>
      </div>

      <div className="card chart-card">
        <h3>提交工作习惯（周 × 时段，作者时间）</h3>
        <EChart option={matrixOption} height={280} />
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <h3>每仓库提交数 Top 10（全时段口径）</h3>
          <EChart
            option={repoTotalsOption}
            height={Math.max(160, repoTotals.length * 28 + 50)}
          />
        </div>
        <div className="card chart-card">
          <h3>最近提交样本（Top 15）</h3>
          <ul className="commit-list">
            {recent.map((r) => (
              <li key={`${r.repo}/${r.sha}`} className="commit-row">
                <span className="commit-msg" title={r.message}>
                  {r.message || '(无提交信息)'}
                </span>
                <span className="commit-meta muted">
                  <span className="commit-sha">{r.sha}</span>
                  {truncate(r.repo, 24)} · {formatDateTime(r.date)}
                  {r.author && !ownOnly ? ` · @${r.author}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
