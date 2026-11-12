import type { Q8SettleResult, ReconReport, ReconRow } from '../reconciliation'

/**
 * Pure helpers for the Reconciliation one-click-fix flow (2026-11-12).
 * No React, no I/O — unit-tested in
 * apps/admin/src/features/inventory/__tests__/recon-one-click.test.tsx.
 */

/** Bengali digits: 0→০ … 9→৯. */
export const toBnDigits = (n: number): string =>
  String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)])

/** Rows the backend will apply: R1/R2/R6 plus evidence-backed R8. */
export const isApplicableReconRow = (r: ReconRow): boolean =>
  r.category === 'R1' ||
  r.category === 'R2' ||
  r.category === 'R6' ||
  (r.category === 'R8' && r.r8Kind !== 'human')

export type ReconVerdictState = 'not-run' | 'ok' | 'issues'

export interface ReconVerdict {
  state: ReconVerdictState
  /** Applicable rows + failing Q checks — the number shown in the banner. */
  problemCount: number
  applicableCount: number
  failingCheckCount: number
}

/**
 * Verdict for the top banner. GREEN only when there is nothing applicable
 * left to fix AND no Q check fails. Counts come from the rows (not the
 * counts object) so evidence-backed R8 is exact and R8-H never counts.
 */
export function computeReconVerdict(report: ReconReport | null): ReconVerdict {
  if (!report) {
    return { state: 'not-run', problemCount: 0, applicableCount: 0, failingCheckCount: 0 }
  }
  const applicableCount = report.rows.filter(isApplicableReconRow).length
  const failingCheckCount = report.checks.filter((c) => c.pass === false).length
  const problemCount = applicableCount + failingCheckCount
  return {
    state: problemCount === 0 ? 'ok' : 'issues',
    problemCount,
    applicableCount,
    failingCheckCount,
  }
}

export interface ReconPreviewLine {
  key: 'R1' | 'R2' | 'R6' | 'R8' | 'Q8'
  count: number
  /** Plain Bengali line, Bengali digits, no R/Q codes visible to the user
      except as a stable key for tests — the text itself has no codes. */
  text: string
}

export interface ReconPreview {
  /** One line per fixable category with count > 0. */
  fixLines: ReconPreviewLine[]
  /** R4 human decisions + R3/R7/R8-H report-only — never fixed automatically. */
  notFixedCount: number
  fixable: boolean
}

/**
 * Plain-language preview of what the one-click fix WILL do. Counts are
 * derived from the report rows (R8 evidence-backed only) and — for
 * superadmins — from the q8-settle dry-run preview. R4/R3/R7/R8-H are
 * never in fixLines; they are summed into notFixedCount.
 */
export function buildReconPreview(
  report: ReconReport,
  q8Preview: Q8SettleResult | null,
  isSuperAdmin: boolean,
): ReconPreview {
  const countRows = (predicate: (r: ReconRow) => boolean) =>
    report.rows.filter(predicate).length
  const r1 = countRows((r) => r.category === 'R1')
  const r2 = countRows((r) => r.category === 'R2')
  const r6 = countRows((r) => r.category === 'R6')
  const r8 = countRows((r) => r.category === 'R8' && r.r8Kind !== 'human')

  const fixLines: ReconPreviewLine[] = []
  if (r1 > 0) {
    fixLines.push({ key: 'R1', count: r1, text: `${toBnDigits(r1)}টা মিস হওয়া restock যোগ হবে` })
  }
  if (r2 > 0) {
    fixLines.push({
      key: 'R2',
      count: r2,
      text: `${toBnDigits(r2)}টা ফেরত মালের physical stock ঠিক হবে`,
    })
  }
  if (r6 > 0) {
    fixLines.push({
      key: 'R6',
      count: r6,
      text: `${toBnDigits(r6)}টা আটকে থাকা managed stock ছেড়ে দেওয়া হবে`,
    })
  }
  if (r8 > 0) {
    fixLines.push({
      key: 'R8',
      count: r8,
      text: `${toBnDigits(r8)}টা পুরনো অর্ডারের Return রেকর্ড তৈরি হবে`,
    })
  }
  if (isSuperAdmin && q8Preview) {
    const released = q8Preview.settled.releasedUnits
    if (released > 0) {
      fixLines.push({
        key: 'Q8',
        count: released,
        text: `${toBnDigits(released)}টা আটকে থাকা reservation ছেড়ে দেওয়া হবে`,
      })
    }
  }

  const notFixedCount =
    report.counts.R4 + report.counts.R3 + report.counts.R7 + report.counts.R8H
  return { fixLines, notFixedCount, fixable: fixLines.length > 0 }
}
