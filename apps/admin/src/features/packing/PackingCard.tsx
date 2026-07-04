import { forwardRef } from 'react'
import type { QueueItem } from './types'

interface Props {
  item: QueueItem
  isFocused: boolean
  isSelected: boolean
  currentPackerId: string
  onSelect: () => void
  onDone: () => void
  onHold: () => void
}

export const PackingCard = forwardRef<HTMLDivElement, Props>(
  ({ item, isFocused, isSelected, currentPackerId, onSelect, onDone, onHold }, ref) => {
    const isLockedByOther = item.packingLock && item.packingLock.packerId !== currentPackerId

    return (
      <div
        ref={ref}
        data-focused={isFocused}
        data-selected={isSelected}
        className={`cursor-pointer rounded-xl border-2 p-4 transition-all
          ${isSelected ? 'border-primary bg-primary/5 shadow-md' : isFocused ? 'border-blue-400 bg-white shadow-sm' : 'border-transparent bg-white hover:border-gray-200'}
          ${isLockedByOther ? 'cursor-not-allowed opacity-60' : ''}`}
        onClick={() => !isLockedByOther && onSelect()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-sm font-bold">{item.displayId}</span>
          <span className="text-xs text-muted-foreground">{item.totalItems} items</span>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {item.items.slice(0, 5).map((p) => (
            <div key={p.id} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border">
              {p.image ? (
                <img src={p.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                  No img
                </div>
              )}
            </div>
          ))}
          {item.items.length > 5 && (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
              +{item.items.length - 5}
            </div>
          )}
        </div>

        <p className="mb-1 truncate text-sm font-medium">
          {item.items[0]?.productName}
          {item.items.length > 1 && ` +${item.items.length - 1} more`}
        </p>

        {item.packingLock && (
          <p className="mb-2 text-xs text-amber-600">
            Being packed by {item.packingLock.packerName}
          </p>
        )}

        {isSelected && !isLockedByOther && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onDone() }}
              className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Done (Space)
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onHold() }}
              className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Hold (H)
            </button>
          </div>
        )}
      </div>
    )
  },
)

PackingCard.displayName = 'PackingCard'
