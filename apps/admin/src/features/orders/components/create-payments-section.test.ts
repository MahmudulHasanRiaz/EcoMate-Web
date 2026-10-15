import { describe, expect, it } from 'vitest'
import {
  emptyCollectedRow,
  collectedRowsTotal,
  validateCollectedRows,
  nonEmptyCollectedRows,
} from './create-payments-section'

describe('collectedRowsTotal', () => {
  it('sums row amounts, ignoring blanks', () => {
    expect(collectedRowsTotal([
      { ...emptyCollectedRow(), amount: '500' },
      { ...emptyCollectedRow(), amount: '' },
      { ...emptyCollectedRow(), amount: '300.50' },
    ])).toBeCloseTo(800.5, 2)
  })
})

describe('nonEmptyCollectedRows', () => {
  it('keeps rows with any filled field', () => {
    const rows = [
      emptyCollectedRow(),
      { ...emptyCollectedRow(), note: 'x' },
      { ...emptyCollectedRow(), amount: '100' },
    ]
    expect(nonEmptyCollectedRows(rows)).toHaveLength(2)
  })
})

describe('validateCollectedRows', () => {
  it('passes a complete row', () => {
    expect(validateCollectedRows(
      [{ amount: '500', gatewayCode: 'bkash', account: '017XX', transactionId: 'TX1', note: '' }],
      true,
    )).toEqual([])
  })

  it('rejects zero/negative amounts', () => {
    expect(validateCollectedRows(
      [{ amount: '0', gatewayCode: 'cash', account: 'till', transactionId: '', note: '' }],
      false,
    ).length).toBeGreaterThan(0)
  })

  it('always requires account (never a silent manual entry)', () => {
    const errors = validateCollectedRows(
      [{ amount: '500', gatewayCode: 'bkash', account: '', transactionId: 'TX1', note: '' }],
      true,
    )
    expect(errors.join(' ')).toMatch(/account/i)
  })

  it('requires txn exactly when S1 is OFF', () => {
    const row = { amount: '500', gatewayCode: 'cash', account: 'till', transactionId: '', note: '' }
    expect(validateCollectedRows([row], true).join(' ')).toMatch(/transaction/i)
    expect(validateCollectedRows([row], false)).toEqual([])
  })

  it('ignores fully-empty rows', () => {
    expect(validateCollectedRows([emptyCollectedRow()], true)).toEqual([])
  })
})
