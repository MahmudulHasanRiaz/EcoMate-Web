import { describe, expect, it } from 'vitest'
import {
  isPhysicalStockConfirmError,
  resolvePhysicalStockConfirmError,
  type PhysicalStockOrderLine,
} from './physical-stock-confirm-error'

/**
 * Confirm-gate physical-stock failures (2026-11-24 inventory fix round,
 * Issue 4): the backend throws a plain BadRequestException with a
 * message only, so detection is message-based. Every message shape the
 * gate can throw (apps/backend/src/orders/orders.service.ts) is locked
 * here, in English and Bengali — plus the near-miss that must NOT match.
 */
describe('isPhysicalStockConfirmError', () => {
  it.each([
    // IC branch / reservation-time, no record
    'Insufficient physical stock. No physical inventory record found.',
    // IC branch, not enough
    'Insufficient physical stock. Available: 2, needed: 5.',
    // IC branch, named product
    'Insufficient physical stock for "Eco Bag". No physical inventory record found.',
    'Insufficient physical stock for "Eco Bag". Available: 1, needed: 3.',
    // Combo component (confirm path)
    'Insufficient physical stock for combo component "Cotton Tee". Available: 0, needed: 2.',
    // Combo (create-path wording, same gate family)
    'Insufficient physical stock for "Gift Box" in combo. Available: 0, needed: 1.',
    // MS branch, Bengali — no record
    '"Eco Bag" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।',
    // MS branch, Bengali — not enough
    '"Eco Bag" এর Physical Stock অপর্যাপ্ত। Available: 1, Needed: 3। Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।',
  ])('detects the gate failure: %s', (message) => {
    expect(isPhysicalStockConfirmError(message)).toBe(true)
  })

  it.each([
    // Managed-only shortage — different fix path, must NOT offer physical stock
    'Insufficient stock for "Eco Bag". Available: 2, needed: 5.',
    'Update failed. Please try again.',
    'This order has outstanding paid balance — refund it first.',
    '',
  ])('does not match other failures: %s', (message) => {
    expect(isPhysicalStockConfirmError(message)).toBe(false)
  })
})

describe('resolvePhysicalStockConfirmError', () => {
  const lines: PhysicalStockOrderLine[] = [
    {
      productId: 'p1',
      variantId: null,
      product: { id: 'p1', name: 'Eco Bag' },
    },
    {
      productId: 'p2',
      variantId: 'v2',
      product: { id: 'p2', name: 'Cotton Tee' },
    },
  ]

  it('returns null for a non-gate error', () => {
    expect(
      resolvePhysicalStockConfirmError('Insufficient stock for "Eco Bag". Available: 2, needed: 5.', lines),
    ).toBeNull()
  })

  it('matches the named product to its order line (English)', () => {
    const res = resolvePhysicalStockConfirmError(
      'Insufficient physical stock for "Eco Bag". Available: 1, needed: 3.',
      lines,
    )
    expect(res).toMatchObject({
      productId: 'p1',
      productName: 'Eco Bag',
      variantId: null,
    })
    expect(res?.message).toContain('Insufficient physical stock')
  })

  it('matches the named product to its order line (Bengali, no-record)', () => {
    const res = resolvePhysicalStockConfirmError(
      '"Eco Bag" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।',
      lines,
    )
    expect(res).toMatchObject({ productId: 'p1', productName: 'Eco Bag' })
  })

  it('matches the named product to its order line (Bengali, not enough)', () => {
    const res = resolvePhysicalStockConfirmError(
      '"Cotton Tee" এর Physical Stock অপর্যাপ্ত। Available: 1, Needed: 3। Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।',
      lines,
    )
    expect(res).toMatchObject({
      productId: 'p2',
      productName: 'Cotton Tee',
      variantId: 'v2',
    })
  })

  it('keeps the product name but no productId when the named product is not an order line (combo component)', () => {
    const res = resolvePhysicalStockConfirmError(
      'Insufficient physical stock for combo component "Silk Scarf". Available: 0, needed: 2.',
      lines,
    )
    expect(res).toMatchObject({ productName: 'Silk Scarf' })
    expect(res?.productId).toBeUndefined()
  })

  it('falls back to the single product line when the error names no product', () => {
    const res = resolvePhysicalStockConfirmError(
      'Insufficient physical stock. No physical inventory record found.',
      [lines[0]],
    )
    expect(res).toMatchObject({ productId: 'p1', productName: 'Eco Bag' })
  })

  it('does not guess a product when the error names none and several lines exist', () => {
    const res = resolvePhysicalStockConfirmError(
      'Insufficient physical stock. Available: 2, needed: 5.',
      lines,
    )
    expect(res).not.toBeNull()
    expect(res?.productId).toBeUndefined()
    expect(res?.productName).toBeUndefined()
  })

  it('ignores manual lines in the single-line fallback', () => {
    const res = resolvePhysicalStockConfirmError(
      'Insufficient physical stock. No physical inventory record found.',
      [
        { productId: null, isManual: true, product: null },
        lines[0],
      ],
    )
    expect(res).toMatchObject({ productId: 'p1', productName: 'Eco Bag' })
  })

  it('returns the reason with no product when the order has no items', () => {
    const res = resolvePhysicalStockConfirmError(
      'Insufficient physical stock. No physical inventory record found.',
      [],
    )
    expect(res).not.toBeNull()
    expect(res?.productId).toBeUndefined()
  })
})
