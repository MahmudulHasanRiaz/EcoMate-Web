import { Html5Qrcode, type CameraDevice } from 'html5-qrcode'

/**
 * Camera lifecycle wrapper around `html5-qrcode`.
 *
 * Why this exists — `html5-qrcode` guards every `start()`/`stop()` with a
 * single-slot "transaction" lock (`state-manager.js`) and **throws a bare
 * string** if one is already in flight:
 *
 *   "Cannot transition to a new state, already under transition"
 *
 * The lock is taken synchronously inside `start()` / `stop()` themselves, so it
 * is *not* reachable by a `.catch()` on the returned promise. It stays held:
 *   - after `start()`  until `onRenderSurfaceReady` fires (camera actually
 *     streaming), and
 *   - after `stop()`   until `renderedCamera.close()` resolves.
 *
 * The library's own `isScanning` boolean is not a safe guard: it only flips to
 * `false` *after* `close()` resolves, and is `false` while `start()` is still
 * pending. Gating cleanup on it therefore allowed two interleavings that both
 * throw:
 *   1. `start()` in flight  → `isScanning === false` → `stop()` called anyway.
 *   2. `stop()` in flight   → `isScanning === true`  → `stop()` called twice.
 *
 * That throw is synchronous, escapes to React's error boundary, and blanked
 * the whole page with a 500 — while leaving the camera stream open and the
 * library's state machine wedged in SCANNING, which is also why the viewport
 * went white and stopped scanning afterwards.
 *
 * This module fixes it by (a) serialising start/stop through a single promise
 * chain, and (b) tracking the scanner's real state itself instead of trusting
 * `isScanning`.
 */

type ScannerState = 'idle' | 'starting' | 'scanning' | 'stopping'

export interface ScannerController {
  start(cameraId: string): Promise<void>
  stop(): Promise<void>
  dispose(): Promise<void>
  getState(): ScannerState
}

export function createScanner(
  elementId: string,
  config: {
    fps: number
    qrbox: (width: number, height: number) => { width: number; height: number }
  },
  callbacks: {
    onScan: (decodedText: string) => void
    onError?: (err: unknown) => void
  },
): ScannerController {
  let scanner: Html5Qrcode | null = null
  let state: ScannerState = 'idle'
  /** Serialises every lifecycle call so two can never overlap. */
  let chain: Promise<void> = Promise.resolve()

  const setState = (next: ScannerState) => {
    state = next
  }

  /** Clears whatever html5-qrcode injected into the mount element. */
  const clearViewport = () => {
    const el = document.getElementById(elementId)
    if (el) el.innerHTML = ''
  }

  const runStart = async (cameraId: string) => {
    if (state !== 'idle') return

    const target = document.getElementById(elementId)
    if (!target) {
      setState('idle')
      return
    }

    const instance = new Html5Qrcode(elementId)
    scanner = instance
    setState('starting')

    try {
      await instance.start(
        cameraId,
        config,
        (decodedText) => callbacks.onScan(decodedText),
        // IMPORTANT: html5-qrcode's 4th argument is a PER-FRAME decode
        // callback, not a fatal-error callback. It fires on every frame that
        // contains no readable code — which is most frames, constantly. The
        // old code wired it to the same handler as a start() failure, so a
        // single frame without a barcode put the workspace into a permanent
        // error state: the viewport div unmounted (the camera light stayed on
        // with no visible video), and because the error was never reset the
        // camera could only be recovered with a full page reload.
        //
        // Decode misses are normal and must be swallowed here. Only a genuine
        // start() failure below is reported as a camera error.
        () => {},
      )
      // `start` resolves only once the surface is ready, so the library's
      // transition lock is released by the time we get here.
      setState('scanning')
    } catch (err) {
      // A failed start still holds the lock until it unwinds; drop the
      // instance so a later start() builds a clean one.
      setState('idle')
      scanner = null
      clearViewport()
      callbacks.onError?.(err)
    }
  }

  const runStop = async () => {
    const instance = scanner
    if (!instance) {
      setState('idle')
      return
    }

    setState('stopping')
    try {
      // Only stop once the start has settled. Calling stop() while the library
      // still holds its transition lock is exactly what threw.
      if (state === 'starting') {
        // Nothing to await explicitly: `start` rejects or resolves, and either
        // way the lock is released by the library before our stop runs because
        // both are on the same serialised chain.
        await Promise.resolve()
      }
      await instance.stop()
    } catch (err) {
      // The library may throw if its lock is somehow still held. Recover by
      // dropping the reference and scrubbing the DOM so the next start() is
      // not blocked by leftover scanner state.
      callbacks.onError?.(err)
    } finally {
      scanner = null
      clearViewport()
      setState('idle')
    }
  }

  const enqueue = (task: () => Promise<void>) => {
    chain = chain.then(task, task)
    return chain
  }

  return {
    start: (cameraId: string) => enqueue(() => runStart(cameraId)),
    stop: () => enqueue(() => runStop()),
    dispose: () => enqueue(() => runStop()),
    getState: () => state,
  }
}

/** Picks a sensible default camera, preferring the rear/environment lens. */
export function pickDefaultCamera(devices: CameraDevice[]): string {
  const back = devices.find((d) =>
    ['back', 'environment', 'rear'].some((hint) =>
      (d.label ?? '').toLowerCase().includes(hint),
    ),
  )
  return (back ?? devices[0])?.id ?? ''
}