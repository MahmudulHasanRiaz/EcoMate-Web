import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Store, Warehouse, MapPin, Trash2, AlertTriangle, Check } from 'lucide-react'
import { cn } from '../lib/utils'
import { getProductAvailability } from '../api/client'

export interface OOSItem {
  index: number
  productId?: string
  variantId?: string
  name: string
  requestedQty: number
}

interface WarehouseStock {
  warehouseId: string
  warehouseName: string
  warehouseType: string
  stock: number
  available: number
}

interface ItemAvailability {
  itemIndex: number
  alternatives: WarehouseStock[]
  loaded: boolean
}

interface AlternativeSourcesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: OOSItem[]
  showroomId: string
  showroomName: string
  onRemoveItem: (index: number) => void
  onContinue: () => void
}

const typeIcon = (type: string) => {
  switch (type) {
    case 'showroom': return <Store size={14} className="shrink-0 text-blue-500" />
    case 'main': return <Warehouse size={14} className="shrink-0 text-purple-500" />
    default: return <MapPin size={14} className="shrink-0 text-slate-400" />
  }
}

export function AlternativeSourcesModal({
  open,
  onOpenChange,
  items,
  showroomId,
  showroomName,
  onRemoveItem,
  onContinue,
}: AlternativeSourcesModalProps) {
  const [availability, setAvailability] = useState<ItemAvailability[]>([])
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!open || items.length === 0) return

    setLoading(true)
    setAvailability([])

    const results = await Promise.allSettled(
      items.map(async (item) => {
        if (!item.productId) {
          return { itemIndex: item.index, alternatives: [], loaded: true }
        }

        try {
          const res = await getProductAvailability(item.productId, showroomId, item.variantId)
          const data = res.data as { network?: WarehouseStock[] }
          return {
            itemIndex: item.index,
            alternatives: data.network ?? [],
            loaded: true,
          }
        } catch {
          return { itemIndex: item.index, alternatives: [], loaded: true }
        }
      }),
    )

    const avail: ItemAvailability[] = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { itemIndex: -1, alternatives: [], loaded: true },
    )
    setAvailability(avail)
    setLoading(false)
  }, [open, items, showroomId])

  useEffect(() => {
    if (open) {
      fetchAll()
    } else {
      setAvailability([])
      setLoading(false)
    }
  }, [open, fetchAll])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 outline-none animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-3 mb-4 shrink-0">
            <div>
              <Dialog.Title className="text-base font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" />
                <span>Items Not Available</span>
              </Dialog.Title>
              <p className="text-[11px] text-slate-500 mt-0.5">
                in <span className="font-semibold text-slate-600">{showroomName}</span>
              </p>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition cursor-pointer">
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  <span>Checking availability...</span>
                </div>
              </div>
            )}

            {!loading && items.map((item) => {
              const itemAvail = availability.find((a) => a.itemIndex === item.index)
              const alternatives = itemAvail?.alternatives ?? []

              return (
                <div
                  key={item.index}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  {/* Item header */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-bold text-slate-800 block truncate">
                        {item.name}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Requested: <span className="font-semibold text-slate-600">{item.requestedQty} pcs</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.index)}
                      className="shrink-0 ml-2 rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Alternatives */}
                  <div className="ml-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Available at
                    </span>
                    <div className="mt-1.5 space-y-1">
                      {alternatives.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">
                          Not available in any other location
                        </p>
                      ) : (
                        alternatives.map((w) => (
                          <div
                            key={w.warehouseId}
                            className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {typeIcon(w.warehouseType)}
                              <span className="text-xs text-slate-600 truncate">
                                {w.warehouseName}
                              </span>
                            </div>
                            <span className="text-xs font-bold tabular-nums text-slate-800 ml-2 shrink-0">
                              {w.available} pcs
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="mt-5 flex gap-2 border-t border-slate-100 pt-4 shrink-0">
            <Dialog.Close className="flex-1 rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-500 hover:bg-slate-200 transition cursor-pointer">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onContinue()
                onOpenChange(false)
              }}
              className="flex-1 rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 shadow-md border border-emerald-400 transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Check size={14} />
              <span>Continue with available items</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}