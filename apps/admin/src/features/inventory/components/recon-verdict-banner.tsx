import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { computeReconVerdict } from './recon-helpers'
import type { ReconReport } from '../reconciliation'

/**
 * Verdict banner for the Reconciliation one-click-fix flow (2026-11-12).
 * Plain English, no R/Q codes in the default view.
 *
 * - No report loaded yet → neutral "Not checked yet".
 * - 0 applicable rows AND no failing Q check → green "All good".
 * - Otherwise → amber "N problems found".
 */
export function ReconVerdictBanner({ report }: { report: ReconReport | null }) {
  const verdict = computeReconVerdict(report)

  if (verdict.state === 'not-run') {
    return (
      <div
        role='status'
        className='flex items-center gap-2 rounded-md border px-4 py-3 text-sm text-muted-foreground'
      >
        <Info className='h-5 w-5 shrink-0' />
        <span>Not checked yet — check your stock with the button below.</span>
      </div>
    )
  }

  if (verdict.state === 'ok') {
    return (
      <div
        role='status'
        className='flex items-center gap-2 rounded-md border border-green-600/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-200'
      >
        <CheckCircle2 className='h-5 w-5 shrink-0' />
        <span>All good — no problems found.</span>
      </div>
    )
  }

  return (
    <div
      role='status'
      className='flex items-center gap-2 rounded-md border border-amber-600/30 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200'
    >
      <AlertTriangle className='h-5 w-5 shrink-0' />
      <span>{verdict.problemCount} problems found — fix them with the button below.</span>
    </div>
  )
}
