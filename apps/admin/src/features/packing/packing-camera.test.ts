import { describe, expect, it } from 'vitest'
import { packingCameraActive } from './packing-camera'

/**
 * Regression guard for the packing camera session.
 *
 * The session used to be stopped the moment an order was selected while the
 * viewport kept painting its "live" chrome — the owner saw a solid dark disc
 * (no video) on the item screen and the camera could not verify products.
 * The decision therefore depends on the TAB and the camera state only —
 * never on whether an order is open.
 */
describe('packing camera session', () => {
  it('stays live while an order is open (products are verified with the camera)', () => {
    // The decision takes NO order argument on purpose: opening an order can
    // never take the camera down.
    expect(packingCameraActive({ activeTab: 'scan', scannerActive: true, cameraId: 'cam-1' })).toBe(true)
  })

  it('is off before a camera source is resolved', () => {
    expect(packingCameraActive({ activeTab: 'scan', scannerActive: true, cameraId: '' })).toBe(false)
  })

  it('is off when the operator pauses the camera', () => {
    expect(packingCameraActive({ activeTab: 'scan', scannerActive: false, cameraId: 'cam-1' })).toBe(false)
  })

  it('is off on the other tabs (the device is released)', () => {
    expect(packingCameraActive({ activeTab: 'packed', scannerActive: true, cameraId: 'cam-1' })).toBe(false)
    expect(packingCameraActive({ activeTab: 'held', scannerActive: true, cameraId: 'cam-1' })).toBe(false)
  })
})
