/**
 * 全站唯一配色源（GitCode 品牌红橙 · 近黑底）。
 *
 * 改色只改这里；`src/index.css` 的 `:root` 与之逐项对应（CSS 变量供样式使用，
 * 本文件供 ECharts option 使用）。新增颜色请先在此登记，禁止在组件里写裸色值。
 */
export const palette = {
  /** 页面底色 */
  bg: '#0a0b0d',
  /** 页面底的轻微抬升层（内嵌块、轨道） */
  bgSoft: '#0e1114',
  /** 卡片底 */
  panel: '#111317',
  /** 卡片内的第二层（轨道、代码块、tag 底） */
  panel2: '#181b21',
  /** 常规描边 */
  border: '#24282f',
  /** 强调态描边 */
  borderStrong: '#2f353d',
  /** 主文字 */
  text: '#eceff4',
  /** 次级文字 / 坐标轴 */
  muted: '#8b939f',

  /** 品牌主色（柔化橙，GitCode 红橙降饱和版） */
  accent: '#ff5c33',
  /** 品牌辅助色（亮橙，用于渐变第二档、强调标签） */
  accent2: '#ff997c',
  /** 品牌浅色（文字/描边在深底上的浅橙） */
  accent3: '#ffc9a3',
  /** 主色 14% 透明，用于选中态底、tag 底 */
  accentSoft: 'rgba(255, 92, 51, 0.14)',
  /** 主色 42% 透明，用于强调描边 */
  accentLine: 'rgba(255, 92, 51, 0.42)',

  /** 增长/成功 */
  up: '#3fb950',
  /** 提示/金 */
  warn: '#e3b341',
  /** 危险/错误 */
  danger: '#f85149',
  /** 冷色补充（语言、分类区分） */
  blue: '#5aa9ff',
  cyan: '#39c5cf',
  purple: '#d2a8ff',
} as const

/** 图表通用件：一次定义，所有 ECharts option 复用 */
export const chart = {
  axis: palette.muted,
  split: '#1d2127',
  label: palette.text,
  /** tooltip 外观，配合 `{...chart.tooltip}` 使用 */
  tooltip: {
    backgroundColor: '#171a20',
    borderColor: palette.borderStrong,
    textStyle: { color: palette.text },
  },
  /** 主序列色板：橙 → 蓝 → 青 → 紫 → 金 → 绿 */
  series: [
    palette.accent,
    palette.blue,
    palette.cyan,
    palette.purple,
    palette.warn,
    palette.up,
    palette.accent2,
    palette.accent3,
  ] as string[],
  /** 红橙单色热力阶（贡献图、7×24 习惯图统一口径） */
  scale: [palette.panel2, '#4a2418', '#7d3319', '#b8451f', palette.accent, palette.accent3] as string[],
} as const

/**
 * ECharts 全局主题（在 EChart 封装里 registerTheme 一次）。
 * 作用：任何未显式指定颜色的系列/坐标轴/tooltip 都自动落进品牌色板，
 * 避免逐个图表写裸色值，也避免 ECharts 默认彩盘混进页面。
 */
export const echartsTheme = {
  color: chart.series,
  backgroundColor: 'transparent',
  textStyle: { color: palette.text, fontSize: 11 },
  title: { textStyle: { color: palette.text } },
  legend: {
    textStyle: { color: palette.muted },
    inactiveColor: palette.borderStrong,
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: chart.split } },
    axisTick: { lineStyle: { color: chart.split } },
    axisLabel: { color: chart.axis },
    splitLine: { show: false, lineStyle: { color: chart.split } },
  },
  valueAxis: {
    axisLine: { show: false, lineStyle: { color: chart.split } },
    axisTick: { show: false, lineStyle: { color: chart.split } },
    axisLabel: { color: chart.axis },
    splitLine: { lineStyle: { color: chart.split } },
  },
  tooltip: {
    backgroundColor: '#171a20',
    borderColor: palette.borderStrong,
    borderWidth: 1,
    textStyle: { color: palette.text, fontSize: 11 },
    axisPointer: { lineStyle: { color: chart.split }, crossStyle: { color: chart.split } },
  },
  visualMap: { textStyle: { color: palette.muted } },
}
