import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createScanner, type CameraStartTarget, type ScannerController } from './camera-controller'
import { createEmissionGate, type EmissionGate } from './emission-gate'

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
  /**
   * Decoded text. The identity of this callback never restarts the session.
   * Returning a promise keeps the processing lock held until it settles.
   */
  onScan: (decodedText: string) => void | Promise<void>
  onError?: (err: unknown) => void
  /** Explicit camera device id; when empty the rear-facing camera is used. */
  cameraId?: string
  fps?: number
  /**
   * Height of the decode region as a fraction of the camera frame height. The
   * region always spans the FULL frame width (see `buildQrBox`).
   */
  qrboxHeightRatio?: number
  /**
   * How long a decoded value must be ABSENT from the decodes before the very
   * same value may fire again (default 1200ms).
   */
  rearmGapMs?: number
}

/** html5-qrcode refuses a scan region smaller than this (in frame pixels). */
const MIN_QR_BOX_SIZE = 50

/**
 * The DECODE REGION of a camera frame: always the FULL frame width, plus a
 * centred horizontal band of `heightRatio` of the frame height.
 *
 * Why not a centred square (the old `min(width, height) * 0.75`):
 *
 *  1. A square crop TRUNCATES wide 1D labels. A packer holds a Code39/Code128
 *     SKU label close to the lens, so it spans most of the frame width; the
 *     75% crop cut off both ends, the symbol was incomplete, the decoder found
 *     nothing and the screen showed a live feed with no scan and no error.
 *  2. The library only draws its "shaded region" overlay when the scan region
 *     is STRICTLY smaller than the frame (`width - qrbox.width < 1` → skip).
 *     That overlay is a div with four border bands sized in FRAME pixels, so
 *     inside a small viewport it covered everything except a cross-shaped
 *     window — the big green "+" that was painted over the camera feed.
 *     A full-width region makes the library skip it entirely.
 *  3. The crop selects pixels, it never rescales them: a wider region costs a
 *     little more decode work but adds no loss of detail.
 */
export function buildQrBox(
  width: number,
  height: number,
  heightRatio = 0.7,
): { width: number; height: number } {
  const band = Math.round(height * heightRatio)
  return {
    width: Math.round(width),
    height: Math.min(Math.round(height), Math.max(MIN_QR_BOX_SIZE, band)),
  }
}

/**
 * Render the library's <video> at its NATURAL size (1:1), centred inside the
 * viewport and clipped by it.
 *
 * This is the root of the "live video, but nothing ever scans" symptom.
 * html5-qrcode maps the scan region onto the camera frame with
 *
 *     scale = frameSize / elementClientSize
 *
 * i.e. it assumes the video is displayed at 1:1 CSS pixels. As long as the
 * element is CSS-scaled, the source rectangle it samples leaves the frame as
 * soon as the element is RESIZED — and the packing workspace resizes it on
 * every order → item transition (the viewport collapses into the small
 * picture-in-picture). The sampled rectangle then no longer exists, the decode
 * canvas keeps the last good frame (the order QR) and every later scan is
 * decoded from that stale image: the operator sees a live feed, a product
 * barcode is recognised by nobody, and nothing reports an error.
 *
 * Rendering the video 1:1 keeps `scale === 1` at ANY element size, so the
 * region always maps exactly onto the frame — before and after any resize.
 */
export function applyNativeVideoStyles(container: HTMLElement): void {
  const video = container.querySelector('video')
  if (!video) return
  const style = video.style
  style.position = 'absolute'
  style.left = '50%'
  style.top = '50%'
  style.transform = 'translate(-50%, -50%)'
  style.width = 'auto'
  style.height = 'auto'
  style.maxWidth = 'none'
  style.maxHeight = 'none'
  style.objectFit = 'fill'
}

export function useCameraSession(options: CameraSessionOptions): CameraSession {
  const { active, cameraId, fps = 15, qrboxHeightRatio = 0.7, rearmGapMs = 1200 } = options

  const rawId = useId()
  const containerId = `camera-viewport-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [status, setStatus] = useState<CameraSessionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [restartKey, setRestartKey] = useState(0)

  const controllerRef = useRef<ScannerController | null>(null)
  const videoObserverRef = useRef<MutationObserver | null>(null)
  // The decode handler lives in a ref: a new callback identity must never
  // tear the session down (that was the white-viewport root cause).
  const onScanRef = useRef(options.onScan)
  onScanRef.current = options.onScan
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError

  const containerRef = useCallback((el: HTMLElement | null) => {
    setContainer((prev) => (prev === el ? prev : el))
  }, [])

  /**
   * One-shot + re-arm + processing lock (the shared emission gate).
   *
   * html5-qrcode calls the success callback for EVERY decoded frame (~10/s
   * for a label held in view). Without the gate one label produced a
   * continuous stream of actions (the packing "Wrong Product!" flood).
   *
   * The gate is created ONCE and reads the decode handler from a ref, so a
   * new callback identity never restarts the session nor the gate.
   */
  const gateRef = useRef<EmissionGate | null>(null)
  if (!gateRef.current) {
    gateRef.current = createEmissionGate({
      rearmGapMs,
      onEmit: (value) => onScanRef.current(value),
    })
  }
  const emitDecoded = useCallback((decodedText: string) => {
    gateRef.current?.push(decodedText)
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
        // Full frame width + a centred band: 1D labels are never truncated and
        // the library draws no cross-shaped shading overlay over the feed.
        qrbox: (width: number, height: number) => buildQrBox(width, height, qrboxHeightRatio),
      },
      {
        onScan: (decodedText) => {
          if (cancelled) return
          emitDecoded(decodedText)
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

    // The <video> must be 1:1 BEFORE the library measures it: html5-qrcode
    // derives the scan region from `video.clientWidth/clientHeight` (the
    // "viewfinder") and samples the frame with `frameSize / videoClientSize`.
    // A CSS-scaled video breaks that mapping the moment the viewport is
    // resized — the order → item transition — and the decode canvas then
    // freezes on the last good frame (the order QR): live video, no scans,
    // no error. The observer applies the styles the instant the library
    // inserts the <video>, and again whenever it is re-created.
    const host = document.getElementById(containerId)
    if (host) {
      applyNativeVideoStyles(host)
      const observer = new MutationObserver(() => applyNativeVideoStyles(host))
      observer.observe(host, { childList: true, subtree: true })
      videoObserverRef.current = observer
    }

    void controller.start(target).then(() => {
      if (cancelled || failed) return
      const startedHost = document.getElementById(containerId)
      if (startedHost) applyNativeVideoStyles(startedHost)
      setStatus(controller.getState() === 'scanning' ? 'scanning' : 'idle')
    })

    return () => {
      cancelled = true
      controllerRef.current = null
      videoObserverRef.current?.disconnect()
      videoObserverRef.current = null
      gateRef.current?.dispose()
      void controller.dispose()
    }
    // `onScan` is intentionally NOT a dependency — it is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, container, cameraId, containerId, fps, qrboxHeightRatio, restartKey, emitDecoded])

  return {
    containerId,
    containerRef,
    status,
    isLive: status === 'scanning',
    error,
    restart,
  }
}
