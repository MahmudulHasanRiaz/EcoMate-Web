/**
 * Service-worker update strategy (D18).
 *
 * The admin is a PWA (vite-plugin-pwa, registerType 'autoUpdate'), so a new
 * SW skips waiting and claims clients as soon as it installs. That alone
 * did NOT end stale deploys, for two stacked reasons proven live on staging
 * 2026-10-24 (server served the new bundle while staff sessions kept
 * running the old one for hours):
 *
 * 1. A long-lived SPA tab only checks for SW updates on document
 *    navigation (or every ~24h). Staff keep one tab open all shift doing
 *    client-side routing, so the check may never run after a deploy.
 * 2. Even when the new SW claims the page, the already-loaded JS bundle
 *    keeps running until a full reload — route chunks are resolved from
 *    the loaded (old) bundle, so the UI stays old with no error anywhere.
 *
 * This module closes both gaps from the client side (the matching nginx
 * half — no-cache on sw.js / registerSW.js / index.html — lives in
 * apps/admin/nginx.conf; without it the update check itself can be served
 * a heuristically-cached old sw.js):
 *
 * - Periodic update checks (15 min) plus a check on every
 *   visibilitychange, so a tab left open — or returned to after a deploy
 *   — picks the new SW up promptly.
 * - A single reload when the new SW takes control (controllerchange), so
 *   the page actually runs the new bundle. The reload fires at most once
 *   per page load, and only when control actually changes hands, so it
 *   cannot loop; it fires on navigation/focus boundaries, not mid-typing.
 *
 * Dependencies are injectable so tests never touch a real service worker.
 */

export interface SwUpdateDeps {
  /** Defaults to navigator.serviceWorker; pass null to simulate no support. */
  serviceWorker?: ServiceWorkerContainer | null
  /** Defaults to window.location.reload. */
  reload?: () => void
  /** Defaults to setInterval. The callback is exposed for tests. */
  setIntervalFn?: (cb: () => void, ms: number) => unknown
  /** Defaults to document.addEventListener('visibilitychange', cb). */
  addVisibilityListener?: (cb: () => void) => void
  /** Defaults to document.removeEventListener('visibilitychange', cb). */
  removeVisibilityListener?: (cb: () => void) => void
}

export const SW_UPDATE_CHECK_MS = 15 * 60 * 1000

export function initSwUpdate(deps: SwUpdateDeps = {}): () => void {
  const sw =
    deps.serviceWorker !== undefined
      ? deps.serviceWorker
      : typeof navigator !== 'undefined'
        ? navigator.serviceWorker
        : undefined
  if (!sw) return () => {}

  let reloaded = false
  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    if (deps.reload) deps.reload()
    else window.location.reload()
  }
  sw.addEventListener('controllerchange', reloadOnce)

  const checkForUpdate = () => {
    sw.getRegistration()
      .then((reg) => reg?.update().catch(() => {}))
      .catch(() => {})
  }
  const timer = (deps.setIntervalFn ?? setInterval)(
    checkForUpdate,
    SW_UPDATE_CHECK_MS,
  )
  const onVisibilityChange = () => {
    checkForUpdate()
  }
  const addVis =
    deps.addVisibilityListener ??
    ((cb: () => void) => document.addEventListener('visibilitychange', cb))
  const removeVis =
    deps.removeVisibilityListener ??
    ((cb: () => void) => document.removeEventListener('visibilitychange', cb))
  addVis(onVisibilityChange)

  return () => {
    sw.removeEventListener('controllerchange', reloadOnce)
    if (typeof timer === 'number') clearInterval(timer)
    removeVis(onVisibilityChange)
  }
}
