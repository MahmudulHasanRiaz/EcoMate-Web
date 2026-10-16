import { describe, expect, it } from 'vitest'
import { dedupePhysicalVariants } from '../dedupe-physical-variants'

const base = {
  variantId: 'var-1',
  variant: { id: 'var-1', sku: 'TEE-S', attributeValues: [] },
}

describe('dedupePhysicalVariants', () => {
  it('collapses rows of the same variant across warehouse/bin into one row', () => {
    const out = dedupePhysicalVariants([
      { ...base, id: 'pi-1', quantity: 7, reservedQuantity: 1, warehouse: { name: 'Main Warehouse' }, binLocation: { code: 'A-01' }, updatedAt: '2026-01-01T00:00:00Z' },
      { ...base, id: 'pi-2', quantity: 2, reservedQuantity: 0, warehouse: { name: 'Overflow' }, binLocation: { code: 'B-02' }, updatedAt: '2026-02-01T00:00:00Z' },
    ])

    expect(out).toHaveLength(1)
    expect(out[0].quantity).toBe(9)
    expect(out[0].reservedQuantity).toBe(1)
    expect(out[0].warehouse?.name).toBe('Main Warehouse · Overflow')
    expect(out[0].binLocation?.code).toBe('A-01 · B-02')
    expect(out[0].updatedAt).toBe('2026-02-01T00:00:00Z')
  })

  it('keeps distinct variants apart and sorts by SKU regardless of input order', () => {
    const out = dedupePhysicalVariants([
      { id: 'pi-s', variantId: 'var-s', variant: { id: 'var-s', sku: 'TEE-S' }, quantity: 1 },
      { id: 'pi-m', variantId: 'var-m', variant: { id: 'var-m', sku: 'TEE-M' }, quantity: 3 },
    ])

    expect(out.map((v) => v.variant?.sku)).toEqual(['TEE-M', 'TEE-S'])
  })

  it('keeps virtual (no physical stock) entries and sorts them with the rest', () => {
    const out = dedupePhysicalVariants([
      { id: 'pi-1', variantId: 'var-1', variant: { id: 'var-1', sku: 'TEE-S' }, quantity: 5 },
      { id: 'virtual-var-2', variantId: 'var-2', variant: { id: 'var-2', sku: 'TEE-M' }, quantity: 0, reservedQuantity: 0, warehouse: null, binLocation: null, updatedAt: null, _virtual: true },
    ])

    expect(out.map((v) => v.variant?.sku)).toEqual(['TEE-M', 'TEE-S'])
    expect(out[0]._virtual).toBe(true)
    expect(out[0].quantity).toBe(0)
  })

  it('does not merge rows without a variant key (null variantId stays per record)', () => {
    const out = dedupePhysicalVariants([
      { id: 'pi-a', variantId: null, quantity: 2 },
      { id: 'pi-b', variantId: null, quantity: 4 },
    ])

    expect(out).toHaveLength(2)
  })

  it('leaves a single row untouched (quantity and location shape preserved)', () => {
    const out = dedupePhysicalVariants([
      { ...base, id: 'pi-1', quantity: 7, reservedQuantity: 1, warehouse: { name: 'Main Warehouse' }, binLocation: { code: 'A-01' } },
    ])

    expect(out).toHaveLength(1)
    expect(out[0].quantity).toBe(7)
    expect(out[0].warehouse?.name).toBe('Main Warehouse')
  })
})
