/**
 * Cache-version check — the client half of "Purge all cache"
 * (P0 stale-bundle round, 2026-11-12).
 *
 * A server-side button CANNOT clear a specific phone's browser cache.
 * The version bump is the mechanism instead: every purge writes a new
 * `cache_version` (SystemSetting, backend), and a bundle that contains
 * this check reloads once when it sees a newer version — on boot, every
 * 15 minutes, and whenever the tab becomes visible again. Wired in
 * apps/admin/src/main.tsx next to initSwUpdate.
 *
 * Honest boundary, for the SW-fix builder reusing this: this can only
 * wake bundles that already contain the check. A device stuck on a
 * pre-check bundle cannot be woken by the bump alone — the SW fix on
 * this branch (defeating the stale NavigationRoute / sw.js update path)
 * is what gets new code onto those devices in the first place. Once a
 * device runs any bundle with this check, future purges wake it.
 *
 * Safety: the stored version is updated BEFORE the reload, and the
 * reload fires at most once per page load, so a reload can never loop.
 * A failed version fetch never reloads and never throws. Without
 * storage there is nothing to remember, so the check is a no-op rather
 * than a reload loop.
 *
 * Reuse seam for the SW-fix builder / storefront: call
 * `rememberCacheVersion(version)` after a purge you triggered yourself
 * (the Purge-all button does this) so your own tab does not reload
 * while you are reading the result; call `initCacheVersionCheck()`
 * from any other client that can reach GET /cache-purge/version.
 *
 * Dependencies are injectable so tests never touch a real network or
 * storage (same pattern as lib/sw-update.ts).
 */

import { apiClient } from '@/lib/api-client'

export const CACHE_VERSION_STORAGE_KEY = 'eco_mate_cache_version'
export const CACHE_VERSION_CHECK_MS = 15 * 60 * 1000

export interface CacheVersionDeps {
  /** Defaults to GET /cache-purge/version via apiClient. */
  fetchVersion?: () => Promise<string | null>
  /** Defaults to localStorage; null simulates unavailable storage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** Defaults to window.location.reload. */
  reload?: () => void
  /** Defaults to setInterval. The callback is exposed for tests. */
  setIntervalFn?: (cb: () => void, ms: number) => unknown
  /** Defaults to document.addEventListener('visibilitychange', cb). */
  addVisibilityListener?: (cb: () => void) => void
  /** Defaults to document.removeEventListener('visibilitychange', cb). */
  removeVisibilityListener?: (cb: () => void) => void
}

export function rememberCacheVersion(
  version: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): void {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null
    store?.setItem(CACHE_VERSION_STORAGE_KEY, version)
  } catch {
    /* storage unavailable — the next check simply treats it as first sight */
  }
}

export function initCacheVersionCheck(
  deps: CacheVersionDeps = {},
): () => void {
  const storage =
    deps.storage !== undefined
      ? deps.storage
      : typeof localStorage !== 'undefined'
        ? localStorage
        : null
  if (!storage) return () => {}

  const fetchVersion =
    deps.fetchVersion ??
    (async () => {
      const res = await apiClient.get<{ version: string | null }>(
        '/cache-purge/version',
      )
      return res.data?.version ?? null
    })
  const reload = deps.reload ?? (() => window.location.reload())

  let reloaded = false
  const check = async () => {
    let current: string | null
    try {
      current = await fetchVersion()
    } catch {
      return
    }
    if (current == null) return
    let seen: string | null
    try {
      seen = storage.getItem(CACHE_VERSION_STORAGE_KEY)
    } catch {
      return
    }
    if (seen === null) {
      // First sight: remember, do not reload — this tab just booted.
      try {
        storage.setItem(CACHE_VERSION_STORAGE_KEY, current)
      } catch {
        /* ignore */
      }
      return
    }
    if (seen !== current && !reloaded) {
      reloaded = true
      try {
        storage.setItem(CACHE_VERSION_STORAGE_KEY, current)
      } catch {
        /* ignore */
      }
      reload()
    }
  }

  // Boot check: a tab opened after a purge must not keep running stale.
  void check()
  const timer = (deps.setIntervalFn ?? setInterval)(
    () => void check(),
    CACHE_VERSION_CHECK_MS,
  )
  const onVisibilityChange = () => void check()
  const addVis =
    deps.addVisibilityListener ??
    ((cb: () => void) => document.addEventListener('visibilitychange', cb))
  const removeVis =
    deps.removeVisibilityListener ??
    ((cb: () => void) => document.removeEventListener('visibilitychange', cb))
  addVis(onVisibilityChange)

  return () => {
    if (typeof timer === 'number') clearInterval(timer)
    removeVis(onVisibilityChange)
  }
}
