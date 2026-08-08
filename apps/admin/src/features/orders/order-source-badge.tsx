import { resolveOrderSource } from './order-source'

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