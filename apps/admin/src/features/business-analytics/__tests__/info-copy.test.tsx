/**
 * Plain-language rules for analytics info copy (shop-owner voice).
 *
 * User-facing strings: max 2 short sentences, no jargon, same audit truth.
 * Update-don't-delete: these assert the MEANING contract, not exact screens.
 */
import { describe, expect, it } from 'vitest'
import {
  BANNED_JARGON,
  INFO_BOOKED_INTAKE,
  INFO_CASH_PAID_ONLY,
  INFO_DELIVERED_ONLY,
  INFO_FM_DIAGNOSTIC,
  INFO_FULFILLMENT_NOT_SALES,
  INFO_MISSING_COST_ACTION,
  INFO_PIPELINE_NOT_SALES,
  INFO_RECOGNITION_RATE,
  INFO_RETURN_INCIDENCE,
  INFO_UNDATED_SPEND_ACTION,
  infoCodUnavailable,
  plainDateBasis,
  plainFormulaLabel,
  plainLadderState,
  plainLine,
  plainReference,
} from '../components/info-copy'
import {
  ATTRIBUTION_MISMATCH_STATEMENT,
  BUDGET_VS_ACTUAL_NOTE,
  CLR_STATEMENT,
  EXPENSE_DATE_BASIS_STATEMENT,
  EXPENSE_KIND_NOTE,
  EXPENSE_REVENUE_SCOPE_NOTE,
  INVENTORY_CLOSING_ONLY_NOTE,
  INVENTORY_VALUE_BASIS_STATEMENT,
  LOST_SALES_NOTE,
  PRODUCT_CONTRIBUTION_FLOOR_STATEMENT,
  RETURN_INCIDENCE_LABEL,
  SPEND_DATE_BASIS_STATEMENT,
  UNATTRIBUTED_STATEMENT,
  UNRECOGNISED_SPEND_NOTE,
} from '../types'

const USER_STRINGS: string[] = [
  INFO_DELIVERED_ONLY,
  INFO_BOOKED_INTAKE,
  INFO_CASH_PAID_ONLY,
  INFO_RECOGNITION_RATE,
  INFO_PIPELINE_NOT_SALES,
  INFO_FULFILLMENT_NOT_SALES,
  INFO_FM_DIAGNOSTIC,
  INFO_MISSING_COST_ACTION,
  INFO_UNDATED_SPEND_ACTION,
  INFO_RETURN_INCIDENCE,
  infoCodUnavailable(3),
  PRODUCT_CONTRIBUTION_FLOOR_STATEMENT,
  RETURN_INCIDENCE_LABEL,
  CLR_STATEMENT,
  UNATTRIBUTED_STATEMENT,
  SPEND_DATE_BASIS_STATEMENT,
  ATTRIBUTION_MISMATCH_STATEMENT,
  UNRECOGNISED_SPEND_NOTE,
  INVENTORY_VALUE_BASIS_STATEMENT,
  INVENTORY_CLOSING_ONLY_NOTE,
  LOST_SALES_NOTE,
  EXPENSE_KIND_NOTE,
  EXPENSE_DATE_BASIS_STATEMENT,
  BUDGET_VS_ACTUAL_NOTE,
  EXPENSE_REVENUE_SCOPE_NOTE,
]

function sentences(s: string): number {
  return s.split('.').map((p) => p.trim()).filter(Boolean).length
}

describe('info copy plain-language rules', () => {
  it('uses no banned jargon in user-facing strings', () => {
    for (const s of USER_STRINGS) {
      for (const banned of BANNED_JARGON) {
        expect(s.toLowerCase()).not.toContain(banned.toLowerCase())
      }
    }
  })

  it('keeps every info string to max 2 short sentences', () => {
    for (const s of USER_STRINGS) {
      expect(sentences(s)).toBeLessThanOrEqual(2)
    }
  })

  it('reuses one shared Delivered-only phrasing', () => {
    expect(INFO_DELIVERED_ONLY).toMatch(/Only counts orders marked Delivered/)
  })

  it('says WHY + what to do on unavailable states', () => {
    expect(INFO_MISSING_COST_ACTION).toMatch(/Add the cost on the order/)
    expect(INFO_UNDATED_SPEND_ACTION).toMatch(/Add the date/)
    expect(infoCodUnavailable(2)).toMatch(/Add a courier settlement/)
    expect(INVENTORY_CLOSING_ONLY_NOTE).toMatch(/they need full history/)
    expect(BUDGET_VS_ACTUAL_NOTE).toMatch(/It is not 0/)
  })
})

describe('plainLine mappings (same truth, plain words)', () => {
  it('maps saved-cost jargon', () => {
    expect(plainLine('2 unit(s) without costSnapshot')).toMatch(/without saved cost/)
  })

  it('maps spend-date jargon', () => {
    expect(plainLine('1 consumption(s) missing spendDate')).toMatch(/missing a spend date/)
  })

  it('maps order/payment dates', () => {
    expect(plainLine('Order.createdAt — intake only')).toMatch(/order date/)
    expect(plainLine('Payment.createdAt (PAID only)')).toMatch(/payment date/)
    expect(plainLine('Delivered transition')).toMatch(/delivery date/)
  })

  it('maps courier-settlement jargon to WHY + action', () => {
    expect(plainLine('no_courier_settlement_source')).toMatch(/Add a courier settlement/)
  })

  it('strips audit codes', () => {
    expect(plainLine('Not instrumented — cart events (§8.7)')).not.toMatch(/§8\.7/)
    expect(plainLine('verified date-independently (R8)')).not.toMatch(/R8/)
  })

  it('is idempotent', () => {
    const once = plainLine('Order.createdAt — intake only, never in the ladder')
    expect(plainLine(once)).toBe(once)
  })
})

describe('plain info prefixes', () => {
  it('counts by, worked out as, note', () => {
    expect(plainDateBasis('Delivered transition')).toBe('Counted by: delivery date')
    expect(plainFormulaLabel('v9')).toBe('Worked out as v9')
    expect(plainReference('undated spend')).toBe('Note: undated spend. Not counted in the total.')
    expect(plainDateBasis(undefined)).toBeNull()
    expect(plainFormulaLabel(undefined)).toBeNull()
    expect(plainReference(undefined)).toBeNull()
  })

  it('maps cost completeness plainly', () => {
    expect(plainLadderState('actual')).toBe('complete')
    expect(plainLadderState('estimated')).toBe('partly estimated')
    expect(plainLadderState('unavailable')).toBe('partly missing')
  })
})
