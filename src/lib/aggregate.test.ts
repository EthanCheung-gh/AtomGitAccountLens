import { describe, expect, it } from 'vitest'
import type { AccountEvent, GitCodeRepo } from '../api/types'
import {
  aggregateLanguages,
  longestStreak,
  maxDailyCommits,
  peakIndex,
  repoMajorLanguage,
  repoMetrics,
  repoPath,
  summarizeEvents,
} from './aggregate'

/** 用 "owner/name" 形式的全路径构造仓库（path 拆成 namespace + 仓库名，贴近真实 API） */
function repo(partial: Partial<GitCodeRepo> & { path: string }): GitCodeRepo {
  const slash = partial.path.indexOf('/')
  const ns = slash > 0 ? partial.path.slice(0, slash) : 'a'
  const name = slash > 0 ? partial.path.slice(slash + 1) : partial.path
  return { namespace: { path: ns }, ...partial, path: name }
}

describe('repoPath', () => {
  it('优先 path_with_namespace，其次 namespace/path', () => {
    expect(repoPath(repo({ path: 'b', path_with_namespace: 'a/b' }))).toBe('a/b')
    expect(repoPath(repo({ path: 'b' }))).toBe('a/b')
  })
})

describe('repoMetrics', () => {
  const recent = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()
  const old = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString()

  it('排除仓库不计入聚合', () => {
    const repos = [
      repo({ path: 'a/r1', stargazers_count: 5, forks_count: 1, pushed_at: recent }),
      repo({ path: 'a/r2', stargazers_count: 2, private: true, pushed_at: old }),
    ]
    const m = repoMetrics(repos, ['a/r2'])
    expect(m.total).toBe(2)
    expect(m.included).toBe(1)
    expect(m.excluded).toBe(1)
    expect(m.stars).toBe(5)
    expect(m.privateCount).toBe(0)
    expect(m.activeCount).toBe(1)
    expect(m.newestPushAt).toBe(recent)
  })
})

describe('aggregateLanguages', () => {
  it('百分比加权 + 主语言仓库数 + 排除口径', () => {
    const repos = [
      repo({ path: 'a/ts-project', language: 'TypeScript' }),
      repo({ path: 'a/py-project', language: null }),
      repo({ path: 'a/css-only' }),
    ]
    const languagesByRepo = {
      'a/ts-project': { TypeScript: 80, CSS: 20 },
      'a/py-project': { Python: 100 },
      'a/css-only': { CSS: 90, HTML: 10 },
    }
    const stats = aggregateLanguages(repos, languagesByRepo, [])
    // 权重：TS 80 / Python 100 / CSS 110(20+90) / HTML 10，总 300
    const byLang = new Map(stats.map((s) => [s.language, s]))
    expect(byLang.get('TypeScript')?.repoCount).toBe(1)
    expect(byLang.get('Python')?.repoCount).toBe(1) // language 缺失时取表内最高
    expect(byLang.get('CSS')?.repoCount).toBe(1) // css-only 主语言为 CSS
    expect(byLang.get('TypeScript')?.percent).toBeCloseTo((80 / 300) * 100, 5)
    expect(stats[0].language).toBe('CSS') // 权重最大
    expect(stats.reduce((s, v) => s + v.percent, 0)).toBeCloseTo(100, 5)

    const filtered = aggregateLanguages(repos, languagesByRepo, ['a/css-only'])
    expect(filtered.find((s) => s.language === 'HTML')).toBeUndefined()
  })

  it('排除后总权重同步收缩', () => {
    const repos = [repo({ path: 'a/x' }), repo({ path: 'a/y' })]
    const langs = { 'a/x': { Go: 100 }, 'a/y': { Go: 50 } }
    const all = aggregateLanguages(repos, langs, [])
    const one = aggregateLanguages(repos, langs, ['a/y'])
    expect(all[0].percent).toBeCloseTo(100, 5)
    expect(one[0].percent).toBeCloseTo(100, 5) // 单仓库仍归一
    expect(one[0].weight).toBe(100)
  })
})

describe('repoMajorLanguage', () => {
  it('language 字段优先，缺失取表内最高', () => {
    expect(repoMajorLanguage(repo({ path: 'a/x', language: 'Rust' }), { C: 10 })).toBe('Rust')
    expect(repoMajorLanguage(repo({ path: 'a/x' }), { C: 10, Makefile: 90 })).toBe('Makefile')
    expect(repoMajorLanguage(repo({ path: 'a/x' }), undefined)).toBeNull()
  })
})

describe('summarizeEvents', () => {
  const events: AccountEvent[] = [
    { date: '2026-01-05', action: 'pushed', repoPath: 'a/r1', commitCount: 3, createdAt: '2026-01-05T10:00:00+08:00' },
    { date: '2026-01-05', action: 'issue', repoPath: 'a/r2', commitCount: 0, createdAt: '2026-01-05T23:30:00+08:00' },
    { date: '2026-03-01', action: 'pushed', repoPath: 'a/r1', commitCount: 7, createdAt: '2026-03-01T09:00:00+08:00' },
    { date: 'bad-date', action: 'x', repoPath: '', commitCount: 99, createdAt: null },
  ]

  it('汇总提交/活跃日/仓库分布，跳过非法日期', () => {
    const s = summarizeEvents(events)
    expect(s.totalCommits).toBe(10)
    expect(s.activeDays).toBe(2)
    expect(s.commitsByDate['2026-01-05']).toBe(3)
    expect(s.commitsByMonth[2]).toBe(7) // 3 月
    expect(s.byRepo[0]).toMatchObject({ repo: 'a/r1', commits: 10 })
    expect(s.firstDate).toBe('2026-01-05')
    expect(s.lastDate).toBe('2026-03-01')
  })
})

describe('longestStreak / peakIndex / maxDailyCommits', () => {
  it('跨缺口取最长连续段', () => {
    expect(longestStreak({ '2026-01-01': 1, '2026-01-02': 2, '2026-01-04': 1, '2026-01-05': 1, '2026-01-06': 1 })).toBe(3)
    expect(longestStreak({})).toBe(0)
    expect(longestStreak({ '2026-01-01': 0 })).toBe(0)
  })

  it('峰值下标与单日最高', () => {
    expect(peakIndex([0, 5, 3, 5, 1])).toBe(1)
    expect(peakIndex([0, 0])).toBe(0)
    expect(maxDailyCommits({ a: 3, b: 9, c: 0 })).toBe(9)
    expect(maxDailyCommits({})).toBe(0)
  })
})
