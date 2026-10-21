/**
 * The camera EMISSION GATE — one-shot + re-arm + processing lock.
 *
 * html5-qrcode calls the success callback for EVERY decoded frame (~10/s for a
 * label held in view). Without a gate, one label produced a continuous stream
 * of actions — the packing workspace raised a "Wrong Product!" toast 10–15
 * times per second because the order QR kept arriving on the item screen.
 *
 * Rules:
 *  - a value is emitted ONCE and then suppressed while it stays in view;
 *  - it re-arms only after the value has been ABSENT from the decodes for
 *    `rearmGapMs`, or when a DIFFERENT value intervenes;
 *  - while a result is being handled, further emissions are DROPPED (never
 *    queued) and the lock always releases.
 *
 * Pure and framework-free on purpose: the shared React hook and the browser
 * harness use the very same implementation.
 */

export interface EmissionGateOptions {
  /** How long a value must be absent before the same value may fire again. */
  rearmGapMs?: number
  /** Called with a value that passed the one-shot + lock gate. */
  onEmit: (value: string) => void | Promise<void>
}

export interface EmissionGateState {
  /** The value currently in view. */
  value: string | null
  /** True when the current value may still fire. */
  armed: boolean
  /** True while a result is being handled. */
  locked: boolean
}

export interface EmissionGate {
  /** Feed a decoded value. */
  push: (decodedText: string) => void
  /** Release the timer (unmount). */
  dispose: () => void
  /** Diagnostics (tests). */
  state: () => EmissionGateState
}

export function createEmissionGate(options: EmissionGateOptions): EmissionGate {
  const rearmGapMs = options.rearmGapMs ?? 1200
  let value: string | null = null
  let armed = true
  let locked = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const push = (decodedText: string) => {
    const next = (decodedText ?? '').trim()
    if (!next) return

    // The value is in view again → restart the absence timer.
    clearTimer()
    if (value !== next) {
      // A different value intervenes → re-arm immediately.
      value = next
      armed = true
    }
    timer = setTimeout(() => {
      timer = null
      armed = true
    }, rearmGapMs)

    // Processing lock: the result is being handled → drop further emissions.
    if (locked) return
    // One-shot: the same value does not fire again while it stays in view.
    if (!armed) return
    armed = false

    locked = true
    const release = () => {
      locked = false
    }
    try {
      const result = options.onEmit(next)
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).then(release, release)
      } else {
        release()
      }
    } catch (err) {
      release()
      console.error('Camera scan handler failed', err)
    }
  }

  const dispose = () => {
    clearTimer()
    locked = false
  }

  return {
    push,
    dispose,
    state: () => ({ value, armed, locked }),
  }
}
