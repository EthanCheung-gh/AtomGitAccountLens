import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from './EChart'
import { useAppStore } from '../state/AppStore'
import { commitHourHistogram, deepCommitMeta } from '../lib/aggregate'
import { formatCount, formatDate } from '../lib/format'
import { chart, palette } from '../theme'

/** 提交级分析结果：样本 > 0 时渲染小时直方图与元信息，否则不渲染 */
export default function DeepCrawlAnalysis() {
  const { snapshot } = useAppStore()
  const meta = useMemo(() => deepCommitMeta(snapshot?.commitsRecentByRepo), [snapshot])
  const hist = useMemo(
    () => commitHourHistogram(snapshot?.commitsRecentByRepo),
    [snapshot],
  )

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        ...chart.tooltip,
        trigger: 'axis',
      },
      grid: { left: 40, right: 12, top: 18, bottom: 26 },
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
          data: hist,
          itemStyle: { color: palette.accent, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [hist],
  )

  if (meta.total === 0) return null

  return (
    <>
      <EChart option={option} height={230} />
      <p className="muted">
        {formatCount(meta.total)} 条提交样本 · 覆盖 {meta.repos} 个仓库 · 范围{' '}
        {formatDate(meta.first)} — {formatDate(meta.last)}。按提交作者时间（比推送时间更精确），
        每仓库最近 100 条。
      </p>
    </>
  )
}
