import { describe, expect, it } from 'vitest'
import {
  ITEM_EDIT_BLOCKED_STATUSES,
  ITEM_EDIT_WARNING_STATUSES,
  itemsEditableInStatus,
  itemsNeedWarningInStatus,
} from './item-edit-policy'

/**
 * The admin-side mirror of the backend item-edit status gate. These are pure
 * predicates — no DOM, no mocks — so they can be pinned cheaply and will not
 * rot like a component test does.
 *
 * If the backend sets change (apps/backend/src/orders/order-transitions.ts),
 * these lists MUST change with them.
 */

describe('item-edit policy', () => {
  it('blocks item edits once goods have left the warehouse', () => {
    for (const s of ['Shipping', 'Delivered', 'Partial', 'Return Pending', 'Returned', 'Damaged']) {
      expect(ITEM_EDIT_BLOCKED_STATUSES).toContain(s)
      expect(itemsEditableInStatus(s)).toBe(false)
    }
  })

  it('allows item edits before dispatch', () => {
    for (const s of ['Pending', 'Payment Pending', 'Payment Verifying', 'Hold', 'Confirmed', 'Cancelled']) {
      expect(itemsEditableInStatus(s)).toBe(true)
      expect(itemsNeedWarningInStatus(s)).toBe(false)
    }
  })

  it('allows but warns for Packed / Packing Hold', () => {
    for (const s of ['Packed', 'Packing Hold']) {
      expect(itemsEditableInStatus(s)).toBe(true)
      expect(itemsNeedWarningInStatus(s)).toBe(true)
    }
  })

  it('treats an unknown or missing status as editable (fail open in the UI only)', () => {
    // The API remains the authority — this only avoids hiding controls that
    // would be rejected. Fail OPEN here so a new backend status is never
    // accidentally read-only in the UI.
    expect(itemsEditableInStatus(undefined)).toBe(true)
    expect(itemsEditableInStatus(null)).toBe(true)
    expect(itemsEditableInStatus('Some Brand New Status')).toBe(true)
    expect(itemsNeedWarningInStatus('Some Brand New Status')).toBe(false)
  })

  it('never lists a status in both tiers', () => {
    const overlap = ITEM_EDIT_BLOCKED_STATUSES.filter(s => ITEM_EDIT_WARNING_STATUSES.includes(s))
    expect(overlap).toEqual([])
  })
})