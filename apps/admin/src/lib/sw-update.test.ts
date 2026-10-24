import { describe, expect, it, vi } from 'vitest'
import { SW_UPDATE_CHECK_MS, initSwUpdate } from './sw-update'

/** Minimal ServiceWorkerContainer stand-in: an EventTarget + getRegistration. */
function fakeSw() {
  const target = new EventTarget()
  const update = vi.fn().mockResolvedValue(undefined)
  const registration = { update }
  const container = Object.assign(target, {
    getRegistration: vi.fn().mockResolvedValue(registration),
  }) as unknown as ServiceWorkerContainer
  return { container, target, update }
}

describe('initSwUpdate (D18)', () => {
  it('reloads exactly once when the new SW takes control', () => {
    const { container, target } = fakeSw()
    const reload = vi.fn()
    initSwUpdate({ serviceWorker: container, reload })
    target.dispatchEvent(new Event('controllerchange'))
    target.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('checks for updates on the interval and on visibility change', async () => {
    const { container, update } = fakeSw()
    let intervalCb: (() => void) | undefined
    let visibilityCb: (() => void) | undefined
    initSwUpdate({
      serviceWorker: container,
      reload: vi.fn(),
      setIntervalFn: (cb, ms) => {
        expect(ms).toBe(SW_UPDATE_CHECK_MS)
        intervalCb = cb
        return 1
      },
      addVisibilityListener: (cb) => {
        visibilityCb = cb
      },
    })
    intervalCb?.()
    visibilityCb?.()
    // getRegistration().then(update) is async — let the microtasks flush.
    await Promise.resolve()
    await Promise.resolve()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('is a no-op without service-worker support and never throws', () => {
    const cleanup = initSwUpdate({ serviceWorker: null, reload: vi.fn() })
    expect(() => cleanup()).not.toThrow()
  })

  it('cleanup detaches the controllerchange listener', () => {
    const { container, target } = fakeSw()
    const reload = vi.fn()
    const cleanup = initSwUpdate({ serviceWorker: container, reload })
    cleanup()
    target.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
  })
})
