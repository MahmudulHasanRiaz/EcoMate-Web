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

const { instances, startCalls, stopCalls, trackStops } = vi.hoisted(() => ({
  instances: [] as any[],
  startCalls: [] as unknown[],
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
