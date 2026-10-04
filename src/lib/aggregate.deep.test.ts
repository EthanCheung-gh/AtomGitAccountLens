import { describe, expect, it } from 'vitest'
import type { AccountEvent, DeepCommitLite, GitCodeRepo } from '../api/types'
import {
  actionBreakdown,
  actionLabel,
  commitHourHistogram,
  cumulativeCommits,
  deepCommitCount,
  deepCommitMeta,
  languageStarWeighted,
  longestGapDays,
  namespaceStats,
  pushSizeStats,
  repoCreationTimeline,
  repoFreshness,
  repoMonthlyStack,
  topStargazed,
  weekdayHourMatrix,
} from './aggregate'

function repo(partial: Partial<GitCodeRepo> & { path: string }): GitCodeRepo {
  const slash = partial.path.indexOf('/')
  const ns = slash > 0 ? partial.path.slice(0, slash) : 'a'
  const name = slash > 0 ? partial.path.slice(slash + 1) : partial.path
  return { namespace: { path: ns }, ...partial, path: name }
}

function ev(partial: Partial<AccountEvent> & { date: string }): AccountEvent {
  return { action: 'pushed', repoPath: 'a/r', commitCount: 0, createdAt: null, ...partial }
}

describe('actionBreakdown / actionLabel', () => {
  it('按次数降序并给出中文标签，未收录原样返回', () => {
    const stats = actionBreakdown([
      ev({ date: '2026-01-01', action: 'pushed' }),
      ev({ date: '2026-01-02', action: 'pushed' }),
      ev({ date: '2026-01-03', action: 'starred' }),
      ev({ date: '2026-01-04', action: 'weird_action' }),
    ])
    expect(stats[0]).toMatchObject({ action: 'pushed', label: '推送', count: 2 })
    expect(stats[1]).toMatchObject({ action: 'starred', label: '加星' })
    expect(stats[2]).toMatchObject({ label: 'weird_action', count: 1 })
    expect(actionLabel('pushed')).toBe('推送')
  })
})

describe('weekdayHourMatrix', () => {
  it('周一行=0、周日行=6，按 createdAt 计小时', () => {
    // 2026-01-05 是周一，10 点
    const m = weekdayHourMatrix([
      ev({ date: '2026-01-05', createdAt: '2026-01-05T10:00:00+08:00' }),
      ev({ date: '2026-01-05', createdAt: '2026-01-05T10:30:00+08:00' }),
      ev({ date: '2026-01-11', createdAt: '2026-01-11T23:00:00+08:00' }), // 周日
      ev({ date: '2026-01-06', createdAt: null }),
    ])
    expect(m[0][10]).toBe(2)
    expect(m[6][23]).toBe(1)
    expect(m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0)).toBe(3)
  })
})

describe('cumulativeCommits', () => {
  it('按日累积', () => {
    const pts = cumulativeCommits([
      ev({ date: '2026-01-02', commitCount: 3 }),
      ev({ date: '2026-01-01', commitCount: 2 }),
      ev({ date: '2026-01-02', commitCount: 1 }),
      ev({ date: 'bad', commitCount: 9 }),
    ])
    expect(pts).toEqual([
      { date: '2026-01-01', cumulative: 2 },
      { date: '2026-01-02', cumulative: 6 },
    ])
  })
})

describe('pushSizeStats', () => {
  it('分桶与均值', () => {
    const s = pushSizeStats([
      ev({ date: 'd1', commitCount: 1 }),
      ev({ date: 'd2', commitCount: 3 }),
      ev({ date: 'd3', commitCount: 12 }),
      ev({ date: 'd4', commitCount: 0 }), // 非 push
    ])
    expect(s.pushes).toBe(3)
    expect(s.avg).toBeCloseTo(5.3, 5)
    expect(s.max).toBe(12)
    expect(s.buckets.map((b) => b.count)).toEqual([1, 1, 0, 0, 1])
  })
})

describe('longestGapDays', () => {
  it('相邻活跃日间隔-1 取最大', () => {
    expect(
      longestGapDays({
        '2026-01-01': 1,
        '2026-01-02': 1,
        '2026-01-10': 1, // 7 天空窗
        '2026-01-11': 1,
        '2026-01-12': 1,
      }),
    ).toBe(7)
    expect(longestGapDays({})).toBe(0)
  })
})

describe('repoCreationTimeline', () => {
  it('按创建月计数并补零月', () => {
    const tl = repoCreationTimeline(
      [
        repo({ path: 'a/r1', created_at: '2024-01-15T00:00:00Z' }),
        repo({ path: 'a/r2', created_at: '2024-03-01T00:00:00Z' }),
        repo({ path: 'a/r3', created_at: '2024-03-20T00:00:00Z' }),
        repo({ path: 'a/skip', created_at: '2024-03-20T00:00:00Z' }),
      ],
      ['a/skip'],
    )
    expect(tl.map((m) => `${m.month}:${m.count}`)).toEqual([
      '2024-01:1',
      '2024-02:0',
      '2024-03:2',
    ])
  })
})

describe('repoFreshness', () => {
  it('按距今天数分桶', () => {
    const now = Date.UTC(2026, 0, 1)
    const day = 86_400_000
    const f = repoFreshness(
      [
        repo({ path: 'a/hot', pushed_at: new Date(now - 5 * day).toISOString() }),
        repo({ path: 'a/warm', pushed_at: new Date(now - 100 * day).toISOString() }),
        repo({ path: 'a/cool', pushed_at: new Date(now - 300 * day).toISOString() }),
        repo({ path: 'a/dead', pushed_at: new Date(now - 500 * day).toISOString() }),
        repo({ path: 'a/ex', pushed_at: new Date(now - 500 * day).toISOString() }),
      ],
      ['a/ex'],
      now,
    )
    expect(f).toEqual({ within30: 1, within180: 1, within365: 1, dormant: 1 })
  })
})

describe('topStargazed', () => {
  it('降序且 0 star 不入榜', () => {
    const top = topStargazed(
      [
        repo({ path: 'a/x', stargazers_count: 3 }),
        repo({ path: 'a/y', stargazers_count: 10 }),
        repo({ path: 'a/z', stargazers_count: 0 }),
      ],
      [],
      2,
    )
    expect(top.map((t) => t.path)).toEqual(['a/y', 'a/x'])
  })
})

describe('languageStarWeighted', () => {
  it('Star 因子加权，零星仓库至少计 1', () => {
    const repos = [
      repo({ path: 'a/popular', stargazers_count: 100 }), // TS 权重 80*100
      repo({ path: 'a/small', stargazers_count: 0 }), // Go 权重 100*1
    ]
    const langs = { 'a/popular': { TypeScript: 80 }, 'a/small': { Go: 100 } }
    const stats = languageStarWeighted(repos, langs, [])
    expect(stats[0].language).toBe('TypeScript')
    expect(stats[0].percent).toBeCloseTo((8000 / 8100) * 100, 5)
    expect(stats[1].percent).toBeCloseTo((100 / 8100) * 100, 5)
  })
})

describe('namespaceStats', () => {
  it('按 owner 分组仓库/Star/提交', () => {
    const repos = [
      repo({ path: 'me/r1', stargazers_count: 2 }),
      repo({ path: 'me/r2' }),
      repo({ path: 'org/r3', stargazers_count: 5 }),
    ]
    const events = [
      ev({ date: 'd', repoPath: 'me/r1', commitCount: 4 }),
      ev({ date: 'd', repoPath: 'org/r3', commitCount: 1 }),
      ev({ date: 'd', repoPath: 'me/r9', commitCount: 7 }), // 事件可来自已排除仓库
    ]
    const stats = namespaceStats(repos, events, [])
    const byNs = new Map(stats.map((s) => [s.ns, s]))
    expect(byNs.get('me')).toEqual({ ns: 'me', repos: 2, stars: 2, commits: 11 })
    expect(byNs.get('org')).toEqual({ ns: 'org', repos: 1, stars: 5, commits: 1 })
  })
})

describe('repoMonthlyStack', () => {
  it('当年 12 个月，Top 仓库堆叠', () => {
    const stack = repoMonthlyStack(
      [
        ev({ date: '2026-01-05', repoPath: 'a/r1', commitCount: 2 }),
        ev({ date: '2026-03-05', repoPath: 'a/r1', commitCount: 3 }),
        ev({ date: '2026-03-06', repoPath: 'a/r2', commitCount: 1 }),
        ev({ date: '2025-12-31', repoPath: 'a/r1', commitCount: 99 }), // 非当年
      ],
      2026,
      5,
    )
    expect(stack.months).toHaveLength(12)
    expect(stack.series[0]).toMatchObject({ repo: 'a/r1' })
    expect(stack.series[0].data[0]).toBe(2)
    expect(stack.series[0].data[2]).toBe(3)
    expect(stack.series[0].data.reduce((s, v) => s + v, 0)).toBe(5)
    expect(stack.series[1].data.reduce((s, v) => s + v, 0)).toBe(1)
  })
})

describe('deep commits helpers', () => {
  const commits: Record<string, DeepCommitLite[]> = {
    'a/r1': [
      { sha: 'abc1234', date: '2026-02-03T09:00:00+08:00', message: 'x' },
      { sha: 'def5678', date: '2026-02-04T23:00:00+08:00', message: 'y' },
    ],
    'a/r2': [{ sha: 'fff0000', date: '2026-02-05T09:30:00+08:00', message: 'z' }],
  }

  it('小时直方图与总数', () => {
    const hist = commitHourHistogram(commits)
    expect(hist[9]).toBe(2)
    expect(hist[23]).toBe(1)
    expect(hist.reduce((s, v) => s + v, 0)).toBe(3)
    expect(deepCommitCount(commits)).toBe(3)
    expect(deepCommitCount(undefined)).toBe(0)
  })

  it('元信息：只计非空仓库，取最早/最晚作者时间', () => {
    const withEmpty: Record<string, DeepCommitLite[]> = {
      ...commits,
      'a/empty-repo': [], // 空仓库不计入覆盖数
    }
    const meta = deepCommitMeta(withEmpty)
    expect(meta).toEqual({
      total: 3,
      repos: 2,
      first: '2026-02-03T09:00:00+08:00',
      last: '2026-02-05T09:30:00+08:00',
    })
    expect(deepCommitMeta(undefined)).toEqual({ total: 0, repos: 0, first: null, last: null })
  })
})
