import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorMessage, normalizeEventsPage } from './client'

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

describe('apiErrorMessage', () => {
  it('错误码映射为中文引导', () => {
    expect(apiErrorMessage(new ApiError('unauthorized', 'x'))).toContain('令牌无效')
    expect(apiErrorMessage(new ApiError('forbidden', 'no scopes:read_user'))).toContain('read_user')
    expect(apiErrorMessage(new ApiError('network', 'x'))).toContain('网络')
    expect(apiErrorMessage(new DOMException('Aborted', 'AbortError'))).toContain('中断')
  })
})
