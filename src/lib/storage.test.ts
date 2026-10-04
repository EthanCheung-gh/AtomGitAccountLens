import { describe, expect, it } from 'vitest'
import type { AnalysisSnapshot, StorageLike } from './storage'
import {
  clearRememberedToken,
  clearSnapshot,
  loadRememberedToken,
  loadSnapshot,
  saveRememberedToken,
  saveSnapshot,
} from './storage'

class MemStorage implements StorageLike {
  store = new Map<string, string>()
  failOnSet = false
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failOnSet) throw new Error('QuotaExceeded')
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

describe('令牌存储', () => {
  it('保存/读取/清除往返', () => {
    const s = new MemStorage()
    expect(loadRememberedToken(s)).toBeNull()
    expect(saveRememberedToken('tok-1', s)).toBe(true)
    expect(loadRememberedToken(s)).toBe('tok-1')
    clearRememberedToken(s)
    expect(loadRememberedToken(s)).toBeNull()
  })

  it('写入失败返回 false', () => {
    const s = new MemStorage()
    s.failOnSet = true
    expect(saveRememberedToken('tok', s)).toBe(false)
  })
})

describe('快照存储', () => {
  const snapshot: AnalysisSnapshot = {
    version: 1,
    createdAt: '2026-10-04T10:00:00.000Z',
    login: 'ethan',
    user: { login: 'ethan' },
    repos: [{ path: 'a/b' }],
    languagesByRepo: { 'a/b': { TypeScript: 100 } },
    eventsByYear: { '2026': [] },
    excludedRepos: [],
  }

  it('保存/读取往返保持数据', () => {
    const s = new MemStorage()
    expect(saveSnapshot(snapshot, s)).toBe(true)
    expect(loadSnapshot(s)).toEqual(snapshot)
  })

  it('损坏 JSON / 形状不符 / 版本不符均返回 null', () => {
    const s = new MemStorage()
    s.store.set('agl:snapshot:v1', '{broken')
    expect(loadSnapshot(s)).toBeNull()

    s.store.set('agl:snapshot:v1', JSON.stringify({ version: 2 }))
    expect(loadSnapshot(s)).toBeNull()

    const bad = { ...snapshot, repos: 'not-array' }
    s.store.set('agl:snapshot:v1', JSON.stringify(bad))
    expect(loadSnapshot(s)).toBeNull()
  })

  it('清除与配额失败', () => {
    const s = new MemStorage()
    saveSnapshot(snapshot, s)
    clearSnapshot(s)
    expect(loadSnapshot(s)).toBeNull()
    s.failOnSet = true
    expect(saveSnapshot(snapshot, s)).toBe(false)
  })
})
