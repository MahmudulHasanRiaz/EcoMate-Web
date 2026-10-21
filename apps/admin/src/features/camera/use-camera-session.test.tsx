import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { useCameraSession } from './use-camera-session'

/**
 * Lifecycle regression guards for the ONE shared camera session.
 *
 * The old scanner page owned a raw `Html5Qrcode` inside an effect that
 * depended on the decode handler's identity. Every scan (and every busy
 * toggle) gave the handler a new identity → the effect tore the session down
 * and started a new one mid-scan → `stop()` cleared the viewport (white) and
 * the immediate `start()` raced the library's single-slot transition lock.
 *
 * These tests pin the contract: ONE session per open scanner, decodes never
 * restart it, and closing releases the device.
 */

const { instances, startCalls, startConfigs, stopCalls, trackStops } = vi.hoisted(() => ({
  instances: [] as any[],
  startCalls: [] as unknown[],
  startConfigs: [] as unknown[],
  stopCalls: [] as unknown[],
  trackStops: [] as number[],
}))

vi.mock('html5-qrcode', () => {
  class MockHtml5Qrcode {
    isScanning = false
    onSuccess?: (text: string) => void

    constructor(public elementId: string) {
      instances.push(this)
    }

    async start(
      _target: unknown,
      _config: unknown,
      onSuccess: (text: string) => void,
    ): Promise<void> {
      this.onSuccess = onSuccess
      startCalls.push(_target)
      startConfigs.push(_config)
      // The library injects its <video> into the mount element.
      const el = document.getElementById(this.elementId)
      if (el) {
        const video = document.createElement('video')
        const trackId = trackStops.length
        const track = {
          stop: () => {
            trackStops.push(trackId)
          },
        }
        // Chromium enforces the MediaStream type on srcObject — define the
        // property so the fake track can be inspected by the release path.
        Object.defineProperty(video, 'srcObject', {
          configurable: true,
          writable: true,
          value: { getTracks: () => [track] },
        })
        el.appendChild(video)
      }
      this.isScanning = true
    }

    async stop(): Promise<void> {
      stopCalls.push(this.elementId)
      this.isScanning = false
    }
  }
  return { Html5Qrcode: MockHtml5Qrcode, getCameras: vi.fn().mockResolvedValue([]) }
})

function Harness({
  active,
  onScan,
  cameraId,
}: {
  active: boolean
  onScan: (text: string) => void
  cameraId?: string
}) {
  const session = useCameraSession({ active, onScan, cameraId })
  return (
    <div>
      <div ref={session.containerRef} id={session.containerId} data-testid="viewport" />
      <span data-testid="status">{session.status}</span>
    </div>
  )
}

beforeEach(() => {
  instances.length = 0
  startCalls.length = 0
  startConfigs.length = 0
  stopCalls.length = 0
  trackStops.length = 0
})

describe('useCameraSession — one persistent session per open scanner', () => {
  it('starts the camera ONCE and keeps it alive across many decodes', async () => {
    const onScan = vi.fn()
    await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    const instance = instances[0]
    instance.onSuccess?.('ORD-1')
    instance.onSuccess?.('ORD-2')
    instance.onSuccess?.('ORD-3')

    expect(onScan).toHaveBeenCalledTimes(3)
    expect(startCalls).toHaveLength(1)
    expect(stopCalls).toHaveLength(0)
  })

  it('re-rendering with a NEW decode handler does not restart the camera', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = await render(<Harness active onScan={first} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    await rerender(<Harness active onScan={second} />)
    await new Promise((r) => setTimeout(r, 40))

    expect(startCalls).toHaveLength(1)
    expect(stopCalls).toHaveLength(0)
  })

  it('closing the camera stops the session ONCE and releases the device track', async () => {
    const onScan = vi.fn()
    const { rerender } = await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    await rerender(<Harness active={false} onScan={onScan} />)
    await vi.waitFor(() => expect(stopCalls).toHaveLength(1))

    // The camera indicator must go dark: the media track is stopped.
    await vi.waitFor(() => expect(trackStops.length).toBeGreaterThan(0))
  })

  it('emits a decoded value ONCE while it stays in view (30 consecutive decodes → 1 call)', async () => {
    const onScan = vi.fn()
    await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    const instance = instances[0]
    for (let i = 0; i < 30; i++) {
      instance.onSuccess?.('ORD-260930-0001')
    }
    await new Promise((r) => setTimeout(r, 60))

    // html5-qrcode fires the success callback per decoded frame (~10/s).
    // The value must be consumed ONCE.
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(startCalls).toHaveLength(1)
    expect(stopCalls).toHaveLength(0)
  })

  it('re-arms after the value has been absent for the gap → the same value fires again', async () => {
    const onScan = vi.fn()
    await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    const instance = instances[0]
    instance.onSuccess?.('SKU-1')
    expect(onScan).toHaveBeenCalledTimes(1)

    // Still in view → suppressed.
    instance.onSuccess?.('SKU-1')
    expect(onScan).toHaveBeenCalledTimes(1)

    // The label leaves the view; the gap elapses → re-armed.
    await new Promise((r) => setTimeout(r, 1400))
    instance.onSuccess?.('SKU-1')
    expect(onScan).toHaveBeenCalledTimes(2)
  })

  it('a different value intervenes → the new value fires immediately', async () => {
    const onScan = vi.fn()
    await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    const instance = instances[0]
    instance.onSuccess?.('SKU-1')
    instance.onSuccess?.('SKU-2')
    expect(onScan).toHaveBeenCalledTimes(2)
    expect(onScan).toHaveBeenLastCalledWith('SKU-2')
  })

  it('drops emissions while an async handler is in flight and releases the lock afterwards', async () => {
    let release: (() => void) | null = null
    const onScan = vi.fn(
      () => new Promise<void>((resolve) => {
        release = () => resolve()
      }),
    )
    await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    const instance = instances[0]
    instance.onSuccess?.('ORD-1')
    expect(onScan).toHaveBeenCalledTimes(1)

    // While the handler is in flight → further emissions are DROPPED.
    instance.onSuccess?.('ORD-2')
    instance.onSuccess?.('ORD-3')
    expect(onScan).toHaveBeenCalledTimes(1)

    release?.()
    await new Promise((r) => setTimeout(r, 20))
    // The lock is released: a new value is processed again.
    instance.onSuccess?.('ORD-4')
    expect(onScan).toHaveBeenCalledTimes(2)
  })

  it('renders the library <video> at its NATURAL size (1:1) so the scan region keeps mapping onto the frame', async () => {
    await render(<Harness active onScan={vi.fn()} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    // html5-qrcode samples the frame with `frameSize / elementClientSize`.
    // A CSS-scaled video makes that rectangle leave the frame as soon as the
    // viewport is resized (the order → item transition) — the decode canvas
    // then freezes on the last good frame and every scan dies in silence.
    await vi.waitFor(() => {
      const video = document.querySelector<HTMLVideoElement>('video')
      expect(video).toBeTruthy()
      expect(video?.style.position).toBe('absolute')
      expect(video?.style.width).toBe('auto')
      expect(video?.style.height).toBe('auto')
      expect(video?.style.transform).toBe('translate(-50%, -50%)')
    })
  })

  it('decodes a FULL-WIDTH band of the frame (1D labels are never truncated)', async () => {
    await render(<Harness active onScan={vi.fn()} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))

    // The library is handed the camera frame's native size; the scan region
    // must span the whole width and a centred band of the height.
    const config = startConfigs[0] as { qrbox: (w: number, h: number) => { width: number; height: number } }
    const region = config.qrbox(640, 480)
    expect(region.width).toBe(640)
    expect(region.height).toBe(336)
    // A 1D label held close spans (almost) the whole frame width — it must fit.
    expect(region.width).toBe(640)
    expect(region.height).toBeLessThan(480)
  })

  it('never leaves a painted frame behind: the viewport container is emptied on close', async () => {
    const onScan = vi.fn()
    const { rerender, container } = await render(<Harness active onScan={onScan} />)
    await vi.waitFor(() => expect(startCalls).toHaveLength(1))
    expect(container.querySelector('video')).not.toBeNull()

    await rerender(<Harness active={false} onScan={onScan} />)
    await vi.waitFor(() => expect(stopCalls).toHaveLength(1))
    await vi.waitFor(() => expect(container.querySelector('video')).toBeNull())
  })
})
