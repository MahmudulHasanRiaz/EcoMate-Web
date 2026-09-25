import { TrendChip } from '@/components/ui/dashboard'
import { formatDelta, formatDeltaPct } from '../types'

/**
 * Signed delta vs the previous window — explicit +/- so negative-friendly
 * metrics read correctly. The label always renders visibly (never an
 * anonymous chip); the same string doubles as the accessible name.
 */
export function ComparisonDelta({
  current,
  previous,
  format,
  invert,
  label,
}: {
  current: number
  previous: number
  format?: (v: number) => string
  /** Set for cost lines where a decrease is good (colour only — the sign never flips). */
  invert?: boolean
  label: string
}) {
  const delta = current - previous
  const pct = previous !== 0 ? (delta / Math.abs(previous)) * 100 : null
  const good = delta === 0 ? null : (delta > 0) !== Boolean(invert)
  const direction = good === null ? 'flat' : good ? 'up' : 'down'
  return (
    <div className="flex flex-col gap-1.5" aria-label={`${label} change vs previous period`}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <TrendChip direction={direction}>
          {format ? `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${format(Math.abs(delta))}` : formatDelta(delta)}
        </TrendChip>
        <span className="text-muted-foreground">({formatDeltaPct(pct)} vs prev)</span>
      </div>
    </div>
  )
}
