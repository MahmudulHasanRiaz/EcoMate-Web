import { forwardRef } from 'react'
import { Lock, Package } from 'lucide-react'
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
  ({ item, isFocused, isSelected, currentPackerId, onSelect }, ref) => {
    const isLockedByOther = item.packingLock && item.packingLock.packerId !== currentPackerId

    // Calculate order age
    const orderDate = new Date(item.createdAt)
    const minutesAgo = Math.max(0, Math.floor((Date.now() - orderDate.getTime()) / 60000))
    const ageString = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`

    return (
      <div
        ref={ref}
        data-focused={isFocused}
        data-selected={isSelected}
        className={`group relative overflow-hidden select-none border-2 rounded-xl p-4 transition-all duration-150 cursor-pointer
          ${isSelected 
            ? 'border-blue-600 bg-blue-50/10 dark:bg-blue-950/20' 
            : isFocused 
              ? 'border-zinc-400 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50' 
              : 'border-zinc-200 bg-white hover:border-zinc-350 dark:border-zinc-800 dark:bg-zinc-900 hover:dark:border-zinc-700'}
          ${isLockedByOther ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => !isLockedByOther && onSelect()}
      >
        <div className="flex justify-between items-start mb-2.5">
          <div className="flex flex-col">
            <span className="font-mono text-base font-bold text-zinc-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {item.displayId}
            </span>
            <span className="text-[10px] font-medium text-zinc-405 dark:text-zinc-500 mt-0.5">
              {ageString}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
            <Package className="h-3.5 w-3.5 shrink-0" />
            {item.totalItems} {item.totalItems === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Small horizontal thumbnails for quick recognition */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 select-none">
          {item.items.slice(0, 4).map((p) => (
            <div key={p.id} className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
              {p.image ? (
                <img src={p.image} alt="" className="h-full w-full object-cover select-none" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-[8px] text-zinc-400 font-medium select-none">
                  No Img
                </div>
              )}
            </div>
          ))}
          {item.items.length > 4 && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 dark:bg-zinc-950 text-xs font-bold text-zinc-500 select-none">
              +{item.items.length - 4}
            </div>
          )}
        </div>

        {/* Lock warning */}
        {item.packingLock && (
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-semibold bg-amber-50/50 dark:bg-amber-950/10 p-2 rounded-lg">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Packed by {item.packingLock.packerName}</span>
          </div>
        )}
      </div>
    )
  },
)

PackingCard.displayName = 'PackingCard'
