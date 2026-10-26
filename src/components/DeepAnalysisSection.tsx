import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import DeepCrawlControls from './DeepCrawlControls'
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
import { formatRangeLabel, inRange } from '../lib/range'
import { chart, palette } from '../theme'

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
      ...chart.tooltip,
      formatter: (p: unknown) => {
        const d = (p as { value: [number, number, number] }).value
        return `${WEEKDAYS[d[1]]} ${d[0]}时：${d[2]} ${unit}`
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
      data: WEEKDAYS,
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
}

/** 提交级深度分析：提交样本按当前时间区间过滤后的图表套件（样本 > 0 时渲染） */
export default function DeepAnalysisSection() {
  const { snapshot, range } = useAppStore()
  const [ownOnly, setOwnOnly] = useState(true)
  const raw = snapshot?.commitsRecentByRepo
  /**
   * 按区间裁剪提交样本。深度抓取本身是全时段的，这里只是按页面区间切片，
   * 抓到的原始数据不动，切回大区间立刻还原。
   */
  const commits = useMemo(() => {
    if (!raw) return undefined
    const out: Record<string, typeof raw[string]> = {}
    for (const [repo, list] of Object.entries(raw)) {
      const kept = list.filter((c) => inRange(c.date, range))
      if (kept.length > 0) out[repo] = kept
    }
    return out
  }, [raw, range])
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
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => `${h}时`),
        axisLabel: { color: chart.axis, interval: 2, fontSize: 11 },
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
          data: hourHist,
          itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [hourHist],
  )

  const yearlyOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: yearly.map((y) => `${y.year}`),
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
          data: yearly.map((y) => y.count),
          itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', color: chart.axis, fontSize: 10 },
        },
      ],
    }),
    [yearly],
  )

  const weekdayOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: {
        type: 'category',
        data: WEEKDAYS,
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
          data: weekday,
          itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [weekday],
  )

  const matrixOption = useMemo(() => heatmapOption(matrix, '次提交'), [matrix])

  const monthlyOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { ...chart.tooltip, trigger: 'axis' },
      grid: { left: 48, right: 16, top: 18, bottom: 30 },
      xAxis: {
        type: 'time',
        axisLabel: { color: chart.axis, fontSize: 11, formatter: '{yyyy}-{MM}' },
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
          data: monthly.map((m) => [`${m.month}-01`, m.count]),
          areaStyle: { opacity: 0.25 },
          lineStyle: { color: palette.accent, width: 2 },
          itemStyle: { color: palette.accent },
        },
      ],
    }),
    [monthly],
  )

  const typeOption = useMemo<EChartsOption>(() => {
    const items = types.slice(0, 8)
    return {
      tooltip: chart.tooltip,
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
      },
      yAxis: {
        type: 'category',
        data: items.map((t) => t.label).reverse(),
        axisLabel: { color: chart.label, fontSize: 12 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((t) => t.count).reverse(),
          itemStyle: { color: palette.accent, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: chart.axis, fontSize: 11 },
        },
      ],
    }
  }, [types])

  const repoTotalsOption = useMemo<EChartsOption>(() => {
    const items = repoTotals.slice(0, 10)
    return {
      tooltip: chart.tooltip,
      grid: { left: 8, right: 44, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: chart.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: chart.split } },
      },
      yAxis: {
        type: 'category',
        data: items.map((t) => truncate(t.repo)).reverse(),
        axisLabel: { color: chart.axis, fontSize: 11 },
        axisLine: { lineStyle: { color: chart.split } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: items.map((t) => t.count).reverse(),
          itemStyle: { color: palette.accent, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: chart.axis, fontSize: 11 },
        },
      ],
    }
  }, [repoTotals])

  if (meta.total === 0) return null

  return (
    <section className="deep-section">
      <div className="deep-section-head">
        <h2>提交级深度分析（{formatRangeLabel(range)}）</h2>
        <div className="deep-head-actions">
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
          <DeepCrawlControls />
        </div>
      </div>
      <p className="muted deep-section-meta">
        {formatCount(meta.total)} 条提交 · 覆盖 {meta.repos} 个仓库 · 范围{' '}
        {formatDate(meta.first)} — {formatDate(meta.last)}
        {ownOnly ? ' · 按作者登录名过滤（作者未知的提交计入本人）' : ' · 含他人提交'}
      </p>

      <div className="card chart-card">
        <h3>月度提交时间线</h3>
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
          <h3>每仓库提交数 Top 10</h3>
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
