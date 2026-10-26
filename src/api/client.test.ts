import { describe, expect, it } from 'vitest'
import {
  ApiError,
  apiErrorMessage,
  describeEventsResponse,
  normalizeDeepCommits,
  normalizeEventsPage,
} from './client'

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

describe('normalizeEventsPage 形状兜底', () => {
  const ev = { action_name: 'pushed', created_at: '2026-03-02T10:00:00+08:00' }

  it('事件数组包在 items / data / events 字段里也能解析', () => {
    expect(Object.keys(normalizeEventsPage({ items: [ev] }).byDate)).toEqual(['2026-03-02'])
    expect(Object.keys(normalizeEventsPage({ data: [ev] }).byDate)).toEqual(['2026-03-02'])
    expect(Object.keys(normalizeEventsPage({ events: [ev] }).byDate)).toEqual(['2026-03-02'])
  })

  it('日期键对象再嵌一层也能解析', () => {
    const raw = { data: { '2026-03-02': [ev] } }
    expect(Object.keys(normalizeEventsPage(raw).byDate)).toEqual(['2026-03-02'])
  })

  it('保留 next 游标', () => {
    expect(normalizeEventsPage({ '2026-03-02': [ev], next: 'p2' }).next).toBe('p2')
    expect(normalizeEventsPage({ items: [ev], last_id: 'x' }).next).toBe('x')
  })

  it('不把普通字段数组误判为事件', () => {
    expect(normalizeEventsPage({ labels: ['a', 'b'], meta: { n: 1 } }).byDate).toEqual({})
  })
})

describe('describeEventsResponse', () => {
  it('描述数组与对象的形状，便于诊断', () => {
    expect(describeEventsResponse([{ created_at: 'x', action_name: 'y' }])).toContain('数组 1 项')
    expect(describeEventsResponse([{ created_at: 'x', action_name: 'y' }])).toContain('created_at')
    expect(describeEventsResponse({ items: [], next: 'n' })).toContain('对象 2 个键')
    expect(describeEventsResponse({})).toContain('对象 0 个键')
    expect(describeEventsResponse(7)).toBe('number')
  })
})

describe('normalizeEventsPage 深度兜底', () => {
  const ev = { action_name: 'pushed', created_at: '2026-03-02T10:00:00+08:00' }

  it('按「YYYY-MM」月键分组的响应也能展开到日', () => {
    const raw = { '2026-03': [ev], '2026-04': [{ created_at: '2026-04-11T09:00:00+08:00' }] }
    const out = normalizeEventsPage(raw)
    expect(Object.keys(out.byDate).sort()).toEqual(['2026-03-02', '2026-04-11'])
  })

  it('多层包裹（data.result.items）也能被扫出来', () => {
    const raw = { data: { result: { items: [ev] } } }
    expect(Object.keys(normalizeEventsPage(raw).byDate)).toEqual(['2026-03-02'])
  })

  it('没有 created_at 的对象不会被误收', () => {
    const raw = { project: { name: 'x', created_at: 12345 } }
    expect(normalizeEventsPage(raw).byDate).toEqual({})
  })
})
