import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExceptionSeverity, ExceptionStatus, InvoiceState } from './api'

/**
 * Invoice lifecycle state, mirroring `CourierSettlementInvoiceState`.
 * Colour carries phase (ingest / review / financially finalized / failed) and
 * the text always spells it out, so no meaning rides on colour alone.
 */
const STATE_STYLE: Record<InvoiceState, string> = {
  UPLOADED: 'bg-muted text-foreground',
  ANALYZED: 'bg-muted text-foreground',
  MAPPING_REQUIRED: 'bg-amber-100 text-amber-800',
  IMPORTING: 'bg-blue-100 text-blue-800 animate-pulse',
  READY_FOR_REVIEW: 'bg-blue-100 text-blue-800',
  REVIEW_REQUIRED: 'bg-amber-100 text-amber-800',
  ISSUE_FOUND: 'bg-amber-100 text-amber-800',
  FINALIZING: 'bg-blue-100 text-blue-800 animate-pulse',
  FINALIZED_PENDING_ACCOUNTING: 'bg-blue-100 text-blue-800',
  ACCOUNTING_POSTED: 'bg-emerald-100 text-emerald-800',
  ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED: 'bg-teal-100 text-teal-800',
  ACCOUNTING_FAILED: 'bg-red-100 text-red-800',
  ADJUSTED: 'bg-violet-100 text-violet-800',
  RECONCILED: 'bg-teal-100 text-teal-800',
  DISCARDED: 'bg-red-100 text-red-800',
}

const STATE_LABEL: Record<InvoiceState, string> = {
  UPLOADED: 'Uploaded',
  ANALYZED: 'Analyzed',
  MAPPING_REQUIRED: 'Mapping required',
  IMPORTING: 'Importing…',
  READY_FOR_REVIEW: 'Ready for review',
  REVIEW_REQUIRED: 'Review required',
  ISSUE_FOUND: 'Issue found',
  FINALIZING: 'Finalizing…',
  FINALIZED_PENDING_ACCOUNTING: 'Finalized',
  ACCOUNTING_POSTED: 'Accounting posted',
  ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED: 'Finalized (no accounting)',
  ACCOUNTING_FAILED: 'Accounting failed',
  ADJUSTED: 'Adjusted',
  RECONCILED: 'Reconciled',
  DISCARDED: 'Discarded',
}

export const ALL_INVOICE_STATES = Object.keys(STATE_STYLE) as InvoiceState[]

export function InvoiceStateBadge({ state }: { state: InvoiceState | string }) {
  const known = ALL_INVOICE_STATES.includes(state as InvoiceState)
  const s = (known ? state : 'UPLOADED') as InvoiceState
  return (
    <Badge variant="outline" className={cn('font-medium', STATE_STYLE[s])}>
      {STATE_LABEL[s]}
    </Badge>
  )
}

const SEVERITY_STYLE: Record<ExceptionSeverity, string> = {
  red: 'bg-red-100 text-red-800 border-red-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
}

const STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  waived: 'Waived',
}

export function ExceptionBadge({
  severity,
  status,
}: {
  severity: ExceptionSeverity
  status?: ExceptionStatus
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={SEVERITY_STYLE[severity]}>
        {severity === 'red' ? 'RED' : 'YELLOW'}
      </Badge>
      {status && status !== 'open' ? (
        <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
      ) : null}
    </span>
  )
}

/** Review state materialised on a row (green/yellow/red). */
export function ReviewStateDot({ state }: { state: string }) {
  const color =
    state === 'red' ? 'bg-red-500' : state === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', color)} aria-hidden />
      <span className="capitalize text-xs text-muted-foreground">{state}</span>
    </span>
  )
}
