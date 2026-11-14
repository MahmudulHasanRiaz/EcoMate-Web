import { Badge } from '@/components/ui/badge'
import { Info } from 'lucide-react'

/**
 * P6 ingest-flag badges (§8.5.1, BR-15).
 *
 * Informational ONLY: a flag records that a storefront-ordering block or a
 * stock shortfall was observed at ingest time. It NEVER implies the order
 * was at risk of rejection — external orders are always ingested (BR-13)
 * and flags never block any later transition. Copy is deliberately neutral.
 */
export const FLAG_COPY: Record<string, { label: string; hint: string }> = {
  BLOCKED_PHONE: {
    label: 'Blocked phone (info)',
    hint: 'Phone is blocked for storefront ordering. Recorded for visibility — this order was ingested normally.',
  },
  BLOCKED_IP: {
    label: 'Blocked IP (info)',
    hint: 'IP is blocked for storefront ordering. Recorded for visibility — this order was ingested normally.',
  },
  SUSPENDED_CUSTOMER: {
    label: 'Suspended account (info)',
    hint: 'Customer account is suspended. Recorded for visibility — this order was ingested normally.',
  },
  STOCK_SHORTFALL: {
    label: 'Stock shortfall (review)',
    hint: 'Local stock could not cover this order at ingest. The order was kept; review fulfillment.',
  },
  UNMATCHED_SKU: {
    label: 'Unmatched SKU (review)',
    hint: 'An external line could not be matched to a local product. Map the SKU from Sync Center.',
  },
}

export function IngestFlagBadges({ flags, className }: { flags?: string[] | null; className?: string }) {
  if (!flags || flags.length === 0) return null
  return (
    <span className={className}>
      {flags.map((f) => {
        const copy = FLAG_COPY[f] ?? { label: `${f} (info)`, hint: 'Recorded at ingest for operational visibility.' }
        return (
          <Badge key={f} variant='outline' className='ml-1 align-middle text-xs' title={copy.hint}>
            <Info className='h-3 w-3 mr-1 inline' />{copy.label}
          </Badge>
        )
      })}
    </span>
  )
}
