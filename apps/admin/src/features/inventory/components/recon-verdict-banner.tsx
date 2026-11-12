import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { computeReconVerdict, toBnDigits } from './recon-helpers'
import type { ReconReport } from '../reconciliation'

/**
 * Verdict banner for the Reconciliation one-click-fix flow (2026-11-12).
 * Plain Bengali, no R/Q codes in the default view.
 *
 * - No report loaded yet → neutral "এখনো যাচাই করা হয়নি".
 * - 0 applicable rows AND no failing Q check → green "সব ঠিক আছে".
 * - Otherwise → amber "Nটা সমস্যা পাওয়া গেছে".
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
        <span>এখনো যাচাই করা হয়নি — নিচের বোতামে স্টক যাচাই করুন।</span>
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
        <span>সব ঠিক আছে — কোনো সমস্যা পাওয়া যায়নি।</span>
      </div>
    )
  }

  return (
    <div
      role='status'
      className='flex items-center gap-2 rounded-md border border-amber-600/30 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200'
    >
      <AlertTriangle className='h-5 w-5 shrink-0' />
      <span>{toBnDigits(verdict.problemCount)}টা সমস্যা পাওয়া গেছে — নিচের বোতামে ঠিক করুন।</span>
    </div>
  )
}
