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
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Package className="h-12 w-12" />
        <p className="text-lg font-medium">No orders to pack</p>
        <p className="text-sm">All Confirmed orders are packed. Good job!</p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-6">
      <p className="text-sm text-muted-foreground">{items.length} order{items.length !== 1 ? 's' : ''} waiting</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
