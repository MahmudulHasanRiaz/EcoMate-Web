import { resolveOrderSource, resolveOrderAttribution, type OrderAttribution } from './order-source'

/**
 * Renders the order source badge from the authoritative `Order.salesChannel`
 * value. Single shared component used by both the order list and order detail
 * so both surfaces always show the same source.
 */
export function OrderSourceBadge({ salesChannel, className }: { salesChannel?: string | null; className?: string }) {
  const source = resolveOrderSource(salesChannel)
  if (!source) return null
  const Icon = source.Icon
  return (
    <span
      title={source.label}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-px ${source.tone} ${className || ''}`}
    >
      <Icon className='h-2.5 w-2.5' />
      {source.label}
    </span>
  )
}

/**
 * Lightweight attribution badge group for an order (spec §12). Renders up to
 * two compact badges: the sales channel ("Website" / "POS" / "Offline") plus,
 * when present, the source entity ("EcoMate Store", "Dhanmondi Showroom") or
 * the `Platform · Type` pair ("Facebook · Ad", "WhatsApp · Chat").
 *
 * Designed for high information density (Shopify-style): tiny uppercase
 * labels, no borders, minimal footprint. Renders nothing when no attribution
 * exists so the order row stays uncluttered.
 */
export function OrderSourceBadges({ attribution, className }: { attribution: OrderAttribution; className?: string }) {
  const badges = resolveOrderAttribution(attribution)
  if (badges.length === 0) return null
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className || ''}`}>
      {badges.map((badge) => {
        const Icon = badge.Icon
        return (
          <span
            key={`${badge.kind}-${badge.label}`}
            title={badge.label}
            className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-px ${badge.tone}`}
          >
            <Icon className='h-2.5 w-2.5' />
            {badge.label}
          </span>
        )
      })}
    </span>
  )
}