import { describe, expect, it, vi } from 'vitest'
import {
  CACHE_VERSION_CHECK_MS,
  CACHE_VERSION_STORAGE_KEY,
  initCacheVersionCheck,
  rememberCacheVersion,
} from './cache-version'

/**
 * Cache-version check tests (P0 stale-bundle round, 2026-11-12).
 *
 * The check is the client half of the version bump: the backend bumps
 * `cache_version` on every purge, and a bundle that contains this
 * check reloads once when it sees a newer version. The stored version
 * is updated BEFORE the reload, so a reload can never loop; a failed
 * fetch never reloads and never throws.
 *
 * Honest boundary: this can only wake bundles that already contain the
 * check. A device stuck on a pre-check bundle cannot be woken by the
 * bump alone — that is what the parallel SW fix on this branch is for.
 */

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v)
    }),
    store,
  }
}

describe('initCacheVersionCheck', () => {
  it('stores the version on first sight without reloading', async () => {
    const storage = fakeStorage()
    const reload = vi.fn()
    initCacheVersionCheck({
      fetchVersion: async () => 'v1',
      storage,
      reload,
      setIntervalFn: () => 1,
      addVisibilityListener: () => {},
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(storage.store.get(CACHE_VERSION_STORAGE_KEY)).toBe('v1')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads exactly once when the version changes, after storing the new version', async () => {
    const storage = fakeStorage({ [CACHE_VERSION_STORAGE_KEY]: 'v1' })
    const reload = vi.fn()
    let intervalCb: (() => void) | undefined
    initCacheVersionCheck({
      fetchVersion: async () => 'v2',
      storage,
      reload,
      setIntervalFn: (cb) => {
        intervalCb = cb
        return 1
      },
      addVisibilityListener: () => {},
    })
    // Boot check fires on init.
    await Promise.resolve()
    await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1)
    // The new version is stored before the reload, so a second check
    // (interval) must not reload again.
    expect(storage.store.get(CACHE_VERSION_STORAGE_KEY)).toBe('v2')
    intervalCb?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload when the version is unchanged', async () => {
    const storage = fakeStorage({ [CACHE_VERSION_STORAGE_KEY]: 'v1' })
    const reload = vi.fn()
    initCacheVersionCheck({
      fetchVersion: async () => 'v1',
      storage,
      reload,
      setIntervalFn: () => 1,
      addVisibilityListener: () => {},
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
  })

  it('checks on the interval and on visibility change', async () => {
    const fetchVersion = vi.fn(async () => 'v1')
    let intervalCb: (() => void) | undefined
    let visibilityCb: (() => void) | undefined
    initCacheVersionCheck({
      fetchVersion,
      storage: fakeStorage(),
      reload: vi.fn(),
      setIntervalFn: (cb, ms) => {
        expect(ms).toBe(CACHE_VERSION_CHECK_MS)
        intervalCb = cb
        return 1
      },
      addVisibilityListener: (cb) => {
        visibilityCb = cb
      },
    })
    // 1 boot check + interval + visibility = 3 fetches.
    await Promise.resolve()
    await Promise.resolve()
    intervalCb?.()
    visibilityCb?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchVersion).toHaveBeenCalledTimes(3)
  })

  it('never reloads and never throws when the fetch fails', async () => {
    const storage = fakeStorage({ [CACHE_VERSION_STORAGE_KEY]: 'v1' })
    const reload = vi.fn()
    let cleanup: () => void = () => {}
    expect(() => {
      cleanup = initCacheVersionCheck({
        fetchVersion: async () => {
          throw new Error('backend down')
        },
        storage,
        reload,
        setIntervalFn: () => 1,
        addVisibilityListener: () => {},
      })
    }).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    expect(() => cleanup()).not.toThrow()
  })

  it('is a no-op without storage (it could never remember, so it must never reload)', async () => {
    const reload = vi.fn()
    const fetchVersion = vi.fn(async () => 'v2')
    const cleanup = initCacheVersionCheck({
      fetchVersion,
      storage: null,
      reload,
      setIntervalFn: () => 1,
      addVisibilityListener: () => {},
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchVersion).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(() => cleanup()).not.toThrow()
  })

  it('rememberCacheVersion stores the version for the check to read', () => {
    const storage = fakeStorage()
    rememberCacheVersion('v9', storage)
    expect(storage.store.get(CACHE_VERSION_STORAGE_KEY)).toBe('v9')
  })
})
