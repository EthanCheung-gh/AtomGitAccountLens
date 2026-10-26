import { describe, expect, it } from 'vitest'
import {
  collectCommits,
  collectEvents,
  formatRangeLabel,
  inRange,
  isFullYear,
  missingYears,
  presetRange,
  rangeYears,
  toDateKey,
  yearStatuses,
} from './range'
import type { AccountEvent, DeepCommitLite } from '../api/types'

const TODAY = new Date(2026, 9, 26) // 2026-10-26（本地时间）

describe('toDateKey', () => {
  it('用本地时间格式化，不因 UTC 偏移跳日期', () => {
    expect(toDateKey(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('presetRange', () => {
  it('最近 7 / 30 / 90 天都包含今天', () => {
    expect(presetRange('7d', { today: TODAY })).toEqual({ start: '2026-10-20', end: '2026-10-26' })
    expect(presetRange('30d', { today: TODAY }).start).toBe('2026-09-27')
    expect(presetRange('90d', { today: TODAY }).end).toBe('2026-10-26')
  })

  it('最近 12 个月跨年且含今天', () => {
    const r = presetRange('12m', { today: TODAY })
    expect(r).toEqual({ start: '2025-10-27', end: '2026-10-26' })
    expect(rangeYears(r)).toEqual([2025, 2026])
  })

  it('本季度从季度首日开始', () => {
    expect(presetRange('quarter', { today: TODAY })).toEqual({
      start: '2026-10-01',
      end: '2026-10-26',
    })
    expect(presetRange('quarter', { today: new Date(2026, 4, 9) }).start).toBe('2026-04-01')
  })

  it('今年 / 全部', () => {
    expect(presetRange('year', { today: TODAY })).toEqual({
      start: '2026-01-01',
      end: '2026-10-26',
    })
    expect(presetRange('all', { today: TODAY, earliest: '2019-04-08' })).toEqual({
      start: '2019-04-08',
      end: '2026-10-26',
    })
    // 无最早日期时退化为当天单点，避免出现 1970 这种假区间
    expect(presetRange('all', { today: TODAY })).toEqual({ start: '2026-10-26', end: '2026-10-26' })
  })
})

describe('区间判定与文案', () => {
  it('rangeYears 覆盖跨年年份', () => {
    expect(rangeYears({ start: '2024-12-31', end: '2026-01-01' })).toEqual([2024, 2025, 2026])
  })

  it('isFullYear 只认整自然年', () => {
    expect(isFullYear({ start: '2025-01-01', end: '2025-12-31' })).toBe(2025)
    expect(isFullYear({ start: '2025-01-01', end: '2025-12-30' })).toBeNull()
  })

  it('formatRangeLabel：整年给年份，否则给区间', () => {
    expect(formatRangeLabel({ start: '2025-01-01', end: '2025-12-31' })).toBe('2025 年')
    expect(formatRangeLabel({ start: '2025-10-27', end: '2026-10-26' })).toBe(
      '2025-10-27 ~ 2026-10-26',
    )
  })

  it('inRange 是闭区间且容错带时间戳的日期', () => {
    const r = { start: '2026-01-01', end: '2026-01-31' }
    expect(inRange('2026-01-01', r)).toBe(true)
    expect(inRange('2026-01-31', r)).toBe(true)
    expect(inRange('2026-01-31T23:59:59+08:00', r)).toBe(true)
    expect(inRange('2026-02-01', r)).toBe(false)
    expect(inRange('', r)).toBe(false)
  })
})

describe('missingYears', () => {
  const r = { start: '2024-06-01', end: '2026-10-26' }

  it('报出未抓取年份，跳过已抓与非权限年份', () => {
    expect(
      missingYears(r, { '2025': [ev('2025-03-01')] }, { '2024': 'scope' }),
    ).toEqual([2026])
  })

  it('空表也算未抓取', () => {
    expect(missingYears(r, { '2025': [] }, undefined)).toEqual([2024, 2025, 2026])
  })

  it('全部抓到时返回空', () => {
    expect(
      missingYears(
        { start: '2025-01-01', end: '2025-12-31' },
        { '2025': [ev('2025-01-02')] },
        undefined,
      ),
    ).toEqual([])
  })
})

describe('collectEvents / collectCommits', () => {
  const events = {
    '2025': [ev('2025-11-02'), ev('2025-01-01')],
    '2026': [ev('2026-03-04'), ev('2026-10-26')],
  }

  it('跨年合并后按区间过滤', () => {
    const picked = collectEvents(events, { start: '2025-10-27', end: '2026-10-26' })
    expect(picked.map((e) => e.date)).toEqual(['2025-11-02', '2026-03-04', '2026-10-26'])
  })

  it('无数据返回空数组', () => {
    expect(collectEvents(undefined, { start: '2026-01-01', end: '2026-12-31' })).toEqual([])
  })

  it('提交按区间 + 作者过滤，保留仓库名', () => {
    const commits: Record<string, DeepCommitLite[]> = {
      'me/r1': [
        { sha: 'a', date: '2026-02-01T10:00:00+08:00', message: 'm', author: 'Me' },
        { sha: 'b', date: '2026-02-02T10:00:00+08:00', message: 'm', author: 'other' },
        { sha: 'c', date: '2024-02-02T10:00:00+08:00', message: 'm' },
      ],
    }
    const r = { start: '2026-01-01', end: '2026-12-31' }
    expect(collectCommits(commits, r, 'me').map((x) => x.commit.sha)).toEqual(['a'])
    expect(collectCommits(commits, r).map((x) => x.commit.sha)).toEqual(['a', 'b'])
    expect(collectCommits(commits, r)[0].repo).toBe('me/r1')
  })
})

function ev(date: string): AccountEvent {
  return { date, action: 'push', repoPath: 'me/r1', commitCount: 1, createdAt: `${date}T10:00:00+08:00` }
}

describe('yearStatuses（区间每年诊断）', () => {
  const r = { start: '2024-06-01', end: '2026-10-26' }

  it('区分已抓 / 平台 0 条 / 无权限 / 失败 / 未抓', () => {
    const statuses = yearStatuses(
      r,
      { '2024': [ev('2024-07-01')] },
      { '2025': 'empty', '2026': 'scope' },
    )
    expect(statuses).toEqual([
      { year: 2024, kind: 'ready', count: 1 },
      { year: 2025, kind: 'empty' },
      { year: 2026, kind: 'scope' },
    ])
  })

  it('空数组视为未抓（历史遗留的空快照需要重抓）', () => {
    expect(yearStatuses(r, { '2024': [], '2025': [] }, undefined)).toEqual([
      { year: 2024, kind: 'missing' },
      { year: 2025, kind: 'missing' },
      { year: 2026, kind: 'missing' },
    ])
  })
})
