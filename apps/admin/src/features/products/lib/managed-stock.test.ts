import { describe, expect, it } from 'vitest'
import {
  canApplyManagedAdjustment,
  filterManagedStockProducts,
  isManagedAdjustableProduct,
  isManagedStockProduct,
  liveManagedReservationSummary,
  savedManagedQuantities,
  shouldShowModeSwitchClearNote,
} from './managed-stock'

describe('filterManagedStockProducts (modal search mode filter)', () => {
  const results = [
    { id: 'a', availabilityMode: 'MANAGED_STOCK' },
    { id: 'b', availabilityMode: 'INVENTORY_CONTROLLED' },
    { id: 'c', availabilityMode: 'ALWAYS_IN_STOCK' },
    { id: 'd', availabilityMode: 'ALWAYS_OUT_OF_STOCK' },
    { id: 'e', availabilityMode: 'MANAGED_STOCK' },
    { id: 'f' },
  ]

  it('keeps only MANAGED_STOCK products', () => {
    expect(filterManagedStockProducts(results).map((p) => p.id)).toEqual(['a', 'e'])
  })

  it('excludes combo-type products even in managed mode (no comboId wiring in the modal)', () => {
    const withCombo = [
      { id: 's', availabilityMode: 'MANAGED_STOCK', type: 'simple' },
      { id: 'v', availabilityMode: 'MANAGED_STOCK', type: 'variable' },
      { id: 'cb', availabilityMode: 'MANAGED_STOCK', type: 'combo' },
    ]
    expect(filterManagedStockProducts(withCombo).map((p) => p.id)).toEqual(['s', 'v'])
    expect(isManagedAdjustableProduct({ availabilityMode: 'MANAGED_STOCK', type: 'combo' })).toBe(false)
    expect(isManagedAdjustableProduct({ availabilityMode: 'MANAGED_STOCK', type: 'simple' })).toBe(true)
    expect(isManagedAdjustableProduct({ availabilityMode: 'MANAGED_STOCK', type: 'variable' })).toBe(true)
    expect(isManagedAdjustableProduct({ availabilityMode: 'INVENTORY_CONTROLLED', type: 'simple' })).toBe(false)
    expect(isManagedAdjustableProduct(null)).toBe(false)
  })

  it('isManagedStockProduct matches only the managed mode', () => {
    expect(isManagedStockProduct({ availabilityMode: 'MANAGED_STOCK' })).toBe(true)
    expect(isManagedStockProduct({ availabilityMode: 'INVENTORY_CONTROLLED' })).toBe(false)
    expect(isManagedStockProduct({})).toBe(false)
    expect(isManagedStockProduct(null)).toBe(false)
    expect(isManagedStockProduct(undefined)).toBe(false)
  })
})

describe('canApplyManagedAdjustment (modal Apply gate)', () => {
  it('simple product: product + non-zero quantity is enough', () => {
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: false })).toBe(true)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '-3', isVariable: false })).toBe(true)
  })

  it('variable product: a variant is REQUIRED', () => {
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: true, variantId: '' })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: true, variantId: undefined })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: true, variantId: 'v1' })).toBe(true)
  })

  it('no product or zero/blank quantity blocks apply', () => {
    expect(canApplyManagedAdjustment({ productId: '', quantity: '5', isVariable: false })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '0', isVariable: false })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '', isVariable: false })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: 'abc', isVariable: false })).toBe(false)
  })

  it('pre-fill bypass: a supplied loaded mode must be MANAGED_STOCK (non-managed or not-yet-loaded blocks apply)', () => {
    // Pre-filled via Products list / Stock page — search filter never ran.
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: false, availabilityMode: 'INVENTORY_CONTROLLED' })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: false, availabilityMode: 'ALWAYS_IN_STOCK' })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: false, availabilityMode: 'ALWAYS_OUT_OF_STOCK' })).toBe(false)
    // Detail fetch for the CURRENT product has not landed yet (null) — a
    // stale MANAGED_STOCK from a previous product must not green-light it.
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: false, availabilityMode: null })).toBe(false)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: false, availabilityMode: 'MANAGED_STOCK' })).toBe(true)
    expect(canApplyManagedAdjustment({ productId: 'p1', quantity: '5', isVariable: true, variantId: 'v1', availabilityMode: 'MANAGED_STOCK' })).toBe(true)
  })
})

describe('savedManagedQuantities (mode-switch note data)', () => {
  it('simple product: single row with the saved product quantity', () => {
    expect(
      savedManagedQuantities({ name: 'Tee', type: 'simple', managedStockQuantity: 12, variants: [] }),
    ).toEqual([{ label: 'Tee', quantity: 12 }])
  })

  it('variable product: every variant, including zero and negative quantities', () => {
    const rows = savedManagedQuantities({
      name: 'Hoodie',
      type: 'variable',
      managedStockQuantity: 3,
      variants: [
        {
          sku: 'HD-S',
          managedStockQuantity: 5,
          attributeValues: [{ attributeValue: { value: 'S' } }],
        },
        {
          sku: 'HD-M',
          managedStockQuantity: 0,
          attributeValues: [{ attributeValue: { value: 'M' } }],
        },
        {
          sku: 'HD-L',
          managedStockQuantity: -2,
          attributeValues: [{ attributeValue: { value: 'L' } }],
        },
      ],
    })
    expect(rows).toEqual([
      { label: 'S', sku: 'HD-S', quantity: 5 },
      { label: 'M', sku: 'HD-M', quantity: 0 },
      { label: 'L', sku: 'HD-L', quantity: -2 },
    ])
  })

  it('missing quantities read as 0; null product yields no rows', () => {
    expect(savedManagedQuantities({ name: 'X', type: 'simple' })).toEqual([
      { label: 'X', quantity: 0 },
    ])
    expect(savedManagedQuantities(null)).toEqual([])
    expect(savedManagedQuantities(undefined)).toEqual([])
  })
})

describe('liveManagedReservationSummary (mode-switch note live count)', () => {
  it('sums managed holds only — physical rows never count toward the managed switch', () => {
    expect(
      liveManagedReservationSummary([
        { id: 'r1', isManaged: true, reservedQuantity: 3 },
        { id: 'r2', isManaged: true, reservedQuantity: 2 },
        { id: 'r3', isManaged: false, reservedQuantity: 9 },
        { id: 'r4', reservedQuantity: 7 },
      ]),
    ).toEqual({ units: 5, holds: 2 })
  })

  it('non-array payloads (loading / error) count as zero, never crash', () => {
    expect(liveManagedReservationSummary(undefined)).toEqual({ units: 0, holds: 0 })
    expect(liveManagedReservationSummary(null)).toEqual({ units: 0, holds: 0 })
    expect(liveManagedReservationSummary([])).toEqual({ units: 0, holds: 0 })
  })
})

describe('shouldShowModeSwitchClearNote', () => {
  it('shows only for an existing managed product switched away from managed', () => {
    expect(
      shouldShowModeSwitchClearNote({
        isExisting: true,
        savedMode: 'MANAGED_STOCK',
        currentMode: 'INVENTORY_CONTROLLED',
      }),
    ).toBe(true)
    expect(
      shouldShowModeSwitchClearNote({
        isExisting: true,
        savedMode: 'MANAGED_STOCK',
        currentMode: 'ALWAYS_IN_STOCK',
      }),
    ).toBe(true)
  })

  it('hidden when the mode is untouched, the product is new, or the saved mode was never managed', () => {
    expect(
      shouldShowModeSwitchClearNote({
        isExisting: true,
        savedMode: 'MANAGED_STOCK',
        currentMode: 'MANAGED_STOCK',
      }),
    ).toBe(false)
    expect(
      shouldShowModeSwitchClearNote({
        isExisting: false,
        savedMode: undefined,
        currentMode: 'INVENTORY_CONTROLLED',
      }),
    ).toBe(false)
    expect(
      shouldShowModeSwitchClearNote({
        isExisting: true,
        savedMode: 'INVENTORY_CONTROLLED',
        currentMode: 'ALWAYS_IN_STOCK',
      }),
    ).toBe(false)
  })
})
