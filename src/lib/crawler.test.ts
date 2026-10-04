import { describe, expect, it } from 'vitest'
import type { GitCodeClient } from '../api/client'
import { ApiError } from '../api/client'
import type { GitCodeRepo } from '../api/types'
import { deepCrawlCommits } from './crawler'

function repo(partial: Partial<GitCodeRepo> & { path: string }): GitCodeRepo {
  const slash = partial.path.indexOf('/')
  const ns = slash > 0 ? partial.path.slice(0, slash) : 'a'
  const name = slash > 0 ? partial.path.slice(slash + 1) : partial.path
  return { namespace: { path: ns }, ...partial, path: name }
}

function fakeClient(
  behavior: Record<string, (opts: { page?: number }) => unknown> = {},
): GitCodeClient {
  return {
    async listRepoCommits(
      _owner: string,
      repo: string,
      opts: { page?: number } = {},
    ): Promise<unknown> {
      const handler = behavior[repo]
      if (handler) return handler(opts)
      return [
        {
          sha: 'abc1234567',
          commit: { author: { date: '2026-01-01T10:00:00+08:00' }, message: 'm' },
        },
      ]
    },
  } as unknown as GitCodeClient
}

describe('deepCrawlCommits scope', () => {
  const repos = [
    repo({ path: 'me/own-1' }),
    repo({ path: 'me/own-2' }),
    repo({ path: 'community/joined' }),
    repo({ path: 'org/member' }),
  ]

  it("personal 只抓 namespace=login 的本人仓库", async () => {
    const client = fakeClient()
    const result = await deepCrawlCommits(client, repos, {
      scope: 'personal',
      login: 'Me', // 大小写不敏感
    })
    expect(Object.keys(result.commitsByRepo).sort()).toEqual(['me/own-1', 'me/own-2'])
    expect(result.commitsByRepo['me/own-1']).toEqual([
      { sha: 'abc1234', date: '2026-01-01T10:00:00+08:00', message: 'm' },
    ])
    expect(result.failedCount).toBe(0)
  })

  it('all 抓全部；skip 跳过已抓过的（增量）', async () => {
    const client = fakeClient()
    const result = await deepCrawlCommits(client, repos, {
      scope: 'all',
      skip: new Set(['me/own-1']),
    })
    expect(Object.keys(result.commitsByRepo).sort()).toEqual([
      'community/joined',
      'me/own-2',
      'org/member',
    ])
  })

  it('404 记空表不计失败，其他错误计入 failedCount，中断向上抛', async () => {
    const client = fakeClient({
      gone: () => {
        throw new ApiError('notFound', 'missing', { status: 404 })
      },
      broken: () => {
        throw new ApiError('server', 'boom', { status: 500 })
      },
      stopped: () => {
        throw new ApiError('aborted', '中断')
      },
    })
    const list = [repo({ path: 'a/gone' }), repo({ path: 'a/broken' })]
    const result = await deepCrawlCommits(client, list, { scope: 'all' })
    expect(result.commitsByRepo['a/gone']).toEqual([])
    expect(result.failedCount).toBe(1)

    await expect(
      deepCrawlCommits(client, [repo({ path: 'b/stopped' })], { scope: 'all' }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })

  it('进度回调带总数与路径', async () => {
    const client = fakeClient()
    const seen: string[] = []
    await deepCrawlCommits(client, [repo({ path: 'me/x' }), repo({ path: 'me/y' })], {
      scope: 'personal',
      login: 'me',
      onProgress: (p) => seen.push(`${p.current}/${p.total}:${p.message}`),
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toContain('1/2')
    expect(seen[1]).toContain('me/y')
  })

  it('全时段翻页：短页即停，累计多页提交', async () => {
    const commit = (i: number) => ({
      sha: `sha${i}000000000`,
      commit: { author: { date: '2026-01-01T10:00:00+08:00' }, message: `m${i}` },
    })
    const client = fakeClient({
      paged: ({ page = 1 }) =>
        page === 1 ? Array.from({ length: 100 }, (_, i) => commit(i))
          : Array.from({ length: 40 }, (_, i) => commit(100 + i)),
    })
    const result = await deepCrawlCommits(client, [repo({ path: 'me/paged' })], {
      scope: 'personal',
      login: 'me',
    })
    expect(result.commitsByRepo['me/paged']).toHaveLength(140)
    expect(result.truncated).toEqual([])
  })

  it('单仓库超上限被截断并计入 truncated', async () => {
    const client = fakeClient({
      huge: () => Array.from({ length: 100 }, (_, i) => ({ sha: `s${i}` })),
    })
    const result = await deepCrawlCommits(client, [repo({ path: 'me/huge' })], {
      scope: 'personal',
      login: 'me',
    })
    expect(result.commitsByRepo['me/huge']).toHaveLength(
      50 * 100, // MAX_COMMIT_PAGES_PER_REPO × 100
    )
    expect(result.truncated).toEqual(['me/huge'])
  })
})
