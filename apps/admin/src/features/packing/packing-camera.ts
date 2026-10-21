export type PackingTab = 'scan' | 'packed' | 'held'

/**
 * Is the packing camera session supposed to be live?
 *
 * Root cause this encodes: the session used to be torn down the moment an
 * order was selected (`!selectedOrderId` in the start condition) while the
 * viewport chrome kept painting. The operator saw a "live" frame with no
 * video in it (a solid dark disc), the camera could not verify product
 * barcodes at all, and the dead disc covered the packed counter and the
 * verify row.
 *
 * The session is bound to the SCAN TAB, not to the order: it must survive the
 * order → item transition (that is when products are verified with the
 * camera) and it is released when the operator leaves the tab or pauses it.
 */
export function packingCameraActive(opts: {
  activeTab: PackingTab
  scannerActive: boolean
  cameraId: string
}): boolean {
  return opts.activeTab === 'scan' && opts.scannerActive && !!opts.cameraId
}
