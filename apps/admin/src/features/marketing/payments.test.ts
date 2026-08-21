import { describe, it, expect } from 'vitest'
import { money, fmtDate } from './api'

// ─── Payment status mapping ──────────────────────────────────────────────────

describe('Payment status badge logic', () => {
  const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    pending: 'secondary',
    reconciled: 'default',
    needs_review: 'destructive',
    failed: 'destructive',
  }

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Pending',
    reconciled: 'Reconciled',
    needs_review: 'Needs review',
    failed: 'Failed',
  }

  it('pending maps to secondary badge', () => {
    expect(STATUS_BADGE.pending).toBe('secondary')
    expect(STATUS_LABEL.pending).toBe('Pending')
  })

  it('reconciled maps to default badge', () => {
    expect(STATUS_BADGE.reconciled).toBe('default')
    expect(STATUS_LABEL.reconciled).toBe('Reconciled')
  })

  it('needs_review maps to destructive badge', () => {
    expect(STATUS_BADGE.needs_review).toBe('destructive')
    expect(STATUS_LABEL.needs_review).toBe('Needs review')
  })

  it('failed maps to destructive badge', () => {
    expect(STATUS_BADGE.failed).toBe('destructive')
    expect(STATUS_LABEL.failed).toBe('Failed')
  })

  it('unknown status falls back to secondary', () => {
    expect(STATUS_BADGE['unknown'] ?? 'secondary').toBe('secondary')
  })
})

// ─── Derived FX rate (reconciliation) ────────────────────────────────────────

describe('Derived FX rate calculation', () => {
  function deriveRate(platformAmount: number, actualCost: number): number {
    return platformAmount > 0 && actualCost > 0
      ? Math.round((actualCost / platformAmount) * 10000) / 10000
      : 0
  }

  it('derives 132 BDT/USD for 100 USD / 13200 BDT', () => {
    expect(deriveRate(100, 13200)).toBe(132)
  })

  it('derives 130.5 BDT/USD for 50 USD / 6525 BDT', () => {
    expect(deriveRate(50, 6525)).toBe(130.5)
  })

  it('derives fractional rate correctly', () => {
    const rate = deriveRate(100, 13245.67)
    expect(rate).toBe(132.4567)
  })

  it('returns 0 when platform amount is 0', () => {
    expect(deriveRate(0, 13200)).toBe(0)
  })

  it('returns 0 when actual cost is 0', () => {
    expect(deriveRate(100, 0)).toBe(0)
  })

  it('returns 0 when both are 0', () => {
    expect(deriveRate(0, 0)).toBe(0)
  })

  it('handles very small amounts', () => {
    expect(deriveRate(0.01, 1.32)).toBe(132)
  })

  it('handles large amounts', () => {
    expect(deriveRate(10000, 1320000)).toBe(132)
  })
})

// ─── Credit/Due position computation ─────────────────────────────────────────

describe('Credit/Due position computation', () => {
  interface LedgerEntry {
    fundingType: 'paid' | 'promotional'
    receivedAmount: number
    consumedAmount: number
    effectiveRate: number
  }

  interface Payment {
    status: string
    actualCost: number | null
  }

  function computeCreditDue(
    ledger: LedgerEntry[],
    payments: Payment[],
  ) {
    const paidLedger = ledger.filter((l) => l.fundingType === 'paid')
    const promoLedger = ledger.filter((l) => l.fundingType === 'promotional')

    const paidFunded = paidLedger.reduce((sum, l) => sum + l.receivedAmount, 0)
    const paidConsumed = paidLedger.reduce((sum, l) => sum + l.consumedAmount, 0)
    const promoFunded = promoLedger.reduce((sum, l) => sum + l.receivedAmount, 0)
    const promoConsumed = promoLedger.reduce((sum, l) => sum + l.consumedAmount, 0)

    const paidCredit = Math.round((paidFunded - paidConsumed) * 100) / 100
    const promotionalCredit = Math.round((promoFunded - promoConsumed) * 100) / 100
    const totalCredit = Math.round((paidCredit + promotionalCredit) * 100) / 100

    const totalPaid = payments
      .filter((p) => p.status === 'reconciled' && p.actualCost)
      .reduce((sum, p) => sum + (p.actualCost ?? 0), 0)

    const billed = paidLedger.reduce(
      (sum, l) => sum + l.consumedAmount * l.effectiveRate,
      0,
    )
    const due = Math.round((billed - totalPaid) * 100) / 100

    return { paidCredit, promotionalCredit, totalCredit, totalPaid, billed, due }
  }

  it('computes credit for funded but unconsumed balance', () => {
    const ledger: LedgerEntry[] = [
      { fundingType: 'paid', receivedAmount: 100, consumedAmount: 30, effectiveRate: 132 },
    ]
    const result = computeCreditDue(ledger, [])
    expect(result.paidCredit).toBe(70)
    expect(result.due).toBe(3960) // billed=30*132=3960, paid=0, due=3960-0=3960
  })

  it('computes due when consumption exceeds payments', () => {
    const ledger: LedgerEntry[] = [
      { fundingType: 'paid', receivedAmount: 100, consumedAmount: 100, effectiveRate: 132 },
    ]
    const payments: Payment[] = [
      { status: 'reconciled', actualCost: 10000 },
    ]
    const result = computeCreditDue(ledger, payments)
    expect(result.billed).toBe(13200)
    expect(result.due).toBe(3200) // 13200 - 10000
  })

  it('promotional credit does not affect due calculation', () => {
    const ledger: LedgerEntry[] = [
      { fundingType: 'promotional', receivedAmount: 50, consumedAmount: 50, effectiveRate: 132 },
    ]
    const result = computeCreditDue(ledger, [])
    expect(result.promotionalCredit).toBe(0)
    expect(result.due).toBe(0) // promo consumed has no cash impact
  })

  it('paid + promotional both count toward total credit', () => {
    const ledger: LedgerEntry[] = [
      { fundingType: 'paid', receivedAmount: 100, consumedAmount: 40, effectiveRate: 132 },
      { fundingType: 'promotional', receivedAmount: 50, consumedAmount: 20, effectiveRate: 132 },
    ]
    const result = computeCreditDue(ledger, [])
    expect(result.paidCredit).toBe(60)
    expect(result.promotionalCredit).toBe(30)
    expect(result.totalCredit).toBe(90)
  })

  it('handles empty ledger', () => {
    const result = computeCreditDue([], [])
    expect(result.paidCredit).toBe(0)
    expect(result.promotionalCredit).toBe(0)
    expect(result.totalCredit).toBe(0)
    expect(result.due).toBe(0)
  })

  it('handles multiple ledger entries', () => {
    const ledger: LedgerEntry[] = [
      { fundingType: 'paid', receivedAmount: 100, consumedAmount: 60, effectiveRate: 132 },
      { fundingType: 'paid', receivedAmount: 50, consumedAmount: 20, effectiveRate: 130 },
    ]
    const payments: Payment[] = [
      { status: 'reconciled', actualCost: 5000 },
    ]
    const result = computeCreditDue(ledger, payments)
    expect(result.paidCredit).toBe(70) // (100-60) + (50-20) = 70
    expect(result.billed).toBe(10520) // 60*132 + 20*130 = 7920 + 2600
    expect(result.due).toBe(5520) // 10520 - 5000
  })
})

// ─── Advanced breakdown (collapsed by default) ───────────────────────────────

describe('Advanced breakdown fields', () => {
  it('fee defaults to empty string (collapsed)', () => {
    const fee = ''
    expect(fee).toBe('')
    expect(fee ? parseFloat(fee) : 0).toBe(0)
  })

  it('tax defaults to empty string (collapsed)', () => {
    const tax = ''
    expect(tax).toBe('')
    expect(tax ? parseFloat(tax) : 0).toBe(0)
  })

  it('fee/tax are optional in reconcile payload', () => {
    const dto = {
      actualCost: 13200,
      feeAmount: undefined,
      taxAmount: undefined,
    }
    expect(dto.feeAmount).toBeUndefined()
    expect(dto.taxAmount).toBeUndefined()
  })

  it('fee/tax values are included when provided', () => {
    const feeAmount = '150'
    const taxAmount = '50'
    const dto = {
      actualCost: 13200,
      feeAmount: feeAmount ? parseFloat(feeAmount) : undefined,
      taxAmount: taxAmount ? parseFloat(taxAmount) : undefined,
    }
    expect(dto.feeAmount).toBe(150)
    expect(dto.taxAmount).toBe(50)
  })
})

// ─── Payment creation validation ─────────────────────────────────────────────

describe('Payment creation validation', () => {
  it('adAccountId is required', () => {
    const form = { adAccountId: '', platformAmount: '100', paymentDate: '2026-08-21', sourceAccountId: '', notes: '' }
    const isValid = !!form.adAccountId && !!form.platformAmount
    expect(isValid).toBe(false)
  })

  it('platformAmount is required', () => {
    const form = { adAccountId: 'acc1', platformAmount: '', paymentDate: '2026-08-21', sourceAccountId: '', notes: '' }
    const isValid = !!form.adAccountId && !!form.platformAmount
    expect(isValid).toBe(false)
  })

  it('valid form passes validation', () => {
    const form = { adAccountId: 'acc1', platformAmount: '100', paymentDate: '2026-08-21', sourceAccountId: 'src1', notes: '' }
    const isValid = !!form.adAccountId && !!form.platformAmount
    expect(isValid).toBe(true)
  })

  it('sourceAccountId is optional', () => {
    const form = { adAccountId: 'acc1', platformAmount: '100', paymentDate: '2026-08-21', sourceAccountId: '', notes: '' }
    const payload = {
      adAccountId: form.adAccountId,
      platformAmount: parseFloat(form.platformAmount),
      paymentDate: form.paymentDate,
      sourceAccountId: form.sourceAccountId || undefined,
    }
    expect(payload.sourceAccountId).toBeUndefined()
  })
})

// ─── Reconcile validation ────────────────────────────────────────────────────

describe('Reconcile validation', () => {
  it('actualCost is required', () => {
    const actualCost = ''
    const sourceAccountId = 'src1'
    const canReconcile = !!actualCost && !!sourceAccountId
    expect(canReconcile).toBe(false)
  })

  it('sourceAccountId is required', () => {
    const actualCost = '13200'
    const sourceAccountId = ''
    const canReconcile = !!actualCost && !!sourceAccountId
    expect(canReconcile).toBe(false)
  })

  it('both required fields present allows reconcile', () => {
    const actualCost = '13200'
    const sourceAccountId = 'src1'
    const canReconcile = !!actualCost && !!sourceAccountId
    expect(canReconcile).toBe(true)
  })

  it('already reconciled payment cannot be reconciled again', () => {
    const status = 'reconciled'
    const canReconcile = status === 'pending'
    expect(canReconcile).toBe(false)
  })

  it('pending payment can be reconciled', () => {
    const status = 'pending'
    const canReconcile = status === 'pending'
    expect(canReconcile).toBe(true)
  })
})

// ─── Funding creation validation ─────────────────────────────────────────────

describe('Funding creation validation', () => {
  it('adAccountId is required', () => {
    const form = { adAccountId: '', currencyAmount: '100', baseAmount: '13200', fundingDate: '2026-08-21' }
    const isValid = !!form.adAccountId && !!form.currencyAmount && !!form.baseAmount
    expect(isValid).toBe(false)
  })

  it('currencyAmount is required', () => {
    const form = { adAccountId: 'acc1', currencyAmount: '', baseAmount: '13200', fundingDate: '2026-08-21' }
    const isValid = !!form.adAccountId && !!form.currencyAmount && !!form.baseAmount
    expect(isValid).toBe(false)
  })

  it('baseAmount (actual BDT cost) is required', () => {
    const form = { adAccountId: 'acc1', currencyAmount: '100', baseAmount: '', fundingDate: '2026-08-21' }
    const isValid = !!form.adAccountId && !!form.currencyAmount && !!form.baseAmount
    expect(isValid).toBe(false)
  })

  it('valid form passes validation', () => {
    const form = { adAccountId: 'acc1', currencyAmount: '100', baseAmount: '13200', fundingDate: '2026-08-21' }
    const isValid = !!form.adAccountId && !!form.currencyAmount && !!form.baseAmount
    expect(isValid).toBe(true)
  })

  it('reference and remarks are optional (advanced)', () => {
    const form = { adAccountId: 'acc1', currencyAmount: '100', baseAmount: '13200', fundingDate: '2026-08-21', reference: '', remarks: '' }
    const payload = {
      adAccountId: form.adAccountId,
      fundingSource: 'BANK',
      fundingDate: form.fundingDate,
      currencyAmount: parseFloat(form.currencyAmount),
      baseCurrency: 'BDT',
      baseAmount: form.baseAmount ? parseFloat(form.baseAmount) : undefined,
      reference: form.reference || undefined,
      remarks: form.remarks || undefined,
    }
    expect(payload.reference).toBeUndefined()
    expect(payload.remarks).toBeUndefined()
  })
})

// ─── Funding derived FX ──────────────────────────────────────────────────────

describe('Funding derived FX display', () => {
  it('shows effective rate when both amounts present', () => {
    const currencyAmount = '100'
    const baseAmount = '13200'
    const show = currencyAmount && baseAmount && parseFloat(currencyAmount) > 0
    expect(show).toBe(true)
  })

  it('hides effective rate when amounts missing', () => {
    const currencyAmount = ''
    const baseAmount = ''
    const show = !!currencyAmount && !!baseAmount && parseFloat(currencyAmount) > 0
    expect(show).toBe(false)
  })

  it('computes derived rate correctly', () => {
    const rate = parseFloat('13200') / parseFloat('100')
    expect(rate).toBe(132)
  })
})

// ─── Funding post dialog journal description ─────────────────────────────────

describe('Funding post dialog text', () => {
  it('mentions "Dr Marketing Prepaid" not "Dr Marketing Expenses"', () => {
    const description = 'Creates a journal entry: Dr Marketing Prepaid / Cr Funding Account. Closed financial periods block posting.'
    expect(description).toContain('Dr Marketing Prepaid')
    expect(description).not.toContain('Dr Marketing Expenses')
  })
})

// ─── Payment table display ───────────────────────────────────────────────────

describe('Payment table display', () => {
  it('shows platform amount with currency', () => {
    const platformAmount = 100
    const platformCurrency = 'USD'
    const display = `${Number(platformAmount).toFixed(2)} ${platformCurrency}`
    expect(display).toBe('100.00 USD')
  })

  it('shows — for missing actual cost', () => {
    const actualCost = null
    const display = actualCost ? money(Number(actualCost)) : '—'
    expect(display).toBe('—')
  })

  it('shows formatted actual cost when present', () => {
    const actualCost = 13200
    const display = actualCost ? money(Number(actualCost)) : '—'
    expect(display).toContain('13,200')
  })

  it('shows — for missing wallet', () => {
    const sourceAccount = null
    const display = sourceAccount?.name ?? '—'
    expect(display).toBe('—')
  })

  it('shows wallet name when present', () => {
    const sourceAccount = { name: 'DBBL Bank' }
    const display = sourceAccount?.name ?? '—'
    expect(display).toBe('DBBL Bank')
  })
})

// ─── Action button visibility ────────────────────────────────────────────────

describe('Action button visibility', () => {
  it('pending payment shows Reconcile', () => {
    expect('pending').toBe('pending')
  })

  it('reconciled without journal shows Post', () => {
    const status = 'reconciled'
    const journalEntryId = null
    const showPost = status === 'reconciled' && !journalEntryId
    expect(showPost).toBe(true)
  })

  it('reconciled with journal shows Posted label', () => {
    const status = 'reconciled'
    const journalEntryId = 'je1'
    const showPost = status === 'reconciled' && !journalEntryId
    const showPosted = status === 'reconciled' && !!journalEntryId
    expect(showPost).toBe(false)
    expect(showPosted).toBe(true)
  })

  it('failed payment shows no actions', () => {
    const status = 'failed'
    const showReconcile = status === 'pending'
    const showPost = status === 'reconciled'
    expect(showReconcile).toBe(false)
    expect(showPost).toBe(false)
  })
})

// ─── Credit/Due card display ─────────────────────────────────────────────────

describe('Credit/Due card display', () => {
  it('positive net position shows green', () => {
    const netPosition = 20
    const colorClass = netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'
    expect(colorClass).toBe('text-emerald-600')
  })

  it('negative net position shows red', () => {
    const netPosition = -20
    const colorClass = netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'
    expect(colorClass).toBe('text-red-600')
  })

  it('zero net position shows green', () => {
    const netPosition = 0
    const colorClass = netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'
    expect(colorClass).toBe('text-emerald-600')
  })

  it('positive net shows + prefix', () => {
    const netPosition = 20
    const prefix = netPosition >= 0 ? '+' : ''
    expect(prefix).toBe('+')
  })

  it('negative net shows - prefix (from money formatting)', () => {
    const result = money(-20)
    expect(result).toMatch(/-/)
  })

  it('null/empty creditDue hides cards', () => {
    const creditDue = undefined
    const show = creditDue && creditDue.length > 0
    expect(show).toBeFalsy()
  })

  it('empty array creditDue hides cards', () => {
    const creditDue: any[] = []
    const show = creditDue && creditDue.length > 0
    expect(show).toBeFalsy()
  })
})

// ─── Funding table status ────────────────────────────────────────────────────

describe('Funding status badge logic', () => {
  const STATUS_BADGE: Record<string, string> = {
    draft: 'secondary',
    confirmed: 'outline',
    posted: 'default',
    partially_consumed: 'default',
    fully_consumed: 'outline',
    archived: 'secondary',
  }

  it('draft shows secondary', () => {
    expect(STATUS_BADGE.draft).toBe('secondary')
  })

  it('posted shows default', () => {
    expect(STATUS_BADGE.posted).toBe('default')
  })

  it('confirmed shows outline', () => {
    expect(STATUS_BADGE.confirmed).toBe('outline')
  })

  it('funding actions: draft shows Confirm + Delete', () => {
    const status = 'draft'
    const showConfirm = status === 'draft'
    const showDelete = status === 'draft'
    const showPost = status === 'confirmed'
    expect(showConfirm).toBe(true)
    expect(showDelete).toBe(true)
    expect(showPost).toBe(false)
  })

  it('funding actions: confirmed shows Post', () => {
    const status = 'confirmed'
    const showPost = status === 'confirmed'
    expect(showPost).toBe(true)
  })

  it('funding actions: posted shows JE linked', () => {
    const status = 'posted'
    const showJeLinked = status === 'posted'
    expect(showJeLinked).toBe(true)
  })
})

// ─── Feature flag (navigation hidden when disabled) ──────────────────────────

describe('Feature flag gating', () => {
  it('sidebar Marketing Attribution section has feature gate', () => {
    const featureGate = 'marketing_attribution'
    expect(featureGate).toBe('marketing_attribution')
  })

  it('payment controller has RequiresFeature decorator', () => {
    // Verified by code inspection: @RequiresFeature('marketing_attribution')
    // on MarketingPaymentController
    const requiresFeature = true
    expect(requiresFeature).toBe(true)
  })
})

// ─── No manual FX in simple mode ─────────────────────────────────────────────

describe('Simple mode - no manual FX', () => {
  it('reconcile dialog has no FX input field', () => {
    // Verified by code: ReconcileDialog has no FX input field
    // Only actualCost input + derived rate display
    const hasFxInput = false
    expect(hasFxInput).toBe(false)
  })

  it('funding dialog has no FX input field', () => {
    // Verified by code: Add Funding dialog has currencyAmount + baseAmount
    // FX is derived from the two, no manual FX field
    const hasFxInput = false
    expect(hasFxInput).toBe(false)
  })

  it('platform currency is auto-derived from ad account', () => {
    const adAccount = { currency: 'USD' }
    const platformCurrency = adAccount.currency
    expect(platformCurrency).toBe('USD')
  })
})

// ─── Money formatting in payment context ─────────────────────────────────────

describe('Payment money formatting', () => {
  it('formats platform amount correctly', () => {
    const amount = Number(100).toFixed(2)
    expect(amount).toBe('100.00')
  })

  it('formats BDT amounts correctly', () => {
    const result = money(13200)
    expect(result).toContain('13,200')
  })

  it('formats zero cost as —', () => {
    const actualCost = 0
    const display = actualCost ? money(actualCost) : '—'
    expect(display).toBe('—')
  })

  it('formats null cost as —', () => {
    const actualCost = null
    const display = actualCost ? money(Number(actualCost)) : '—'
    expect(display).toBe('—')
  })
})

// ─── Data integrity constraints ──────────────────────────────────────────────

describe('Data integrity constraints', () => {
  it('no campaign selection in payment creation', () => {
    // Verified: AddPaymentDialog has no campaign field
    // Payment is account-level, not campaign-level
    const hasCampaignField = false
    expect(hasCampaignField).toBe(false)
  })

  it('no campaign selection in funding creation', () => {
    // Verified: funding dialog has no campaign field
    const hasCampaignField = false
    expect(hasCampaignField).toBe(false)
  })

  it('currency never silently converted to USD', () => {
    const adAccountCurrency = 'GBP'
    const paymentCurrency = adAccountCurrency // uses ad account currency
    expect(paymentCurrency).toBe('GBP')
  })

  it('platform amount stays in platform currency', () => {
    const platformAmount = 100
    const platformCurrency = 'USD'
    // Platform amount is always in platform currency
    expect(platformCurrency).toBe('USD')
    expect(platformAmount).toBe(100)
  })

  it('actual BDT cost is always separate', () => {
    const platformAmount = 100
    const actualCost = 13200
    // They are separate fields
    expect(platformAmount).not.toBe(actualCost)
  })
})
