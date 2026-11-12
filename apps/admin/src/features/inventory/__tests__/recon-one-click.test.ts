import { describe, expect, it } from 'vitest'
import {
  buildReconPreview,
  buildReconSheetRows,
  computeReconVerdict,
  isApplicableReconRow,
} from '../components/recon-helpers'
import type { Q8SettleResult, ReconReport, ReconRow } from '../reconciliation'

/**
 * Pure-helper tests for the Reconciliation one-click-fix flow
 * (2026-11-12): verdict banner logic, plain-English preview lines, and
 * the applicable-row rule. No rendering, no API.
 */

const row = (overrides: Partial<ReconRow>): ReconRow => ({
  id: 'x',
  category: 'R1',
  orderDisplayId: 'ORD-1',
  returnDisplayId: null,
  productName: 'P',
  variantId: null,
  layer: 'managed',
  orderedQty: 1,
  receivedGoodQty: 1,
  damagedQty: 0,
  alreadyRestoredManaged: 0,
  alreadyRestoredPhysical: 0,
  missingManagedQty: 0,
  missingPhysicalQty: 0,
  evidence: 'e',
  ...overrides,
})

const report = (overrides: Partial<ReconReport>): ReconReport => ({
  generatedAt: '2026-11-12T10:00:00.000Z',
  imEnabled: true,
  rows: [],
  counts: { R1: 0, R2: 0, R3: 0, R4: 0, R5: {}, R6: 0, R7: 0, R8: 0, R8H: 0 },
  checks: [],
  ...overrides,
})

const Q8_PREVIEW: Q8SettleResult = {
  dryRun: true,
  settled: { releasedUnits: 2, flagsCleared: 1, ledgerEntries: ['LED-1'] },
  remainingFails: 0,
  detail: 'settled 2 orphaned units',
}

describe('isApplicableReconRow', () => {
  it('applies R1/R2/R6 and evidence-backed R8, never R8-H/R3/R4/R7', () => {
    expect(isApplicableReconRow(row({ category: 'R1' }))).toBe(true)
    expect(isApplicableReconRow(row({ category: 'R2' }))).toBe(true)
    expect(isApplicableReconRow(row({ category: 'R6' }))).toBe(true)
    expect(isApplicableReconRow(row({ category: 'R8', r8Kind: 'terminal' }))).toBe(true)
    expect(isApplicableReconRow(row({ category: 'R8', r8Kind: 'pending' }))).toBe(true)
    expect(isApplicableReconRow(row({ category: 'R8', r8Kind: 'human' }))).toBe(false)
    expect(isApplicableReconRow(row({ category: 'R3' }))).toBe(false)
    expect(isApplicableReconRow(row({ category: 'R4' }))).toBe(false)
    expect(isApplicableReconRow(row({ category: 'R7' }))).toBe(false)
  })
})

describe('computeReconVerdict', () => {
  it('is not-run with no report', () => {
    expect(computeReconVerdict(null)).toEqual({
      state: 'not-run',
      problemCount: 0,
      applicableCount: 0,
      failingCheckCount: 0,
    })
  })

  it('is ok when no applicable rows and no failing checks', () => {
    const r = report({
      rows: [row({ category: 'R4', id: 'r4' })],
      checks: [{ key: 'Q1', label: 'x', value: 0, pass: true, detail: '' }],
    })
    expect(computeReconVerdict(r).state).toBe('ok')
    expect(computeReconVerdict(r).problemCount).toBe(0)
  })

  it('counts applicable rows + failing checks, never R8-H or INFO checks', () => {
    const r = report({
      rows: [
        row({ category: 'R1', id: 'r1' }),
        row({ category: 'R8', r8Kind: 'human', id: 'r8h' }),
        row({ category: 'R6', id: 'r6' }),
      ],
      checks: [
        { key: 'Q1', label: 'x', value: 1, pass: false, detail: '' },
        { key: 'Q4', label: 'y', value: 3, pass: null, detail: '' },
      ],
    })
    const v = computeReconVerdict(r)
    expect(v.state).toBe('issues')
    expect(v.applicableCount).toBe(2)
    expect(v.failingCheckCount).toBe(1)
    expect(v.problemCount).toBe(3)
  })
})

describe('buildReconPreview', () => {
  const mixed = report({
    rows: [
      row({ category: 'R1', id: 'r1a' }),
      row({ category: 'R1', id: 'r1b' }),
      row({ category: 'R2', id: 'r2' }),
      row({ category: 'R6', id: 'r6' }),
      row({ category: 'R8', r8Kind: 'terminal', id: 'r8' }),
      row({ category: 'R8', r8Kind: 'human', id: 'r8h' }),
      row({ category: 'R4', id: 'r4' }),
    ],
    counts: { R1: 2, R2: 1, R3: 3, R4: 1, R5: {}, R6: 1, R7: 2, R8: 1, R8H: 1 },
  })

  it('lists one plain-English line per fixable category', () => {
    const p = buildReconPreview(mixed, null, false)
    expect(p.fixable).toBe(true)
    expect(p.fixLines.map((l) => l.text)).toEqual([
      '2 missed restock(s) will be added',
      "1 returned item(s)' physical stock will be fixed",
      '1 stranded managed stock unit(s) will be released',
      'A Return record will be created for 1 old order(s)',
    ])
    // R8-H is not a fix line — only the evidence-backed R8 row counts.
    expect(p.fixLines.filter((l) => l.key === 'R8').map((l) => l.count)).toEqual([1])
  })

  it('sums R4+R3+R7+R8H as never-fixed, and never lists them as fixes', () => {
    const p = buildReconPreview(mixed, null, false)
    expect(p.notFixedCount).toBe(1 + 3 + 2 + 1)
  })

  it('adds the Q8 line from the settle preview for superadmins only', () => {
    const admin = buildReconPreview(mixed, Q8_PREVIEW, true)
    expect(admin.fixLines.map((l) => l.text)).toContain(
      '2 stuck reservation(s) will be released',
    )
    const nonAdmin = buildReconPreview(mixed, Q8_PREVIEW, false)
    expect(nonAdmin.fixLines.some((l) => l.key === 'Q8')).toBe(false)
  })

  it('is not fixable when nothing is applicable and Q8 releases nothing', () => {
    const empty = report({
      rows: [row({ category: 'R4', id: 'r4' })],
      counts: { R1: 0, R2: 0, R3: 0, R4: 1, R5: {}, R6: 0, R7: 0, R8: 0, R8H: 0 },
    })
    const p = buildReconPreview(empty, { ...Q8_PREVIEW, settled: { ...Q8_PREVIEW.settled, releasedUnits: 0 } }, true)
    expect(p.fixable).toBe(false)
    expect(p.fixLines).toEqual([])
    expect(p.notFixedCount).toBe(1)
  })
})

describe('buildReconSheetRows', () => {
  const sheetRow = (overrides: Partial<ReconRow>) =>
    buildReconSheetRows(report({ rows: [row(overrides)] }))[0]

  it('maps one row per finding, in report order, nothing dropped', () => {
    const r = report({
      rows: [
        row({ category: 'R1', id: 'a' }),
        row({ category: 'R4', id: 'b' }),
        row({ category: 'R8', r8Kind: 'human', id: 'c' }),
      ],
    })
    const rows = buildReconSheetRows(r)
    expect(rows).toHaveLength(3)
    expect(rows.map((x) => x.key)).toEqual(['a', 'b', 'c'])
  })

  it('gives a plain problem and the right Qty per category', () => {
    expect(sheetRow({ category: 'R1', missingManagedQty: 2, missingPhysicalQty: 1 }).problem).toBe(
      'Missed restock',
    )
    expect(sheetRow({ category: 'R1', missingManagedQty: 2, missingPhysicalQty: 1 }).qty).toBe(3)
    expect(
      sheetRow({ category: 'R2', missingManagedQty: 0, missingPhysicalQty: 4 }).problem,
    ).toBe('Physical stock not fixed')
    expect(sheetRow({ category: 'R2', missingManagedQty: 0, missingPhysicalQty: 4 }).qty).toBe(4)
    // R3 physical: the received amount; R3 managed: the order-line quantity.
    expect(
      sheetRow({ category: 'R3', layer: 'physical', receivedGoodQty: 3 }).problem,
    ).toBe('Physical stock never used')
    expect(sheetRow({ category: 'R3', layer: 'physical', receivedGoodQty: 3 }).qty).toBe(3)
    expect(sheetRow({ category: 'R3', layer: 'managed', orderedQty: 5 }).problem).toBe(
      'Stock flags still set',
    )
    expect(sheetRow({ category: 'R3', layer: 'managed', orderedQty: 5 }).qty).toBe(5)
    // R4: unknowable by definition.
    expect(sheetRow({ category: 'R4' }).problem).toBe('Quantity unknown')
    expect(sheetRow({ category: 'R4' }).qty).toBeNull()
    // R6: the signed stranded qty — a negative residue shows its magnitude.
    expect(sheetRow({ category: 'R6', strandedManagedQty: -2 }).problem).toBe(
      'Stranded managed stock',
    )
    expect(sheetRow({ category: 'R6', strandedManagedQty: -2 }).qty).toBe(2)
    expect(sheetRow({ category: 'R6', strandedManagedQty: 3 }).qty).toBe(3)
    // R7: the physical quantity on the suspected mirror row.
    expect(sheetRow({ category: 'R7', physicalQty: 7 }).problem).toBe('Suspected leftover stock')
    expect(sheetRow({ category: 'R7', physicalQty: 7 }).qty).toBe(7)
    // R8: the order quantity.
    expect(
      sheetRow({ category: 'R8', r8Kind: 'terminal', orderedQty: 2 }).problem,
    ).toBe('Old return, no Return record')
    expect(sheetRow({ category: 'R8', r8Kind: 'terminal', orderedQty: 2 }).qty).toBe(2)
    expect(sheetRow({ category: 'R8', r8Kind: 'human', orderedQty: 2 }).problem).toBe(
      'Old return, unclear evidence',
    )
  })

  it('marks applicable rows Auto-fix and report-only rows Needs you', () => {
    expect(sheetRow({ category: 'R1' }).result).toBe('Auto-fix')
    expect(sheetRow({ category: 'R2' }).result).toBe('Auto-fix')
    expect(sheetRow({ category: 'R6' }).result).toBe('Auto-fix')
    expect(sheetRow({ category: 'R8', r8Kind: 'pending' }).result).toBe('Auto-fix')
    expect(sheetRow({ category: 'R3' }).result).toBe('Needs you')
    expect(sheetRow({ category: 'R4' }).result).toBe('Needs you')
    expect(sheetRow({ category: 'R7' }).result).toBe('Needs you')
    expect(sheetRow({ category: 'R8', r8Kind: 'human' }).result).toBe('Needs you')
  })

  it('never shows a UUID product name — falls back to Unknown product', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    expect(sheetRow({ productName: uuid, productId: uuid }).itemLabel).toBe('Unknown product')
    expect(sheetRow({ productName: 'Hoodie', productId: 'some-id' }).itemLabel).toBe('Hoodie')
  })

  it('keeps the main-view fields free of R-codes and UUIDs', () => {
    const rows = buildReconSheetRows(
      report({
        rows: [
          row({
            category: 'R1',
            orderDisplayId: 'ORD-1',
            productName: 'Hoodie',
            missingManagedQty: 2,
          }),
          row({
            category: 'R6',
            orderDisplayId: '',
            productName: 'Widget',
            strandedManagedQty: -2,
          }),
          row({
            category: 'R8',
            r8Kind: 'human',
            orderDisplayId: 'ORD-9',
            productName: 'Mug',
            orderedQty: 1,
          }),
        ],
      }),
    )
    for (const r of rows) {
      for (const field of [r.problem, r.orderLabel, r.itemLabel, r.result]) {
        expect(field).not.toMatch(/\bR[1-8](-H)?\b/)
        expect(field).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        )
      }
    }
  })
})
