import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorMessage, normalizeDeepCommits, normalizeEventsPage } from './client'

describe('normalizeEventsPage', () => {
  it('日期键对象 + next 游标', () => {
    const raw = {
      '2026-01-01': [{ action_name: 'pushed', push_data: { commit_count: 2 } }],
      '2026-01-02': [],
      next: 'cursor-2',
    }
    const out = normalizeEventsPage(raw)
    expect(Object.keys(out.byDate)).toEqual(['2026-01-01', '2026-01-02'])
    expect(out.byDate['2026-01-01'][0]?.push_data?.commit_count).toBe(2)
    expect(out.next).toBe('cursor-2')
  })

  it('平铺数组按 created_at 归组', () => {
    const raw = [
      { action_name: 'pushed', created_at: '2026-02-03T10:00:00+08:00' },
      { action_name: 'created', created_at: '2026-02-03T11:00:00+08:00' },
      { action_name: 'bad', created_at: null },
    ]
    const out = normalizeEventsPage(raw)
    expect(out.byDate['2026-02-03']).toHaveLength(2)
    expect(out.next).toBeUndefined()
  })

  it('非法输入返回空页', () => {
    expect(normalizeEventsPage(null)).toEqual({ byDate: {}, next: undefined })
    expect(normalizeEventsPage(42)).toEqual({ byDate: {}, next: undefined })
    expect(normalizeEventsPage({ foo: 'bar' }).byDate).toEqual({})
  })
})

describe('normalizeDeepCommits', () => {
  it('归一化：sha 截 7 位、message 压空白截 80、作者时间优先', () => {
    const raw = [
      {
        sha: 'abcdef1234567890',
        commit: {
          author: { date: '2026-01-05T10:00:00+08:00' },
          committer: { date: '2026-01-06T10:00:00+08:00' },
          message: 'fix:  something\n\nbody',
        },
      },
      {
        sha: 'short',
        commit: { committer: { date: '2026-02-01T00:00:00Z' }, message: 'x'.repeat(120) },
      },
      null,
      { nothing: true },
    ]
    const out = normalizeDeepCommits(raw)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      sha: 'abcdef1',
      date: '2026-01-05T10:00:00+08:00',
      message: 'fix: something body',
    })
    expect(out[1].date).toBe('2026-02-01T00:00:00Z')
    expect(out[1].message).toHaveLength(80)
  })

  it('非数组输入返回空', () => {
    expect(normalizeDeepCommits(null)).toEqual([])
    expect(normalizeDeepCommits({})).toEqual([])
  })
})

describe('apiErrorMessage', () => {
  it('错误码映射为中文引导', () => {
    expect(apiErrorMessage(new ApiError('unauthorized', 'x'))).toContain('令牌无效')
    expect(apiErrorMessage(new ApiError('forbidden', 'no scopes:read_user'))).toContain('read_user')
    expect(apiErrorMessage(new ApiError('network', 'x'))).toContain('网络')
    expect(apiErrorMessage(new DOMException('Aborted', 'AbortError'))).toContain('中断')
  })
})
