import { TrendChip } from '@/components/ui/dashboard'
import { formatDelta, formatDeltaPct } from '../types'

/** Signed delta vs the previous window — explicit +/- so negative-friendly metrics read correctly. */
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
    <div className="flex items-baseline flex-wrap gap-2 text-xs" aria-label={`${label} change vs previous period`}>
      <TrendChip direction={direction}>
        {format ? `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${format(Math.abs(delta))}` : formatDelta(delta)}
      </TrendChip>
      <span className="text-muted-foreground">({formatDeltaPct(pct)} vs prev)</span>
    </div>
  )
}
