import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExceptionSeverity, ExceptionStatus, InvoiceState } from './api'

/**
 * Invoice lifecycle state, mirroring `CourierSettlementInvoiceState`.
 * Colour carries phase (ingest / review / financially finalized / failed) and
 * the text always spells it out, so no meaning rides on colour alone.
 * Token-backed badge variants — correct in light and dark mode alike.
 */
const STATE_VARIANT = {
  UPLOADED: 'outline',
  ANALYZED: 'outline',
  MAPPING_REQUIRED: 'warning',
  IMPORTING: 'info',
  READY_FOR_REVIEW: 'info',
  REVIEW_REQUIRED: 'warning',
  ISSUE_FOUND: 'warning',
  FINALIZING: 'info',
  FINALIZED_PENDING_ACCOUNTING: 'info',
  ACCOUNTING_POSTED: 'success',
  ACCOUNTING_SKIPPED_ACCOUNTING_DISABLED: 'cyan',
  ACCOUNTING_FAILED: 'danger',
  ADJUSTED: 'violet',
  RECONCILED: 'cyan',
  DISCARDED: 'danger',
} as const

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

export const ALL_INVOICE_STATES = Object.keys(STATE_VARIANT) as InvoiceState[]

export function InvoiceStateBadge({ state }: { state: InvoiceState | string }) {
  const known = ALL_INVOICE_STATES.includes(state as InvoiceState)
  const s = (known ? state : 'UPLOADED') as InvoiceState
  const pulse = s === 'IMPORTING' || s === 'FINALIZING' ? 'skeleton-shimmer' : ''
  return (
    <Badge variant={STATE_VARIANT[s]} className={cn('font-medium', pulse)}>
      {STATE_LABEL[s]}
    </Badge>
  )
}

const SEVERITY_VARIANT = {
  red: 'danger',
  yellow: 'warning',
} as const

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
      <Badge variant={SEVERITY_VARIANT[severity]}>
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
    state === 'red' ? 'bg-danger' : state === 'yellow' ? 'bg-warning' : 'bg-success'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-full', color)} aria-hidden />
      <span className="capitalize text-xs text-muted-foreground">{state}</span>
    </span>
  )
}
