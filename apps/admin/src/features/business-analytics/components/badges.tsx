import { Badge } from '@/components/ui/badge'
import type { CostState } from '../types'

const COST_STATE_VARIANT = {
  actual: 'success',
  estimated: 'warning',
  unavailable: 'danger',
  not_applicable: 'outline',
} as const

const COST_STATE_LABEL: Record<CostState, string> = {
  actual: 'Actual',
  estimated: 'Estimated',
  unavailable: 'Unavailable',
  not_applicable: 'N/A',
}

/** Per-line cost provenance (§2.3). not_applicable renders muted "N/A", visually distinct from unavailable. */
export function CostStateBadge({ state, reason }: { state: CostState; reason?: string }) {
  return (
    <Badge variant={COST_STATE_VARIANT[state]} title={reason}>
      {COST_STATE_LABEL[state]}
    </Badge>
  )
}

/** Missing-input counts that drill to their fix-list (§4.2 coverage badges). */
export function DataCoverageBadge({
  missing,
  label,
  title,
}: {
  missing: number
  label: string
  title?: string
}) {
  if (missing <= 0) return null
  return (
    <Badge variant="warning" title={title}>
      {label}: {missing} missing
    </Badge>
  )
}

/** A metric with no admissible figure — renders words, never ৳0 (§6 empty-vs-zero). */
export function MetricUnavailable({ reason, compact }: { reason?: string; compact?: boolean }) {
  return (
    <div className={compact ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
      <span className="font-medium text-danger/90">Unavailable</span>
      {reason ? <span className="block text-xs mt-0.5">{reason}</span> : null}
    </div>
  )
}
