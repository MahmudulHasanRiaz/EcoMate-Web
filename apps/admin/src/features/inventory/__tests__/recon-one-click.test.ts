import { describe, expect, it } from 'vitest'
import {
  buildReconPreview,
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
