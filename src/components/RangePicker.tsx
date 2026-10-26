import { useMemo } from 'react'
import {
  RANGE_PRESETS,
  formatRangeLabel,
  missingYears,
  presetRange,
  toDateKey,
  yearStatuses,
} from '../lib/range'
import type { RangePresetKey } from '../lib/range'
import { useAppStore } from '../state/AppStore'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const STATUS_LABEL: Record<string, string> = {
  empty: '平台返回 0 条',
  scope: '无 read_user 权限',
  error: '抓取失败',
  missing: '未抓取',
}

/**
 * 时间区间选择器：任意起止日期 + 快捷预设。
 * 区间覆盖的年份若未抓取，由 store 自动补抓并在下方显示进度。
 */
export default function RangePicker() {
  const { range, setRange, snapshot, backfill, refreshRange, probe, probeEvents } =
    useAppStore()

  /** 「全部」的左端：账号创建日与已抓到的最早事件取较小者 */
  const earliest = useMemo(() => {
    if (!snapshot) return null
    const created = snapshot.user.created_at?.slice(0, 10) ?? null
    let min: string | null = created && DATE_RE.test(created) ? created : null
    for (const list of Object.values(snapshot.eventsByYear)) {
      for (const e of list) {
        if (!min || e.date < min) min = e.date
      }
    }
    return min
  }, [snapshot])

  const today = toDateKey(new Date())

  const statuses = useMemo(
    () => yearStatuses(range, snapshot?.eventsByYear, snapshot?.eventsUnavailable),
    [range, snapshot],
  )
  /** 有异常年份时才展开诊断明细（正常情况不占版面） */
  const problems = statuses.filter((st) => st.kind !== 'ready')

  const missing = useMemo(
    () => missingYears(range, snapshot?.eventsByYear, snapshot?.eventsUnavailable),
    [range, snapshot],
  )

  const scopeBlocked = useMemo(() => {
    const years: number[] = []
    for (const [key, kind] of Object.entries(snapshot?.eventsUnavailable ?? {})) {
      if (kind === 'scope' && `${key}-12-31` >= range.start && `${key}-01-01` <= range.end) {
        years.push(Number(key))
      }
    }
    return years.sort((a, b) => a - b)
  }, [snapshot, range])

  const applyPreset = (key: RangePresetKey) => {
    setRange(presetRange(key, { earliest }))
  }

  const activePreset = RANGE_PRESETS.find((p) => {
    const candidate = presetRange(p.key, { earliest })
    return candidate.start === range.start && candidate.end === range.end
  })?.key

  const setStart = (value: string) => {
    if (!DATE_RE.test(value)) return
    // 起点越过终点时把终点一起推过去，避免出现空区间
    setRange({ start: value, end: value > range.end ? value : range.end })
  }

  const setEnd = (value: string) => {
    if (!DATE_RE.test(value)) return
    setRange({ start: value < range.start ? value : range.start, end: value })
  }

  return (
    <div className="range-picker">
      <div className="range-row">
        <div className="range-inputs">
          <input
            type="date"
            className="range-date"
            lang="zh-CN"
            aria-label="开始日期"
            value={range.start}
            max={range.end}
            onChange={(e) => setStart(e.target.value)}
          />
          <span className="range-tilde">~</span>
          <input
            type="date"
            className="range-date"
            lang="zh-CN"
            aria-label="结束日期"
            value={range.end}
            min={range.start}
            max={today}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="range-presets">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`range-chip ${activePreset === p.key ? 'active' : ''}`}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="range-note">
        统计区间 <strong>{formatRangeLabel(range)}</strong>
        {backfill && backfill.current !== null && (
          <span className="range-busy">
            · 正在补抓 {backfill.current} 年动态（{backfill.done + 1}/{backfill.years.length}）…
          </span>
        )}
        {backfill?.error && <span className="range-error">· {backfill.error}</span>}
        {missing.length > 0 && !backfill && (
          <span className="range-missing">· 待补抓 {missing.join('、')} 年</span>
        )}
        {scopeBlocked.length > 0 && (
          <span className="range-error">
            · 令牌缺少 read_user 权限，{scopeBlocked.join('、')} 年动态不可用
          </span>
        )}
      </p>

      {problems.length > 0 && (
        <div className="range-diag">
          <span className="range-diag-years">
            {statuses.map((st) => (
              <span key={st.year} className={`range-year ${st.kind}`}>
                {st.year}
                {st.kind === 'ready' ? ` · ${(st as { count: number }).count} 条` : ''}
                {st.kind !== 'ready' ? ` · ${STATUS_LABEL[st.kind]}` : ''}
              </span>
            ))}
          </span>
          <button type="button" className="btn" onClick={refreshRange}>
            重新抓取区间
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void probeEvents(problems[0].year)}
            title="直接请求该年 events 接口并显示原始响应结构，用来判断是平台没数据还是解析不上"
          >
            探测 {problems[0].year} 接口
          </button>
        </div>
      )}

      {probe && (
        <p className="range-probe">
          接口探测（{probe.year} 年）：{probe.summary}
        </p>
      )}
    </div>
  )
}
