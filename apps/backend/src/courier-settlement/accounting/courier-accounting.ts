// ── Courier Settlement accounting (PRD §4, §8.2, §16) — pure entry builder.
//
// Clearing-based, self-balancing per invoice. Orders post no revenue journals;
// the COD cash the courier holds on our behalf sits in `courier-cod-clearing`
// until the ledger recognises revenue. Unexplained money goes to the dedicated
// `courier-settlement-variance` account and is always surfaced as an exception.

export const MONEY_EPSILON = 0.01;

export type AccountKey = 'cash' | 'expense' | 'clearing' | 'variance';
export type Counterpart = 'net' | 'gross' | 'variance';

export interface LedgerLine {
  account: AccountKey;
  debit: number;
  credit: number;
}

export interface FinalizationEntryInput {
  /** gross COD collected (may be 0). */
  gross: number;
  /** courier charges (positive = cost deducted). */
  charges: number;
  /** signed net settlement (may be negative). */
  net: number;
}

export interface EntryResult {
  lines: LedgerLine[];
  residual: number;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/**
 * §4 entry at finalization. residual = gross − charges − net is routed to the
 * variance account (never asserted as expense). Balance proof:
 * `net + charges + residual − gross = 0` for every sign.
 */
export function buildFinalizationEntry(input: FinalizationEntryInput): EntryResult {
  const gross = round2(input.gross);
  const charges = round2(input.charges);
  const net = round2(input.net);
  const residual = round2(gross - charges - net);

  const lines: LedgerLine[] = [];
  // cash = net → Dr if net > 0 else Cr
  if (Math.abs(net) > MONEY_EPSILON) {
    lines.push(
      net > 0 ? line('cash', net, 0) : line('cash', 0, Math.abs(net)),
    );
  }
  // expense = charges → Dr
  if (Math.abs(charges) > MONEY_EPSILON) {
    lines.push(charges > 0 ? line('expense', charges, 0) : line('expense', 0, Math.abs(charges)));
  }
  // variance = residual → Dr if > 0 else Cr (omitted when 0)
  if (Math.abs(residual) > MONEY_EPSILON) {
    lines.push(
      residual > 0 ? line('variance', residual, 0) : line('variance', 0, Math.abs(residual)),
    );
  }
  // clearing = gross → Cr (omitted when 0)
  if (Math.abs(gross) > MONEY_EPSILON) {
    lines.push(gross > 0 ? line('clearing', 0, gross) : line('clearing', Math.abs(gross), 0));
  }

  return finalizeResult(lines, residual);
}

export interface CorrectionInput {
  /** deltas: value after correction − value before. */
  deltaG: number;
  deltaC: number;
  deltaN: number;
  /** required when ΔR ≠ 0; declared by the operator. */
  counterpart?: Counterpart | null;
  /** variance threshold above which UNEXPLAINED_CORRECTION_DELTA is RED. */
  residualThreshold?: number;
}

export interface CorrectionResult extends EntryResult {
  deltaR: number;
  counterpart: Counterpart | null;
  /** true when ΔR ≠ 0 was declared (accepted via counterpart). */
  counterpartUsed: boolean;
  /** set when the correction must be rejected (ΔR ≠ 0, no counterpart). */
  rejected: boolean;
  rejectionReason?: string;
  /** true when counterpart='variance' and ΔR exceeds the threshold (RED). */
  varianceOverThreshold: boolean;
}

/**
 * §8.2 correction entry. ΔR = ΔG − ΔC − ΔN. A correction with ΔR ≠ 0 must
 * declare a counterpart; otherwise it is rejected at validation (never posted).
 * The delta → journal mapping is applied identically for class B and C.
 */
export function buildCorrectionEntry(input: CorrectionInput): CorrectionResult {
  const deltaG = round2(input.deltaG);
  const deltaC = round2(input.deltaC);
  const deltaN = round2(input.deltaN);
  const deltaR = round2(deltaG - deltaC - deltaN);
  const counterpart = input.counterpart ?? null;
  const threshold = input.residualThreshold ?? 100;

  if (Math.abs(deltaR) > MONEY_EPSILON && !counterpart) {
    return {
      ...emptyResult(),
      deltaR,
      counterpart: null,
      counterpartUsed: false,
      rejected: true,
      rejectionReason:
        `Correction residual delta ${deltaR.toFixed(2)} is unexplained; declare a counterpart ` +
        `(net | gross | variance).`,
      varianceOverThreshold: false,
    };
  }

  const lines: LedgerLine[] = [];
  // ΔN → cash: Dr when > 0, Cr when < 0
  pushSigned(lines, 'cash', deltaN, 'DrOnPositive');
  // ΔC → expense: Dr when > 0, Cr when < 0
  pushSigned(lines, 'expense', deltaC, 'DrOnPositive');
  // ΔR → variance: Dr when > 0, Cr when < 0
  pushSigned(lines, 'variance', deltaR, 'DrOnPositive');
  // ΔG → clearing: Cr when > 0, Dr when < 0 (inverse)
  pushSigned(lines, 'clearing', deltaG, 'CrOnPositive');

  const result = finalizeResult(lines, deltaR);
  return {
    ...result,
    deltaR,
    counterpart,
    counterpartUsed: Math.abs(deltaR) > MONEY_EPSILON,
    rejected: false,
    varianceOverThreshold: counterpart === 'variance' && Math.abs(deltaR) > threshold,
  };
}

/** §8.2 effective codPosition delta = −(ΔC + ΔN); ΔG never touches cost. */
export function codPositionDelta(deltaC: number, deltaN: number): number {
  return round2(-(round2(deltaC) + round2(deltaN)));
}

/** §8.2: Order.shippingCost changes only via ΔC. */
export function costDelta(deltaC: number): number {
  return round2(deltaC);
}

/** Parse a compact "Dr Account / Cr Account" label for UI/test assertions. */
export function describeEntry(result: EntryResult): string {
  const parts: string[] = [];
  for (const l of result.lines) {
    if (l.debit > MONEY_EPSILON) parts.push(`Dr ${l.account} ${l.debit.toFixed(2)}`);
    if (l.credit > MONEY_EPSILON) parts.push(`Cr ${l.account} ${l.credit.toFixed(2)}`);
  }
  return parts.join(' · ');
}

// ── internals ──

function line(account: AccountKey, debit: number, credit: number): LedgerLine {
  return { account, debit: round2(debit), credit: round2(credit) };
}

function pushSigned(
  lines: LedgerLine[],
  account: AccountKey,
  value: number,
  mode: 'DrOnPositive' | 'CrOnPositive',
): void {
  if (Math.abs(value) <= MONEY_EPSILON) return;
  const positive = value > 0;
  const magnitude = Math.abs(value);
  const isDr = mode === 'DrOnPositive' ? positive : !positive;
  lines.push(isDr ? line(account, magnitude, 0) : line(account, 0, magnitude));
}

function finalizeResult(lines: LedgerLine[], residual: number): EntryResult {
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return {
    lines,
    residual,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) <= MONEY_EPSILON,
  };
}

function emptyResult(): EntryResult {
  return { lines: [], residual: 0, totalDebit: 0, totalCredit: 0, balanced: true };
}

export function round2(n: number): number {
  return Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;
}