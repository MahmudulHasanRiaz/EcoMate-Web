import { Badge } from '@/components/ui/badge'

const BASIS_VARIANT = {
  direct: 'success',
  allocated: 'info',
  attributed: 'violet',
} as const

const BASIS_TITLE: Record<'direct' | 'allocated' | 'attributed', string> = {
  direct: 'Direct — the order’s own lines (combos expanded, never double-counted)',
  allocated: 'Allocated — order totals × lineNet ÷ orderNet',
  attributed: 'Attributed — ProductMarketingCost per orderItemId (analytical dimension)',
}

/** §2.6 basis label: every product P&L line states direct / allocated / attributed. */
export function BasisBadge({ basis }: { basis: 'direct' | 'allocated' | 'attributed' }) {
  return (
    <Badge variant={BASIS_VARIANT[basis]} title={BASIS_TITLE[basis]}>
      {basis}
    </Badge>
  )
}
