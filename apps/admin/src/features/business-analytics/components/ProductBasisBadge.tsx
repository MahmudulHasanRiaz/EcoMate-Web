import { Badge } from '@/components/ui/badge'

const BASIS_STYLE: Record<'direct' | 'allocated' | 'attributed', string> = {
  direct: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  allocated: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
  attributed: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
}

const BASIS_TITLE: Record<'direct' | 'allocated' | 'attributed', string> = {
  direct: 'Direct — the order’s own lines (combos expanded, never double-counted)',
  allocated: 'Allocated — order totals × lineNet ÷ orderNet',
  attributed: 'Attributed — ProductMarketingCost per orderItemId (analytical dimension)',
}

/** §2.6 basis label: every product P&L line states direct / allocated / attributed. */
export function BasisBadge({ basis }: { basis: 'direct' | 'allocated' | 'attributed' }) {
  return (
    <Badge variant="outline" className={BASIS_STYLE[basis]} title={BASIS_TITLE[basis]}>
      {basis}
    </Badge>
  )
}
