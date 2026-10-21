import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useRef, useState } from 'react'
import { useCameraSession } from '@/features/camera/use-camera-session'
import { createMismatchToastGate, isOrderReference, routePackingScan } from './packing-scan'

/**
 * The packing scan FLOOD, end to end (real shared camera session + real
 * routing module, mocked camera library).
 *
 * Production incident (2026-10-21, physical phone): scanning the order QR
 * opened the order, then the SAME value kept arriving on the item screen and
 * produced an endless stream of "Wrong Product!" toasts (10–15/s).
 *
 * The four proofs:
 *  (a) the order URL opens the order ONCE and the item screen stays silent —
 *      even when the same label is presented again after the re-arm gap;
 *  (b) the same value 30× in a row → the handler fires ONCE;
 *  (c) a wrong SKU → exactly ONE toast (stable id) → the correct SKU verifies;
 *  (d) same SKU → verify → gap → same SKU → verifies TWICE (re-arm works).
 */

const { instances } = vi.hoisted(() => ({ instances: [] as any[] }))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    isScanning = false
    static getCameras = vi.fn().mockResolvedValue([])
    onSuccess?: (text: string) => void
    constructor(public elementId: string) {
      instances.push(this)
    }
    start = vi.fn((_target: unknown, _config: unknown, onSuccess: (t: string) => void) => {
      this.onSuccess = onSuccess
      return Promise.resolve()
    })
    stop = vi.fn(() => Promise.resolve())
  },
}))

const ORDER_URL = 'https://www.avelto.bd/orders/ORD-261021-0023'
const CORRECT_SKU = 'SKU-BLU-M'

function Harness({
  onOrder,
  onVerify,
  onToast,
}: {
  onOrder: (code: string) => void
  onVerify: (code: string) => void
  onToast: (toast: { id: string; message: string }) => void
}) {
  const [orderOpen, setOrderOpen] = useState(false)
  const orderOpenRef = useRef(false)
  orderOpenRef.current = orderOpen
  const gateRef = useRef(createMismatchToastGate(4000))

  const session = useCameraSession({
    active: true,
    onScan: (raw) =>
      routePackingScan(raw, {
        orderOpen: orderOpenRef.current,
        onOrder: (code) => {
          setOrderOpen(true)
          onOrder(code)
        },
        onProduct: (code) => {
          // Mirrors the packing page's product handler.
          if (isOrderReference(code)) return
          if (code === CORRECT_SKU) {
            onVerify(code)
            return
          }
          if (!gateRef.current.shouldToast(code, Date.now())) return
          onToast({
            id: 'packing-wrong-product',
            message: `Wrong Product! SKU "${code}" does not belong to this order!`,
          })
        },
      }),
  })

  return <div ref={session.containerRef} id={session.containerId} data-testid="viewport" />
}

let onOrder: ReturnType<typeof vi.fn>
let onVerify: ReturnType<typeof vi.fn>
let onToast: ReturnType<typeof vi.fn>

async function renderHarness() {
  return render(
    <Harness onOrder={onOrder} onVerify={onVerify} onToast={onToast} />,
  )
}

const decode = (value: string) => {
  const instance = instances[instances.length - 1]
  instance.onSuccess?.(value)
}

beforeEach(() => {
  instances.length = 0
  onOrder = vi.fn()
  onVerify = vi.fn()
  onToast = vi.fn()
})

describe('packing scan flood — production incident regression', () => {
  it('(a) the order URL opens the order once and the item screen stays silent', async () => {
    await renderHarness()
    await vi.waitFor(() => expect(instances).toHaveLength(1))

    // The order label is presented.
    decode(ORDER_URL)
    await vi.waitFor(() => expect(onOrder).toHaveBeenCalledTimes(1))
    expect(onOrder).toHaveBeenCalledWith('ORD-261021-0023')

    // NO further decodes → nothing may be re-processed (no stored-value effect).
    await new Promise((r) => setTimeout(r, 1500))
    expect(onToast).toHaveBeenCalledTimes(0)
    expect(onVerify).toHaveBeenCalledTimes(0)

    // The same label presented again AFTER the re-arm gap: the item step must
    // ignore an order reference SILENTLY (never a wrong-SKU error).
    await new Promise((r) => setTimeout(r, 1400))
    decode(ORDER_URL)
    await new Promise((r) => setTimeout(r, 100))
    expect(onToast).toHaveBeenCalledTimes(0)
  })

  it('(b) the same value 30× in a row → the handler fires ONCE', async () => {
    await renderHarness()
    await vi.waitFor(() => expect(instances).toHaveLength(1))

    for (let i = 0; i < 30; i++) decode(ORDER_URL)
    await new Promise((r) => setTimeout(r, 100))

    expect(onOrder).toHaveBeenCalledTimes(1)
    expect(onToast).toHaveBeenCalledTimes(0)
  })

  it('(c) a wrong SKU → exactly ONE toast, then the correct SKU verifies', async () => {
    await renderHarness()
    await vi.waitFor(() => expect(instances).toHaveLength(1))
    decode(ORDER_URL)
    await vi.waitFor(() => expect(onOrder).toHaveBeenCalledTimes(1))
    // The item screen arms one tick after the order opens.
    await new Promise((r) => setTimeout(r, 50))

    decode('WRONG-SKU')
    await new Promise((r) => setTimeout(r, 100))
    expect(onToast).toHaveBeenCalledTimes(1)
    expect(onToast.mock.calls[0][0].id).toBe('packing-wrong-product')

    // The correct SKU still verifies.
    decode(CORRECT_SKU)
    await new Promise((r) => setTimeout(r, 100))
    expect(onVerify).toHaveBeenCalledTimes(1)
    expect(onVerify).toHaveBeenCalledWith(CORRECT_SKU)
  })

  it('(d) same SKU → verify → gap → same SKU → verifies TWICE (re-arm works)', async () => {
    await renderHarness()
    await vi.waitFor(() => expect(instances).toHaveLength(1))
    decode(ORDER_URL)
    await vi.waitFor(() => expect(onOrder).toHaveBeenCalledTimes(1))
    // The item screen arms one tick after the order opens.
    await new Promise((r) => setTimeout(r, 50))

    decode(CORRECT_SKU)
    await new Promise((r) => setTimeout(r, 100))
    expect(onVerify).toHaveBeenCalledTimes(1)

    // Still in view → suppressed (no double verification).
    decode(CORRECT_SKU)
    await new Promise((r) => setTimeout(r, 100))
    expect(onVerify).toHaveBeenCalledTimes(1)

    // The label leaves the view; the gap elapses → re-armed.
    await new Promise((r) => setTimeout(r, 1400))
    decode(CORRECT_SKU)
    await new Promise((r) => setTimeout(r, 100))
    expect(onVerify).toHaveBeenCalledTimes(2)
  })
})
