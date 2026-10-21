import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createScanner, type CameraStartTarget, type ScannerController } from './camera-controller'

/**
 * ONE camera session for the whole admin.
 *
 * Root cause this fixes (see the branch commit): every integration used to
 * own its own `html5-qrcode` lifecycle, and the scanner page's lifecycle was
 * wired to the identity of its decode handler. A decode (or any busy-state
 * flip) produced a new handler → the effect cleaned up (`stop()` — the library
 * clears the viewport, so it paints white) and immediately started a second
 * session, which raced the library's single-slot transition lock. The packing
 * workspace had the mirror-image bug: its session was torn down the moment an
 * order was selected while the viewport chrome kept painting, so the operator
 * saw a "live" frame with no video in it.
 *
 * The contract here:
 *  - ONE session per open scanner; `start` runs once, `stop` runs once.
 *  - Decodes and re-renders NEVER restart the session (the handler is read
 *    from a ref).
 *  - The stream is released only on explicit close / unmount, and the media
 *    tracks are stopped so the device camera indicator goes dark.
 *  - The viewport container is a stable node the library owns; React never
 *    re-creates it, so the video element is never remounted.
 */

export type CameraSessionStatus = 'idle' | 'starting' | 'scanning' | 'stopping' | 'error'

export interface CameraSession {
  /** Stable DOM id of the viewport container (the library writes into it). */
  containerId: string
  /** Ref callback for the viewport container — attach it to a real node. */
  containerRef: (el: HTMLElement | null) => void
  status: CameraSessionStatus
  /** True only while the camera stream is live. */
  isLive: boolean
  error: string | null
  /** Restart the session (explicit operator action only). */
  restart: () => void
}

export interface CameraSessionOptions {
  /** The scanner is open — one session lives exactly as long as this is true. */
  active: boolean
  /** Decoded text. The identity of this callback never restarts the session. */
  onScan: (decodedText: string) => void
  onError?: (err: unknown) => void
  /** Explicit camera device id; when empty the rear-facing camera is used. */
  cameraId?: string
  fps?: number
  /** Scan-window size as a fraction of the smaller viewport side. */
  qrboxRatio?: number
}

export function useCameraSession(options: CameraSessionOptions): CameraSession {
  const { active, cameraId, fps = 15, qrboxRatio = 0.75 } = options

  const rawId = useId()
  const containerId = `camera-viewport-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [status, setStatus] = useState<CameraSessionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [restartKey, setRestartKey] = useState(0)

  const controllerRef = useRef<ScannerController | null>(null)
  // The decode handler lives in a ref: a new callback identity must never
  // tear the session down (that was the white-viewport root cause).
  const onScanRef = useRef(options.onScan)
  onScanRef.current = options.onScan
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError

  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer((prev) => (prev === el ? prev : el))
  }, [])

  const restart = useCallback(() => {
    setRestartKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!active || !container) {
      // Explicit close (or unmount): release the device exactly once.
      const controller = controllerRef.current
      controllerRef.current = null
      if (controller) {
        setStatus('stopping')
        void controller.dispose().finally(() => setStatus('idle'))
      } else {
        setStatus('idle')
      }
      return
    }

    let cancelled = false
    let failed = false
    setError(null)
    setStatus('starting')

    const controller = createScanner(
      containerId,
      {
        fps,
        qrbox: (width: number, height: number) => {
          const size = Math.min(width, height) * qrboxRatio
          return { width: size, height: size }
        },
      },
      {
        onScan: (decodedText) => {
          if (cancelled) return
          onScanRef.current(decodedText)
        },
        onError: (err) => {
          if (cancelled) return
          failed = true
          console.error('Camera scanner error', err)
          setStatus('error')
          setError('Camera is currently in use or not responding.')
          onErrorRef.current?.(err)
        },
      },
    )
    controllerRef.current = controller

    const target: CameraStartTarget = cameraId || { facingMode: 'environment' }
    void controller.start(target).then(() => {
      if (cancelled || failed) return
      setStatus(controller.getState() === 'scanning' ? 'scanning' : 'idle')
    })

    return () => {
      cancelled = true
      controllerRef.current = null
      void controller.dispose()
    }
    // `onScan` is intentionally NOT a dependency — it is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, container, cameraId, containerId, fps, qrboxRatio, restartKey])

  return {
    containerId,
    containerRef,
    status,
    isLive: status === 'scanning',
    error,
    restart,
  }
}
