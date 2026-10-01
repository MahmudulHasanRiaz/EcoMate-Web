import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for the packing scanner lifecycle.
 *
 * `html5-qrcode` guards start()/stop() with a single-slot transition lock and
 * throws a bare string when one is already held:
 *
 *   "Cannot transition to a new state, already under transition"
 *
 * That throw is synchronous (so no `.catch()` can trap it) and used to escape
 * to React's error boundary — a 500 error page. A second symptom: because the
 * library's cleanup `.then()` never ran, its state machine stayed wedged in
 * SCANNING with the camera stream open and the viewport permanently white.
 *
 * These tests drive the real module against a mock of `html5-qrcode` that
 * reproduces the library's locking semantics exactly.
 */

const startCalls: unknown[] = []
const stopCalls: unknown[] = []

/** Mirrors html5-qrcode's StateManagerImpl locking semantics. */
let transitionLockHeld = false
/** Set to make the next start() fail, simulating a busy/unavailable camera. */
let failNextStart = false

class MockHtml5Qrcode {
  isScanning = false

  constructor(public elementId: string) {}

  async start(
    cameraId: string,
    _config: unknown,
    _onSuccess: (t: string) => void,
    _onError?: (e: string) => void,
  ): Promise<void> {
    if (failNextStart) throw 'Camera is not running'
    if (transitionLockHeld) {
      throw 'Cannot transition to a new state, already under transition'
    }
    transitionLockHeld = true
    startCalls.push(cameraId)

    await new Promise((r) => setTimeout(r, 5))
    // Lock released only once the camera surface is actually ready.
    transitionLockHeld = false
    this.isScanning = true
  }

  async stop(): Promise<void> {
    if (transitionLockHeld) {
      throw 'Cannot transition to a new state, already under transition'
    }
    if (!this.isScanning) {
      throw 'Cannot stop, scanner is not running or paused.'
    }
    transitionLockHeld = true
    stopCalls.push(this.elementId)
    this.isScanning = false

    await new Promise((r) => setTimeout(r, 5))
    transitionLockHeld = false
  }
}

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: MockHtml5Qrcode,
  getCameras: vi.fn(),
}))

const CONFIG = {
  fps: 15,
  qrbox: (w: number, h: number) => {
    const size = Math.min(w, h) * 0.75
    return { width: size, height: size }
  },
}

async function importModule() {
  return import('./scanner-controller')
}

describe('createScanner lifecycle', () => {
  beforeEach(() => {
    startCalls.length = 0
    stopCalls.length = 0
    transitionLockHeld = false
    failNextStart = false
    document.body.innerHTML = '<div id="scanner-viewport"></div>'
    vi.resetModules()
  })

  it('never throws "already under transition" when start and stop interleave', async () => {
    const { createScanner } = await importModule()
    const onError = vi.fn()
    const scanner = createScanner('scanner-viewport', CONFIG, {
      onScan: vi.fn(),
      onError,
    })

    // Reproduce the crash: start, then immediately dispose before start has
    // resolved. The library still holds its transition lock at this point.
    const starting = scanner.start('cam-1')
    const disposing = scanner.dispose()

    await expect(Promise.all([starting, disposing])).resolves.toBeDefined()
    expect(onError).not.toHaveBeenCalled()
    expect(scanner.getState()).toBe('idle')
  })

  it('serialises stop() even when called twice in a row', async () => {
    const { createScanner } = await importModule()
    const onError = vi.fn()
    const scanner = createScanner('scanner-viewport', CONFIG, {
      onScan: vi.fn(),
      onError,
    })

    await scanner.start('cam-1')
    // Double teardown (e.g. Escape + Back, or two effects cleaning up).
    const first = scanner.dispose()
    const second = scanner.dispose()

    await expect(Promise.all([first, second])).resolves.toBeDefined()
    expect(onError).not.toHaveBeenCalled()
    expect(scanner.getState()).toBe('idle')
  })

  it('recovers and can restart after a full start/stop cycle', async () => {
    const { createScanner } = await importModule()
    const onError = vi.fn()
    const scanner = createScanner('scanner-viewport', CONFIG, {
      onScan: vi.fn(),
      onError,
    })

    for (let i = 0; i < 3; i++) {
      await scanner.start('cam-1')
      expect(scanner.getState()).toBe('scanning')
      await scanner.dispose()
      expect(scanner.getState()).toBe('idle')
    }

    expect(onError).not.toHaveBeenCalled()
    expect(startCalls).toHaveLength(3)
  })

  it('clears leftover scanner DOM so the viewport is not left white', async () => {
    const { createScanner } = await importModule()
    const scanner = createScanner('scanner-viewport', CONFIG, {
      onScan: vi.fn(),
    })

    await scanner.start('cam-1')
    // Simulate html5-qrcode injecting its canvas + shaded region.
    const el = document.getElementById('scanner-viewport')!
    el.innerHTML = '<canvas id="qr-canvas-visible"></canvas>'

    await scanner.dispose()

    expect(document.getElementById('scanner-viewport')!.innerHTML).toBe('')
  })

  it('recovers from a failed start so scanning works again', async () => {
    const { createScanner } = await importModule()
    const onError = vi.fn()
    const scanner = createScanner('scanner-viewport', CONFIG, {
      onScan: vi.fn(),
      onError,
    })

    // First start fails (camera busy).
    failNextStart = true
    await scanner.start('cam-1')
    expect(onError).toHaveBeenCalled()
    expect(scanner.getState()).toBe('idle')

    // The next attempt must succeed, proving the failed attempt did not wedge
    // the library's state machine or leave the transition lock held.
    failNextStart = false
    const fresh = createScanner('scanner-viewport', CONFIG, {
      onScan: vi.fn(),
      onError,
    })
    await fresh.start('cam-1')
    expect(fresh.getState()).toBe('scanning')
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('pickDefaultCamera', () => {
  it('prefers the rear/environment camera', async () => {
    const { pickDefaultCamera } = await importModule()
    const devices = [
      { id: 'front', label: 'Front Camera' },
      { id: 'rear', label: 'Back Camera' },
    ]
    expect(pickDefaultCamera(devices)).toBe('rear')
  })

  it('falls back to the first device when none match', async () => {
    const { pickDefaultCamera } = await importModule()
    const devices = [{ id: 'a', label: 'USB Camera' }]
    expect(pickDefaultCamera(devices)).toBe('a')
  })
})