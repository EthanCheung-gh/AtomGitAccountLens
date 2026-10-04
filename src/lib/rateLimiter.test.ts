import { describe, expect, it } from 'vitest'
import { RateLimiter, computeGateDelay } from './rateLimiter'

const OPTS = { minIntervalMs: 200, windowMs: 60_000, maxPerWindow: 380 }

describe('computeGateDelay', () => {
  it('无历史放行时立即放行', () => {
    expect(computeGateDelay(1000, [], OPTS)).toBe(0)
  })

  it('按最小间隔计算等待', () => {
    // 上次放行于 900，now=1000，间隔 200 → 需等到 1100
    expect(computeGateDelay(1000, [900], OPTS)).toBe(100)
    // 已过间隔 → 0
    expect(computeGateDelay(1200, [900], OPTS)).toBe(0)
  })

  it('窗口满时等待最早记录滑出窗口', () => {
    const starts = [1000, ...Array.from({ length: 379 }, (_, i) => 2000 + i * 10)]
    const now = 60_000 // 最早的 1000 距 now 59000ms，窗口 60000
    const expected = 1000 + 60_000 - now + 1
    expect(computeGateDelay(now, starts, OPTS)).toBe(expected)
  })

  it('窗口未满但间隔不足时取间隔等待', () => {
    const starts = [5000]
    expect(computeGateDelay(5050, starts, OPTS)).toBe(150)
  })
})

describe('RateLimiter', () => {
  function makeFixture() {
    let now = 10_000
    const slept: number[] = []
    const limiter = new RateLimiter(
      { minIntervalMs: 200, windowMs: 60_000, maxPerWindow: 3 },
      {
        now: () => now,
        sleep: async (ms) => {
          slept.push(ms)
          now += ms
        },
      },
    )
    return { limiter, now: () => now, slept }
  }

  it('连续任务按最小间隔串行放行', async () => {
    const { limiter, slept } = makeFixture()
    const order: number[] = []
    await Promise.all([
      limiter.run(async () => {
        order.push(1)
      }),
      limiter.run(async () => {
        order.push(2)
      }),
      limiter.run(async () => {
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
    expect(slept).toEqual([200, 200])
  })

  it('窗口配额满时等待窗口滑出', async () => {
    const { limiter, slept } = makeFixture() // maxPerWindow 3
    const run = () => limiter.run(async () => undefined)
    await run()
    await run()
    await run()
    await run() // 第 4 个：3 条记录最早 t=10000，需等到 10000+60000+1
    expect(slept[slept.length - 1]).toBeGreaterThanOrEqual(60_000 - 400)
  })

  it('排队中断抛 AbortError', async () => {
    const { limiter } = makeFixture()
    const controller = new AbortController()
    limiter.run(async () => undefined) // 占住首位（立即执行）
    const p = limiter.run(async () => undefined, controller.signal)
    controller.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('单个任务失败不阻塞后续任务', async () => {
    const { limiter } = makeFixture()
    const boom = limiter.run(async () => {
      throw new Error('boom')
    })
    await expect(boom).rejects.toThrow('boom')
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
  })
})
