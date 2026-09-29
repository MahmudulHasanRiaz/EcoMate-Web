import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Store, Warehouse, MapPin, Trash2, AlertTriangle, Check, Send, CreditCard, Clock, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { getProductAvailability, createTransferRequest } from '../api/client'
import { toast } from 'sonner'

export interface OOSItem {
  index: number
  productId?: string
  variantId?: string
  name: string
  requestedQty: number
  currentAvailable: number
}

interface WarehouseStock {
  warehouseId: string
  warehouseName: string
  warehouseType: string
  stock: number
  available: number
}

interface ItemAvailability {
  key: string
  showroomAvailable: number
  alternatives: WarehouseStock[]
  loaded: boolean
}

export type RequestState = 'sending' | 'sent' | 'failed'

interface AlternativeSourcesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: OOSItem[]
  showroomId: string
  showroomName: string
  onRemoveItem: (index: number) => void
  onResolveAvailable: (resolutions: { index: number; keepQty: number }[]) => void
  onCompleteCheckout: () => void
  busy?: boolean
}

const typeIcon = (type: string) => {
  switch (type) {
    case 'showroom': return <Store size={14} className="shrink-0 text-blue-500" />
    case 'main': return <Warehouse size={14} className="shrink-0 text-purple-500" />
    default: return <MapPin size={14} className="shrink-0 text-slate-400" />
  }
}

// Cart identity: a product+variant pair is unique inside one cart, so state
// keyed by it survives index shifts when items are removed.
const keyOf = (item: OOSItem) => `${item.productId ?? item.index}::${item.variantId ?? ''}`

export function AlternativeSourcesModal({
  open,
  onOpenChange,
  items,
  showroomId,
  showroomName,
  onRemoveItem,
  onResolveAvailable,
  onCompleteCheckout,
  busy = false,
}: AlternativeSourcesModalProps) {
  const [availability, setAvailability] = useState<ItemAvailability[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [reqState, setReqState] = useState<Record<string, RequestState>>({})
  const [sending, setSending] = useState(false)

  const fetchAll = useCallback(async (silent = false) => {
    if (!open || items.length === 0) return
    if (!silent) setLoading(true)

    const results = await Promise.allSettled(
      items.map(async (item) => {
        const key = keyOf(item)
        if (!item.productId) {
          return { key, showroomAvailable: 0, alternatives: [], loaded: true }
        }
        try {
          const res = await getProductAvailability(item.productId, showroomId, item.variantId)
          const data = res.data as {
            currentShowroom?: { available?: number }
            network?: WarehouseStock[]
          }
          return {
            key,
            showroomAvailable: data.currentShowroom?.available ?? 0,
            alternatives: data.network ?? [],
            loaded: true,
          }
        } catch {
          return { key, showroomAvailable: 0, alternatives: [], loaded: true }
        }
      }),
    )

    const next: ItemAvailability[] = results.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { key: '', showroomAvailable: 0, alternatives: [], loaded: true },
    )
    setAvailability(next)

    // Default the source to the location holding the most stock; the cashier
    // can still tap any other location before sending the request.
    setSelected((prev) => {
      const out = { ...prev }
      for (const a of next) {
        if (a.key && !out[a.key] && a.alternatives.length > 0) {
          out[a.key] = a.alternatives[0].warehouseId
        }
      }
      return out
    })
    if (!silent) setLoading(false)
  }, [open, items, showroomId])

  useEffect(() => {
    if (open) {
      fetchAll()
    } else {
      setAvailability([])
      setLoading(false)
    }
  }, [open, fetchAll])

  // While requests are pending, keep re-checking so "Arrived" shows up and
  // Complete Checkout starts working the moment the approver moves the stock.
  const hasSent = items.some((i) => reqState[keyOf(i)] === 'sent')
  useEffect(() => {
    if (!open || !hasSent) return
    const t = setInterval(() => { void fetchAll(true) }, 8000)
    return () => clearInterval(t)
  }, [open, hasSent, fetchAll])

  const availOf = (item: OOSItem) => availability.find((a) => a.key === keyOf(item))
  const atShowroomOf = (item: OOSItem) =>
    availOf(item)?.showroomAvailable ?? item.currentAvailable
  const missingOf = (item: OOSItem) =>
    Math.max(item.requestedQty - atShowroomOf(item), 0)
  const arrivedOf = (item: OOSItem) => missingOf(item) === 0 && (availOf(item)?.loaded ?? false)

  // 'failed' counts as unsent so the cashier can retry — otherwise the popup
  // would dead-end with every button disabled.
  const unsentItems = items.filter((i) => {
    const st = reqState[keyOf(i)]
    return !st || st === 'failed'
  })
  const sentCount = items.filter((i) => reqState[keyOf(i)] === 'sent').length
  // Only items that still miss stock AND have a chosen source can be requested.
  const requestable = unsentItems.filter(
    (i) => selected[keyOf(i)] && missingOf(i) > 0,
  )
  const allSent = sentCount > 0 && requestable.length === 0

  const handleSend = async () => {
    if (requestable.length === 0 || sending) return
    setSending(true)
    const keys = requestable.map(keyOf)
    setReqState((prev) => {
      const out = { ...prev }
      for (const k of keys) out[k] = 'sending'
      return out
    })
    try {
      await createTransferRequest({
        items: requestable.map((item) => ({
          productId: item.productId!,
          variantId: item.variantId,
          sourceWarehouseId: selected[keyOf(item)]!,
          quantity: missingOf(item),
        })),
        notes: `POS checkout request from ${showroomName}`,
      })
      setReqState((prev) => {
        const out = { ...prev }
        for (const k of keys) out[k] = 'sent'
        return out
      })
      toast.success(`Transfer requested for ${requestable.length} item(s)`)
      void fetchAll(true)
    } catch (err: any) {
      setReqState((prev) => {
        const out = { ...prev }
        for (const k of keys) out[k] = 'failed'
        return out
      })
      toast.error(err?.response?.data?.message || 'Could not send transfer request')
    } finally {
      setSending(false)
    }
  }

  const handleResolveAvailable = () => {
    // Requested items stay in the cart awaiting stock; the rest are trimmed to
    // what the showroom actually has (or dropped when it has nothing).
    const resolutions = unsentItems.map((item) => ({
      index: item.index,
      keepQty: Math.min(atShowroomOf(item), item.requestedQty),
    }))
    onResolveAvailable(resolutions)
  }

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
              {sentCount > 0 && (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  <Clock size={11} /> {sentCount} request(s) awaiting approval
                </p>
              )}
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
              const key = keyOf(item)
              const itemAvail = availOf(item)
              const alternatives = itemAvail?.alternatives ?? []
              const state = reqState[key]
              const missing = missingOf(item)
              const arrived = arrivedOf(item)
              const chosen = selected[key]

              return (
                <div key={key} className="rounded-xl border border-slate-200 bg-white p-3">
                  {/* Item header */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-bold text-slate-800 block truncate">
                        {item.name}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Requested:{' '}
                        <span className="font-semibold text-slate-600">{item.requestedQty} pcs</span>
                        {item.currentAvailable > 0 && (
                          <span className="text-slate-400">
                            {' '}&middot; {item.currentAvailable} at {showroomName} &rarr; need{' '}
                            <span className="font-semibold text-slate-600">{missing} pcs</span>
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {arrived && state === 'sent' && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          <Check size={11} /> Arrived
                        </span>
                      )}
                      {state === 'sent' && !arrived && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          <Send size={11} /> Requested
                        </span>
                      )}
                      {state === 'sending' && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                          <Clock size={11} /> Sending…
                        </span>
                      )}
                      {state === 'failed' && (
                        <span className="inline-flex items-center rounded-md bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                          Failed
                        </span>
                      )}
                      {!state && (
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.index)}
                          className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                          title="Remove from cart"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Alternatives as selectable sources */}
                  {!state && (
                    <div className="ml-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Request from
                      </span>
                      <div className="mt-1.5 space-y-1">
                        {alternatives.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic">
                            Not available in any other location — remove this item
                          </p>
                        ) : (
                          alternatives.map((w) => {
                            const isChosen = chosen === w.warehouseId
                            return (
                              <button
                                key={w.warehouseId}
                                type="button"
                                onClick={() =>
                                  setSelected((prev) => ({ ...prev, [key]: w.warehouseId }))
                                }
                                className={cn(
                                  'w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 border transition cursor-pointer text-left',
                                  isChosen
                                    ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-300'
                                    : 'bg-slate-50 border-transparent hover:bg-slate-100',
                                )}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  {typeIcon(w.warehouseType)}
                                  <span className="text-xs font-semibold text-slate-700 truncate">
                                    {w.warehouseName}
                                  </span>
                                </span>
                                <span className="flex items-center gap-2 ml-2 shrink-0">
                                  <span className="text-xs font-bold tabular-nums text-slate-800">
                                    {w.available} pcs
                                  </span>
                                  {isChosen && (
                                    <Check size={13} className="text-emerald-600" />
                                  )}
                                </span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 shrink-0">
            <button
              type="button"
              onClick={handleResolveAvailable}
              disabled={busy || unsentItems.length === 0}
              className="w-full rounded-xl border border-slate-200 bg-white py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Check size={14} />
              <span>Continue with available items</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleSend}
                disabled={busy || sending || requestable.length === 0}
                className="rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 shadow-md border border-emerald-400 transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                <span>Continue with request{requestable.length > 0 ? ` (${requestable.length})` : ''}</span>
              </button>
              <button
                type="button"
                onClick={onCompleteCheckout}
                disabled={busy || sentCount === 0}
                className="rounded-xl bg-slate-900 py-3 text-xs font-bold text-white hover:bg-slate-800 shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                <span>{busy ? 'Checking stock…' : 'Complete Checkout'}</span>
              </button>
            </div>
            {!allSent && items.some((i) => !reqState[keyOf(i)] && !(availOf(i)?.alternatives.length)) && (
              <p className="text-[10px] text-slate-400 text-center">
                Items without another location must be removed to continue.
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
