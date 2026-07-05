import { Loader2, Package } from 'lucide-react'
import { PackingCard } from './PackingCard'
import type { QueueItem } from './types'

interface Props {
  items: QueueItem[]
  isLoading: boolean
  selectedOrderId: string | null
  focusedIndex: number
  currentPackerId: string
  cardRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  onSelect: (item: QueueItem) => void
  onDone: (orderId: string) => void
  onHold: (orderId: string) => void
}

export function PackingQueue({
  items, isLoading, selectedOrderId, focusedIndex,
  currentPackerId, cardRefs, onSelect, onDone, onHold,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400 dark:text-zinc-600 p-6 text-center select-none">
        <Package className="h-12 w-12" />
        <p className="text-base font-bold">No orders to pack</p>
        <p className="text-xs">All Confirmed orders are packed. Good job!</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
      <div className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <PackingCard
            key={item.id}
            ref={(el) => { cardRefs.current[i] = el }}
            item={item}
            isFocused={focusedIndex === i}
            isSelected={selectedOrderId === item.id}
            currentPackerId={currentPackerId}
            onSelect={() => onSelect(item)}
            onDone={() => onDone(item.id)}
            onHold={() => onHold(item.id)}
          />
        ))}
      </div>
    </div>
  )
}
