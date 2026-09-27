// ── §15 ruleset tests: every rule's severity, blocking, action, resolution + reason.
// Severity/blocking must derive ONLY from the frozen table.

import {
  COURIER_SETTLEMENT_RULES,
  evaluateRules,
  worstSeverity,
  isBlocked,
  type RuleContext,
} from '../reconciliation/rules';

const ALL_IDS = COURIER_SETTLEMENT_RULES.map((r) => r.id);

describe('§15 frozen ruleset', () => {
  it('declares each rule with a unique id', () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
  });

  it('fires each rule from its declared condition with the declared severity/blocking', () => {
    const triggers: Record<string, RuleContext> = {
      DUPLICATE_FILE: { scope: 'invoice', checksumDuplicate: true },
      SOURCE_CORRUPT: { scope: 'invoice', malformedRatio: 0.3 },
      UNPROVEN_FINANCE_RULE: { scope: 'invoice', provenFinanceRule: false },
      COURIER_FORMAT_MISMATCH: { scope: 'invoice', courierFormatMismatch: true },
      PROVIDER_FOOTER_MISMATCH: { scope: 'invoice', providerFooterMismatch: true },
      ACCOUNTING_PENDING: { scope: 'invoice', accountingPending: true },
      MISSING_IDENTIFIER: { scope: 'row', rowClass: 'DATA', hasIdentifier: false },
      NO_MATCH: { scope: 'row', rowClass: 'DATA', matched: false },
      DUPLICATE_SETTLEMENT: { scope: 'row', duplicateSettlement: true },
      OVER_SETTLEMENT: { scope: 'order', codPosition: -50 },
      OVER_COLLECTION: { scope: 'row', grossCodCollected: 1200, expectedCod: 1000 },
      ARITHMETIC_MISMATCH_HARD: { scope: 'row', arithmeticDelta: 5 },
      ARITHMETIC_MISMATCH_SOFT: { scope: 'row', arithmeticDelta: 0.5 },
      RESIDUAL_LARGE: { scope: 'row', residual: 200, residualThreshold: 100 },
      RESIDUAL_UNEXPLAINED: { scope: 'row', residual: 40, residualThreshold: 100 },
      NEGATIVE_PAYOUT_VALID: { scope: 'row', rowKind: 'BILLING_ONLY', effectiveNet: -100 },
      NEGATIVE_PAYOUT_UNEXPECTED: {
        scope: 'row',
        rowKind: 'DELIVERY',
        effectiveNet: -10,
        effectiveCollected: 100,
      },
      UNKNOWN_ROW_KIND_WITH_AMOUNT: { scope: 'row', rowKind: 'UNKNOWN', effectiveNet: 5 },
      MALFORMED_ROW: { scope: 'row', malformedRow: true },
      NO_CACHED_VALUE: { scope: 'row', noCachedValue: true },
      PROVIDER_DATA_INCOMPLETE: { scope: 'row', providerDataIncomplete: true },
      UNUSUAL_ADJUSTMENT: { scope: 'row', unusualAdjustment: true },
      PARTIAL_SETTLEMENT: { scope: 'row', effectiveCollected: 400, codPosition: 600 },
      PREVIOUS_SETTLEMENT_EXISTS: { scope: 'row', previousSettlementExists: true },
      EXPECTED_COD_DIVERGENCE: { scope: 'order', expectedCodDivergence: true },
      ZERO_COST_REVIEW: {
        scope: 'order',
        finalizedProjectionZero: true,
        hasContributingRowWithZeroCharges: true,
      },
      CORRECTION_COUNTERPART_REQUIRED: { scope: 'adjustment', correctionDeltaR: 50 },
      UNEXPLAINED_CORRECTION_DELTA: {
        scope: 'adjustment',
        correctionDeltaR: 50,
        correctionCounterpart: 'variance',
      },
      REVISION_DELTA_UNPAIRED: { scope: 'invoice', revisionDeltaUnpaired: true },
    };

    for (const rule of COURIER_SETTLEMENT_RULES) {
      const ctx = triggers[rule.id];
      expect(ctx).toBeDefined();
      const findings = evaluateRules(ctx);
      const found = findings.find((f) => f.id === rule.id);
      expect(found).toBeDefined();
      const wantSeverity =
        typeof rule.severity === 'function' ? rule.severity(ctx) : rule.severity;
      const wantBlocking =
        typeof rule.blocking === 'function' ? rule.blocking(ctx) : rule.blocking;
      expect(found!.severity).toBe(wantSeverity);
      expect(found!.blocking).toBe(wantBlocking);
      expect(found!.userAction.length).toBeGreaterThan(0);
      expect(found!.resolutionPath.length).toBeGreaterThan(0);
      expect(found!.message.length).toBeGreaterThan(0);
    }
  });

  it('RED is always blocking; YELLOW is never structurally blocking', () => {
    for (const rule of COURIER_SETTLEMENT_RULES) {
      if (rule.severity === 'red') expect(rule.blocking).toBe(true);
    }
  });

  it('never fires a rule outside its declared scope', () => {
    const findings = evaluateRules({ scope: 'row', rowKind: 'BILLING_ONLY', effectiveNet: -100 });
    expect(findings.every((f) => f.scope === 'row')).toBe(true);
    expect(findings.map((f) => f.id)).not.toContain('DUPLICATE_FILE');
  });

  it('does not raise the soft arithmetic rule when delta is zero', () => {
    const findings = evaluateRules({ scope: 'row', arithmeticDelta: 0 });
    expect(findings.map((f) => f.id)).not.toContain('ARITHMETIC_MISMATCH_SOFT');
    expect(findings.map((f) => f.id)).not.toContain('ARITHMETIC_MISMATCH_HARD');
  });
});

describe('severity + gating helpers', () => {
  it('worstSeverity ranks red > yellow > green', () => {
    expect(worstSeverity([])).toBe('green');
    expect(worstSeverity([{ id: 'x', severity: 'yellow', blocking: false, message: '', userAction: '', resolutionPath: '', scope: 'row' }])).toBe('yellow');
    expect(
      worstSeverity([
        { id: 'x', severity: 'yellow', blocking: false, message: '', userAction: '', resolutionPath: '', scope: 'row' },
        { id: 'y', severity: 'red', blocking: true, message: '', userAction: '', resolutionPath: '', scope: 'row' },
      ]),
    ).toBe('red');
  });

  it('blocks on red, on structured blocking, and on unacknowledged warnings when required', () => {
    const red = evaluateRules({ scope: 'invoice', checksumDuplicate: true });
    expect(isBlocked(red, new Set(), true)).toBe(true);

    const warn = evaluateRules({ scope: 'row', residual: 40, residualThreshold: 100 });
    expect(isBlocked(warn, new Set(), true)).toBe(true);
    expect(isBlocked(warn, new Set(['RESIDUAL_UNEXPLAINED']), true)).toBe(false);
    expect(isBlocked(warn, new Set(), false)).toBe(false);
  });

  it('does not block a clean context', () => {
    expect(isBlocked(evaluateRules({ scope: 'row', rowClass: 'DATA', matched: true }), new Set(), true)).toBe(false);
  });
});