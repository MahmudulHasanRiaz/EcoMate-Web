import { cn } from '../lib/utils'

interface StockIndicatorProps {
  stock: number
  available: number
  lowStockQty?: number
  showCount?: boolean
  className?: string
  onClick?: () => void
}

export function StockIndicator({
  stock,
  available,
  lowStockQty = 5,
  showCount = true,
  className,
  onClick,
}: StockIndicatorProps) {
  const isLowStock = available > 0 && available <= lowStockQty
  const isOutOfStock = available <= 0

  const colorClass = isOutOfStock
    ? 'bg-rose-100 text-rose-700 border-rose-200'
    : isLowStock
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200'

  const dotClass = isOutOfStock
    ? 'bg-rose-500'
    : isLowStock
    ? 'bg-amber-500'
    : 'bg-emerald-500'

  const label = isOutOfStock
    ? 'Not in stock'
    : isLowStock
    ? 'Low stock'
    : 'In stock'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold leading-none transition-colors',
        isOutOfStock && 'cursor-pointer hover:bg-rose-200',
        !isOutOfStock && 'cursor-default',
        colorClass,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      <span>{label}</span>
      {showCount && !isOutOfStock && (
        <span className="tabular-nums">{available}</span>
      )}
      {isOutOfStock && (
        <span className="underline underline-offset-2 opacity-70">See where →</span>
      )}
    </button>
  )
}