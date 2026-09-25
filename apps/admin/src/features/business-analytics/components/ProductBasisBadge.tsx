import { Badge } from '@/components/ui/badge'

const BASIS_VARIANT = {
  direct: 'success',
  allocated: 'info',
  attributed: 'violet',
} as const

const BASIS_TITLE: Record<'direct' | 'allocated' | 'attributed', string> = {
  direct: 'From the order itself. Combo packs are split, counted once.',
  allocated: 'Split from the order total by each line share.',
  attributed: 'Ad cost linked to this product. For insight only.',
}

/** §2.6 basis label: every product P&L line states direct / allocated / attributed. */
export function BasisBadge({ basis }: { basis: 'direct' | 'allocated' | 'attributed' }) {
  return (
    <Badge variant={BASIS_VARIANT[basis]} title={BASIS_TITLE[basis]}>
      {basis}
    </Badge>
  )
}
