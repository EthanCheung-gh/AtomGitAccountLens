import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { echartsTheme } from '../theme'

interface EChartProps {
  option: EChartsOption
  height?: number
}

const THEME_NAME = 'agl-dark'

/** 注册一次全局主题：未显式着色的系列自动使用品牌色板 */
echarts.registerTheme(THEME_NAME, echartsTheme)

/** ECharts React 封装：init/resize/dispose + notMerge 更新 */
export default function EChart({ option, height = 300 }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el, THEME_NAME)
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={containerRef} style={{ height, width: '100%' }} />
}
