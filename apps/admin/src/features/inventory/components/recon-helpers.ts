import type { Q8SettleResult, ReconReport, ReconRow } from '../reconciliation'

/**
 * Pure helpers for the Reconciliation one-click-fix flow (2026-11-12).
 * No React, no I/O — unit-tested in
 * apps/admin/src/features/inventory/__tests__/recon-one-click.test.tsx.
 */

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
  /** Plain English line, no R/Q codes visible to the user except as a
      stable key for tests — the text itself has no codes. */
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
    fixLines.push({ key: 'R1', count: r1, text: `${r1} missed restock(s) will be added` })
  }
  if (r2 > 0) {
    fixLines.push({
      key: 'R2',
      count: r2,
      text: `${r2} returned item(s)' physical stock will be fixed`,
    })
  }
  if (r6 > 0) {
    fixLines.push({
      key: 'R6',
      count: r6,
      text: `${r6} stranded managed stock unit(s) will be released`,
    })
  }
  if (r8 > 0) {
    fixLines.push({
      key: 'R8',
      count: r8,
      text: `A Return record will be created for ${r8} old order(s)`,
    })
  }
  if (isSuperAdmin && q8Preview) {
    const released = q8Preview.settled.releasedUnits
    if (released > 0) {
      fixLines.push({
        key: 'Q8',
        count: released,
        text: `${released} stuck reservation(s) will be released`,
      })
    }
  }

  const notFixedCount =
    report.counts.R4 + report.counts.R3 + report.counts.R7 + report.counts.R8H
  return { fixLines, notFixedCount, fixable: fixLines.length > 0 }
}

// ── Details sheet (2026-11-12): one row per finding ─────────────────────

export type ReconSheetResult = 'Auto-fix' | 'Needs you'

export interface ReconSheetRow {
  /** React key + expansion identity — the backend row id, never rendered
      (it embeds R-codes and UUIDs). */
  key: string
  /** Short plain problem, no codes. */
  problem: string
  /** Fuller plain explanation, shown in the expanded row. */
  detail: string
  /** Order display id, or '—' when the finding has no order (R6/R7). */
  orderLabel: string
  /** Product name — 'Unknown product' when the backend sent the raw id. */
  itemLabel: string
  /** The single quantity that matters for this finding, or null when there
      is no meaningful one (R4: unknowable) — renders as '—'. */
  qty: number | null
  result: ReconSheetResult
  /** Backend evidence verbatim — shown only in the expanded row. */
  evidence: string
  returnLabel: string | null
  layer: ReconRow['layer']
  /** Full quantity breakdown for the expanded row. */
  orderedQty: number
  receivedGoodQty: number
  damagedQty: number
  alreadyRestoredManaged: number
  alreadyRestoredPhysical: number
  missingManagedQty: number
  missingPhysicalQty: number
}

/** A UUID-shaped value. The backend falls back to the raw product id as
    the product name when it never joined the product (R3 lingering-flag
    rows, R7 rows for a missing product, R1/R2 rows for a deleted product)
    — that id must never reach the sheet. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function itemLabelFor(r: ReconRow): string {
  const name = (r.productName ?? '').trim()
  if (!name || UUID_RE.test(name) || name === r.productId) return 'Unknown product'
  return name
}

/** The single quantity for the Qty column. Each category carries its
    meaningful number in a different field; R6/R7 only exist on the
    backend row (strandedManagedQty / physicalQty), not in the other
    quantity columns. */
function sheetQty(r: ReconRow): number | null {
  switch (r.category) {
    case 'R1':
    case 'R2': {
      const missing = r.missingManagedQty + r.missingPhysicalQty
      return missing > 0 ? missing : null
    }
    case 'R3':
      // Physical rows (never-engaged layer) carry the received amount;
      // lingering-flag rows carry the order-line quantity. Both are
      // report-only, so the number is "units involved", not "units to fix".
      if (r.layer === 'physical') return r.receivedGoodQty > 0 ? r.receivedGoodQty : null
      return r.orderedQty > 0 ? r.orderedQty : null
    case 'R4':
      return null // quantity unknowable by definition
    case 'R6': {
      // Signed: a negative residue means the managed counter sits below
      // zero. The sheet shows the magnitude of the correction.
      const q = r.strandedManagedQty
      return typeof q === 'number' && q !== 0 ? Math.abs(q) : null
    }
    case 'R7': {
      const q = r.physicalQty
      return typeof q === 'number' && q > 0 ? q : null
    }
    case 'R8':
      return r.orderedQty > 0 ? r.orderedQty : null
  }
}

/** Plain problem + fuller explanation per category. R3 splits on layer:
    'physical' rows are the never-engaged physical layer, 'managed' rows
    are lingering flags on cancelled/returned orders. */
function sheetProblem(r: ReconRow): { problem: string; detail: string } {
  switch (r.category) {
    case 'R1':
      return {
        problem: 'Missed restock',
        detail:
          'This return was received, but the managed stock was never added back. The fix adds the missing units.',
      }
    case 'R2':
      return {
        problem: 'Physical stock not fixed',
        detail:
          'This return was received, but the physical stock was never fixed. The fix corrects the physical stock.',
      }
    case 'R3':
      return r.layer === 'physical'
        ? {
            problem: 'Physical stock never used',
            detail:
              'The physical stock was never used for this return, so there is no shortage to fix. A person needs to check it.',
          }
        : {
            problem: 'Stock flags still set',
            detail:
              'This order was cancelled or returned, but its stock flags are still set. The normal receive path owns this — report only, never fixed here.',
          }
    case 'R4':
      return {
        problem: 'Quantity unknown',
        detail:
          'This return has no recorded quantity, so the received amount cannot be worked out. A person must decide.',
      }
    case 'R6':
      return {
        problem: 'Stranded managed stock',
        detail:
          'Managed stock was left over after this product switched to inventory control. The fix releases it.',
      }
    case 'R7':
      return {
        problem: 'Suspected leftover stock',
        detail:
          'Physical stock exists with no record of where it came from. A person must decide — never fixed automatically.',
      }
    case 'R8':
      return r.r8Kind === 'human'
        ? {
            problem: 'Old return, unclear evidence',
            detail: 'An old return whose evidence is unclear. A person must decide.',
          }
        : {
            problem: 'Old return, no Return record',
            detail:
              'An old return from before the Return system, with clear evidence. The fix creates a Return record; staff receive it through the normal manual flow.',
          }
  }
}

/**
 * One sheet row per finding, in report order. Nothing is dropped or
 * collapsed away: every row appears, report-only rows included, and the
 * Result column honestly says Auto-fix vs Needs you (the same
 * isApplicableReconRow rule the backend applies).
 */
export function buildReconSheetRows(report: ReconReport): ReconSheetRow[] {
  return report.rows.map((r) => {
    const { problem, detail } = sheetProblem(r)
    return {
      key: r.id,
      problem,
      detail,
      orderLabel: r.orderDisplayId?.trim() ? r.orderDisplayId : '—',
      itemLabel: itemLabelFor(r),
      qty: sheetQty(r),
      result: isApplicableReconRow(r) ? 'Auto-fix' : 'Needs you',
      evidence: r.evidence,
      returnLabel: r.returnDisplayId ?? null,
      layer: r.layer,
      orderedQty: r.orderedQty,
      receivedGoodQty: r.receivedGoodQty,
      damagedQty: r.damagedQty,
      alreadyRestoredManaged: r.alreadyRestoredManaged,
      alreadyRestoredPhysical: r.alreadyRestoredPhysical,
      missingManagedQty: r.missingManagedQty,
      missingPhysicalQty: r.missingPhysicalQty,
    }
  })
}
