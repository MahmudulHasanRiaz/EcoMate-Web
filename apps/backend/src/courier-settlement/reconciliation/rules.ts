// ── Courier Settlement exception ruleset (PRD §15) — ONE frozen ordered table.
//
// Severity and blocking are derived ONLY from this table; no service may scatter
// ad-hoc `if` checks that produce a severity. Every rule declares its scope so
// the evaluator can apply the right subset at row / invoice / order / adjustment
// time. RED is always blocking; YELLOW blocks until acknowledged when the
// `courier_settlement_require_warning_ack` setting is on (default true).

import type { Provider } from '../parsing/types';

export type Severity = 'red' | 'yellow';
export type RuleScope = 'row' | 'invoice' | 'order' | 'adjustment';

export const MONEY_EPSILON = 0.01;
export const RESIDUAL_TOLERANCE = 0.05;
export const DEFAULT_RESIDUAL_THRESHOLD = 100;
export const DEFAULT_ARITHMETIC_TOLERANCE = 1;

/** The full slice of state a rule may inspect. Fields are optional so one type
 * serves every scope; each condition guards the fields it needs. */
export interface RuleContext {
  scope: RuleScope;
  provider?: Provider;

  // invoice / ingestion
  provenFinanceRule?: boolean;
  structureOnly?: boolean;
  checksumDuplicate?: boolean;
  sourceCorrupt?: boolean;
  malformedRatio?: number;
  providerFooterMismatch?: boolean;
  courierFormatMismatch?: boolean;
  accountingPending?: boolean;

  // row
  rowClass?: string;
  rowKind?: string;
  hasIdentifier?: boolean;
  matched?: boolean;
  malformedRow?: boolean;
  noCachedValue?: boolean;
  providerDataIncomplete?: boolean;
  unusualAdjustment?: boolean;
  residual?: number;
  residualThreshold?: number;
  arithmeticDelta?: number;
  arithmeticTolerance?: number;
  declaredCharges?: number;
  derivedCharges?: number;

  // settlement semantics
  expectedCod?: number;
  expectedCodDivergence?: boolean;
  codPosition?: number;
  grossCodCollected?: number;
  effectiveCollected?: number;
  effectiveNet?: number;
  duplicateSettlement?: boolean;
  previousSettlementExists?: boolean;

  // order / projection
  finalizedProjectionZero?: boolean;
  hasContributingRowWithZeroCharges?: boolean;

  // adjustment
  correctionDeltaR?: number;
  correctionCounterpart?: 'net' | 'gross' | 'variance' | null;

  // revision
  revisionDeltaUnpaired?: boolean;
}

export interface RuleFinding {
  id: string;
  severity: Severity;
  blocking: boolean;
  message: string;
  userAction: string;
  resolutionPath: string;
  scope: RuleScope;
}

export interface Rule {
  id: string;
  scope: RuleScope;
  /** providers this rule applies to; undefined = every provider. */
  providerScope?: Provider[];
  condition: (ctx: RuleContext) => boolean;
  severity: Severity | ((ctx: RuleContext) => Severity);
  blocking: boolean | ((ctx: RuleContext) => boolean);
  userAction: string;
  resolutionPath: string;
  reason: (ctx: RuleContext) => string;
}

const residualThreshold = (ctx: RuleContext) =>
  ctx.residualThreshold ?? DEFAULT_RESIDUAL_THRESHOLD;
const arithmeticTolerance = (ctx: RuleContext) =>
  ctx.arithmeticTolerance ?? DEFAULT_ARITHMETIC_TOLERANCE;
const isNegativePayoutKind = (kind?: string) =>
  kind === 'FEE_ONLY' || kind === 'BILLING_ONLY' || kind === 'RETURN' || kind === 'ADJUSTMENT';

/** The frozen, ordered ruleset. Order matters only for deterministic reporting. */
export const COURIER_SETTLEMENT_RULES: readonly Rule[] = [
  {
    id: 'DUPLICATE_FILE',
    scope: 'invoice',
    condition: (c) => c.checksumDuplicate === true,
    severity: 'red',
    blocking: true,
    userAction: 'Import as revision or discard the file',
    resolutionPath: 'revision / discard',
    reason: () => 'This file checksum was already imported.',
  },
  {
    id: 'SOURCE_CORRUPT',
    scope: 'invoice',
    condition: (c) => c.sourceCorrupt === true || (c.malformedRatio ?? 0) > 0.2,
    severity: 'red',
    blocking: true,
    userAction: 'Re-upload a cleaner source file',
    resolutionPath: 're-upload',
    reason: (c) => `More than 20% of rows are malformed (${Math.round((c.malformedRatio ?? 0) * 100)}%).`,
  },
  {
    id: 'UNPROVEN_FINANCE_RULE',
    scope: 'invoice',
    condition: (c) => c.provenFinanceRule === false || c.structureOnly === true,
    severity: 'red',
    blocking: true,
    userAction: 'Approve a finance rule for this provider/format',
    resolutionPath: 'finance-rule approval',
    reason: () => 'No approved finance rule exists for this provider/format; finalization is blocked.',
  },
  {
    id: 'COURIER_FORMAT_MISMATCH',
    scope: 'invoice',
    condition: (c) => c.courierFormatMismatch === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Confirm the selected courier matches the detected format',
    resolutionPath: 'confirm courier',
    reason: () => 'The picked courier differs from the detected file format.',
  },
  {
    id: 'PROVIDER_FOOTER_MISMATCH',
    scope: 'invoice',
    condition: (c) => c.providerFooterMismatch === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge (footer is excluded from the math)',
    resolutionPath: 'acknowledge',
    reason: () => 'Sum of data rows differs from the provider footer total.',
  },
  {
    id: 'ACCOUNTING_PENDING',
    scope: 'invoice',
    condition: (c) => c.accountingPending === true,
    severity: 'red',
    blocking: true,
    userAction: 'Repair accounting posting',
    resolutionPath: 'post-accounting repair',
    reason: () => 'Invoice is finalized but accounting has not posted; it must not render as settled.',
  },
  {
    id: 'MISSING_IDENTIFIER',
    scope: 'row',
    condition: (c) => c.rowClass === 'DATA' && c.hasIdentifier === false,
    severity: 'red',
    blocking: true,
    userAction: 'Map the identifier column or apply a class-A correction',
    resolutionPath: 'mapping / class-A correction',
    reason: () => 'Row carries no consignment / tracking / merchant identifier.',
  },
  {
    id: 'NO_MATCH',
    scope: 'row',
    condition: (c) => c.rowClass === 'DATA' && c.matched === false,
    severity: 'red',
    blocking: true,
    userAction: 'Manually match the row (audited) or apply a class-A correction',
    resolutionPath: 'manual match / class-A correction',
    reason: () => 'No order or dispatch could be resolved for this row.',
  },
  {
    id: 'DUPLICATE_SETTLEMENT',
    scope: 'row',
    condition: (c) => c.duplicateSettlement === true,
    severity: 'red',
    blocking: true,
    userAction: 'Use the revision flow or discard',
    resolutionPath: 'revision / discard',
    reason: () => 'The same (consignment, kind, collected, net) was finalized in another invoice.',
  },
  {
    id: 'OVER_SETTLEMENT',
    scope: 'order',
    condition: (c) => typeof c.codPosition === 'number' && c.codPosition < -MONEY_EPSILON,
    severity: 'red',
    blocking: true,
    userAction: 'Verify prior settlements or apply a class-C correction',
    resolutionPath: 'verify / class-C correction',
    reason: (c) => `Settlement exceeds what is owed (position ${fmt(c.codPosition)}).`,
  },
  {
    id: 'OVER_COLLECTION',
    scope: 'row',
    condition: (c) =>
      typeof c.grossCodCollected === 'number' &&
      typeof c.expectedCod === 'number' &&
      c.grossCodCollected > c.expectedCod + MONEY_EPSILON,
    severity: 'red',
    blocking: true,
    userAction: 'Investigate or apply a class-C correction',
    resolutionPath: 'investigate / class-C correction',
    reason: (c) =>
      `Collected ${fmt(c.grossCodCollected)} exceeds expected COD ${fmt(c.expectedCod)}.`,
  },
  {
    id: 'ARITHMETIC_MISMATCH_HARD',
    scope: 'row',
    condition: (c) =>
      typeof c.arithmeticDelta === 'number' &&
      Math.abs(c.arithmeticDelta) > arithmeticTolerance(c),
    severity: 'red',
    blocking: true,
    userAction: 'Correct the charge component mapping',
    resolutionPath: 'correct mapping',
    reason: (c) =>
      `Declared vs derived charges differ by ${fmt(c.arithmeticDelta)} (tolerance ${fmt(arithmeticTolerance(c))}).`,
  },
  {
    id: 'ARITHMETIC_MISMATCH_SOFT',
    scope: 'row',
    condition: (c) =>
      typeof c.arithmeticDelta === 'number' &&
      Math.abs(c.arithmeticDelta) > 0 &&
      Math.abs(c.arithmeticDelta) <= arithmeticTolerance(c),
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge the rounding difference',
    resolutionPath: 'acknowledge',
    reason: (c) => `Small arithmetic difference ${fmt(c.arithmeticDelta)} within tolerance.`,
  },
  {
    id: 'RESIDUAL_LARGE',
    scope: 'row',
    condition: (c) =>
      typeof c.residual === 'number' && Math.abs(c.residual) > residualThreshold(c),
    severity: 'red',
    blocking: true,
    userAction: 'Fix the mapping or approve a provider rule',
    resolutionPath: 'mapping / finance-rule approval',
    reason: (c) =>
      `Residual ${fmt(c.residual)} exceeds the ${fmt(residualThreshold(c))} threshold.`,
  },
  {
    id: 'RESIDUAL_UNEXPLAINED',
    scope: 'row',
    condition: (c) =>
      typeof c.residual === 'number' &&
      Math.abs(c.residual) > RESIDUAL_TOLERANCE &&
      Math.abs(c.residual) <= residualThreshold(c),
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge; the amount is posted to variance',
    resolutionPath: 'acknowledge (variance line)',
    reason: (c) => `Unexplained residual ${fmt(c.residual)} posted to the variance account.`,
  },
  {
    id: 'NEGATIVE_PAYOUT_VALID',
    scope: 'row',
    condition: (c) =>
      isNegativePayoutKind(c.rowKind) &&
      typeof c.effectiveNet === 'number' &&
      c.effectiveNet < -MONEY_EPSILON,
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge as a courier bill',
    resolutionPath: 'acknowledge',
    reason: (c) => `Negative payout ${fmt(c.effectiveNet)} on a billable row kind (${c.rowKind}).`,
  },
  {
    id: 'NEGATIVE_PAYOUT_UNEXPECTED',
    scope: 'row',
    condition: (c) =>
      c.rowKind === 'DELIVERY' &&
      typeof c.effectiveNet === 'number' &&
      c.effectiveNet < -MONEY_EPSILON &&
      (c.effectiveCollected ?? 0) > 0,
    severity: 'red',
    blocking: true,
    userAction: 'Investigate the delivery row with a negative payout',
    resolutionPath: 'investigate',
    reason: () => 'A delivery row that collected cash declares a negative payout.',
  },
  {
    id: 'UNKNOWN_ROW_KIND_WITH_AMOUNT',
    scope: 'row',
    condition: (c) =>
      c.rowKind === 'UNKNOWN' &&
      ((c.declaredCharges ?? 0) !== 0 ||
        (c.effectiveCollected ?? 0) !== 0 ||
        (c.effectiveNet ?? 0) !== 0),
    severity: 'yellow',
    blocking: false,
    userAction: 'Classify the row (class-A correction)',
    resolutionPath: 'class-A correction',
    reason: () => 'An UNKNOWN row carries financial amounts.',
  },
  {
    id: 'MALFORMED_ROW',
    scope: 'row',
    condition: (c) => c.malformedRow === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Correct the source and re-import',
    resolutionPath: 'correct source / re-import',
    reason: () => 'Ragged/malformed row preserved as UNKNOWN rather than dropped.',
  },
  {
    id: 'NO_CACHED_VALUE',
    scope: 'row',
    condition: (c) => c.noCachedValue === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Provide a cached value (formulas are never evaluated)',
    resolutionPath: 'correct source / re-import',
    reason: () => 'Formula cell has no cached value.',
  },
  {
    id: 'PROVIDER_DATA_INCOMPLETE',
    scope: 'row',
    condition: (c) => c.providerDataIncomplete === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge the missing provider fields',
    resolutionPath: 'acknowledge',
    reason: () => 'Provider row is missing dates/status or uses an unproven combination.',
  },
  {
    id: 'UNUSUAL_ADJUSTMENT',
    scope: 'row',
    condition: (c) => c.unusualAdjustment === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Inspect the provider adjustment column',
    resolutionPath: 'inspect',
    reason: () => 'Provider adjustment column is non-zero.',
  },
  {
    id: 'PARTIAL_SETTLEMENT',
    scope: 'row',
    condition: (c) =>
      (c.effectiveCollected ?? 0) > 0 &&
      typeof c.codPosition === 'number' &&
      c.codPosition > MONEY_EPSILON,
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge; expect the next invoice',
    resolutionPath: 'acknowledge',
    reason: () => 'Collected is positive but a balance remains outstanding.',
  },
  {
    id: 'PREVIOUS_SETTLEMENT_EXISTS',
    scope: 'row',
    condition: (c) => c.previousSettlementExists === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Verify the math across settlements',
    resolutionPath: 'acknowledge',
    reason: () => 'This order already has finalized settlement rows.',
  },
  {
    id: 'EXPECTED_COD_DIVERGENCE',
    scope: 'order',
    condition: (c) => c.expectedCodDivergence === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Acknowledge the cash-payment vs order-total source choice',
    resolutionPath: 'acknowledge',
    reason: () => 'Cash-payment sum differs from Order.total.',
  },
  {
    id: 'ZERO_COST_REVIEW',
    scope: 'order',
    condition: (c) =>
      c.finalizedProjectionZero === true && c.hasContributingRowWithZeroCharges === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Review invoice/provider rules (the 0 is written and visible)',
    resolutionPath: 'acknowledge',
    reason: () =>
      'Invoice covers the order but declares no courier charge; the 0 projection is recorded.',
  },
  {
    id: 'CORRECTION_COUNTERPART_REQUIRED',
    scope: 'adjustment',
    condition: (c) =>
      typeof c.correctionDeltaR === 'number' &&
      Math.abs(c.correctionDeltaR) > MONEY_EPSILON &&
      !c.correctionCounterpart,
    severity: 'red',
    blocking: true,
    userAction: 'Declare the counterpart (net / gross / variance) in the adjustment dialog',
    resolutionPath: 'declare counterpart',
    reason: (c) =>
      `Correction residual delta ${fmt(c.correctionDeltaR)} is unexplained; a counterpart is required.`,
  },
  {
    id: 'UNEXPLAINED_CORRECTION_DELTA',
    scope: 'adjustment',
    condition: (c) => c.correctionCounterpart === 'variance',
    severity: (c) =>
      Math.abs(c.correctionDeltaR ?? 0) > residualThreshold(c) ? 'red' : 'yellow',
    blocking: false,
    userAction: 'Acknowledge; the amount is parked in the variance account',
    resolutionPath: 'acknowledge',
    reason: (c) =>
      `Correction delta ${fmt(c.correctionDeltaR)} parked in variance (counterpart=variance).`,
  },
  {
    id: 'REVISION_DELTA_UNPAIRED',
    scope: 'invoice',
    condition: (c) => c.revisionDeltaUnpaired === true,
    severity: 'yellow',
    blocking: false,
    userAction: 'Review the order-level delta',
    resolutionPath: 'acknowledge',
    reason: () => 'Revision rows could not be paired 1:1; processed as an order-level delta.',
  },
];

const RULE_INDEX = new Map(COURIER_SETTLEMENT_RULES.map((r) => [r.id, r]));
export function getRule(id: string): Rule | undefined {
  return RULE_INDEX.get(id);
}

/** Evaluate the frozen table for one context and return only firing findings. */
export function evaluateRules(ctx: RuleContext): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of COURIER_SETTLEMENT_RULES) {
    if (rule.scope !== ctx.scope) continue;
    if (rule.providerScope && ctx.provider && !rule.providerScope.includes(ctx.provider)) {
      continue;
    }
    if (!rule.condition(ctx)) continue;
    const severity = typeof rule.severity === 'function' ? rule.severity(ctx) : rule.severity;
    const blocking = typeof rule.blocking === 'function' ? rule.blocking(ctx) : rule.blocking;
    findings.push({
      id: rule.id,
      severity,
      blocking,
      message: rule.reason(ctx),
      userAction: rule.userAction,
      resolutionPath: rule.resolutionPath,
      scope: rule.scope,
    });
  }
  return findings;
}

/** Worst severity across findings (red > yellow > none). */
export function worstSeverity(findings: RuleFinding[]): 'red' | 'yellow' | 'green' {
  if (findings.some((f) => f.severity === 'red')) return 'red';
  if (findings.some((f) => f.severity === 'yellow')) return 'yellow';
  return 'green';
}

/** Finalization is gated by any blocking rule OR an unacknowledged warning. */
export function isBlocked(findings: RuleFinding[], acknowledgedIds: Set<string>, requireWarningAck: boolean): boolean {
  for (const f of findings) {
    if (f.severity === 'red') return true;
    if (f.blocking) return true;
    if (requireWarningAck && !acknowledgedIds.has(f.id)) return true;
  }
  return false;
}

function fmt(n: number | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toFixed(2);
}