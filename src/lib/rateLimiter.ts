/**
 * 串行限流队列：所有 API 请求经此节流后再发出。
 *
 * - 最小间隔 minIntervalMs（默认 200ms → 300 次/分，低于平台 400 次/分配额留余量）
 * - 滑动窗口 maxPerWindow（默认 380 次/60s，双保险）
 * - 排队与等待期间可被 AbortSignal 中断
 *
 * 注意：平台小时配额 4000 次/小时远高于本项目单轮抓取的请求量
 * （仓库数 + 仓库数[语言] + 若干 events 页），不做小时级跟踪。
 */

export interface RateLimiterOptions {
  minIntervalMs?: number
  windowMs?: number
  maxPerWindow?: number
}

export interface RateLimiterDeps {
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export async function sleepAbort(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

export interface ResolvedRateLimiterOptions {
  minIntervalMs: number
  windowMs: number
  maxPerWindow: number
}

/**
 * 计算距下一次放行需要等待的毫秒数（纯函数，供单测）。
 * @param now 当前时间戳
 * @param starts 窗口内最近几次放行的时间戳（升序）
 */
export function computeGateDelay(
  now: number,
  starts: readonly number[],
  opts: ResolvedRateLimiterOptions,
): number {
  let delay = 0
  if (starts.length > 0) {
    const lastStart = starts[starts.length - 1]
    delay = Math.max(delay, lastStart + opts.minIntervalMs - now)
  }
  if (starts.length >= opts.maxPerWindow) {
    // 最早的放行记录滑出窗口后才能继续
    delay = Math.max(delay, starts[0] + opts.windowMs - now + 1)
  }
  return Math.max(0, delay)
}

export class RateLimiter {
  private readonly opts: ResolvedRateLimiterOptions
  private readonly now: () => number
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  /** 窗口内放行时间戳（升序） */
  private starts: number[] = []
  /** 串行化链：保证任务按入队顺序过闸 */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(opts: RateLimiterOptions = {}, deps: RateLimiterDeps = {}) {
    this.opts = {
      minIntervalMs: 200,
      windowMs: 60_000,
      maxPerWindow: 380,
      ...opts,
    }
    this.now = deps.now ?? (() => Date.now())
    this.sleep = deps.sleep ?? sleepAbort
  }

  /**
   * 排队执行 task：等到节流闸放行后执行；排队与等待期间信号中断则抛 AbortError。
   * task 自身抛错不会阻塞后续排队任务。
   */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const effSignal: AbortSignal = signal ?? new AbortController().signal
    const attempt = this.chain.then(async () => {
      throwIfAborted(effSignal)
      this.prune()
      let delay = computeGateDelay(this.now(), this.starts, this.opts)
      while (delay > 0) {
        throwIfAborted(effSignal)
        await this.sleep(delay, effSignal)
        this.prune()
        delay = computeGateDelay(this.now(), this.starts, this.opts)
      }
      throwIfAborted(effSignal)
      this.starts.push(this.now())
      return task()
    })
    this.chain = attempt.catch(() => undefined)
    return attempt
  }

  private prune(): void {
    const cutoff = this.now() - this.opts.windowMs
    if (this.starts.length === 0 || this.starts[0] > cutoff) return
    this.starts = this.starts.filter((t) => t > cutoff)
  }
}
