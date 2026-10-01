import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Store, Warehouse, MapPin, AlertTriangle, Check, Loader2, RefreshCw, Send } from 'lucide-react'
import { cn } from '../lib/utils'
import { getProductAvailability, createTransferRequest } from '../api/client'
import { useSessionStore } from '../stores/session-store'
import { toast } from 'sonner'

export interface StockLookupTarget {
  productId: string
  variantId?: string
  name: string
  variantName?: string
}

interface LocationRow {
  warehouseId: string
  warehouseName: string
  warehouseType: string
  stock: number
  reserved: number
  available: number
  /**
   * Stock at this location for the EXACT variant being looked up. 0 while
   * `available` is positive means the location holds the product under a
   * sibling variant — worth telling the cashier, since a transfer is
   * variant-precise.
   */
  exactVariantAvailable?: number
  exactVariantStock?: number
}

interface AvailabilityResponse {
  productId: string
  variantId: string | null
  currentShowroom: {
    warehouseId: string
    stock: number
    reserved: number
    available: number
  }
  network: LocationRow[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: StockLookupTarget | null
}

const typeIcon = (type: string) => {
  switch (type) {
    case 'showroom': return <Store size={14} className="shrink-0 text-blue-500" />
    case 'main': return <Warehouse size={14} className="shrink-0 text-purple-500" />
    default: return <MapPin size={14} className="shrink-0 text-slate-400" />
  }
}

const errorMessage = (err: any): string => {
  const raw = err?.response?.data?.message ?? err?.message
  if (Array.isArray(raw)) return raw.join('\n')
  return raw || 'Request failed'
}

export function StockLocationsModal({ open, onOpenChange, target }: Props) {
  const { showroomId, showroomName } = useSessionStore()
  const [data, setData] = useState<AvailabilityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [requested, setRequested] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)

  const fetchAvailability = useCallback(async () => {
    if (!open || !target || !showroomId) return
    setLoading(true)
    setError(null)
    setData(null)
    setQtys({})
    setRequested({})
    try {
      const res = await getProductAvailability(
        target.productId,
        showroomId,
        target.variantId,
      )
      const body = res.data as AvailabilityResponse
      setData(body)
      const initial: Record<string, number> = {}
      for (const row of body.network ?? []) initial[row.warehouseId] = row.available
      setQtys(initial)
    } catch (err: any) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [open, target, showroomId])

  useEffect(() => {
    if (open) fetchAvailability()
  }, [open, fetchAvailability])

  const requestFrom = async (row: LocationRow) => {
    if (!target || !showroomId) return
    const qty = qtys[row.warehouseId] ?? 0
    if (!Number.isFinite(qty) || qty < 1 || qty > row.available) {
      toast.error(`Quantity must be between 1 and ${row.available}`)
      return
    }
    setSubmitting(row.warehouseId)
    try {
      await createTransferRequest({
        items: [
          {
            productId: target.productId,
            variantId: target.variantId,
            sourceWarehouseId: row.warehouseId,
            quantity: qty,
          },
        ],
        notes: `POS stock request — ${target.name}${target.variantName ? ` (${target.variantName})` : ''}`,
      })
      setRequested((prev) => ({ ...prev, [row.warehouseId]: qty }))
      toast.success(`Transfer requested: ${qty} × from ${row.warehouseName}`)
    } catch (err: any) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(null)
    }
  }

  const network = data?.network ?? []
  const current = data?.currentShowroom

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 outline-none animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-3 mb-4 shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle size={18} className="text-rose-500" />
                <span>Where is it available?</span>
              </Dialog.Title>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                {target?.name}
                {target?.variantName ? ` · ${target.variantName}` : ''}
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
                  <Loader2 size={16} className="animate-spin" />
                  <span>Checking availability...</span>
                </div>
              </div>
            )}

            {!loading && error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-xs font-semibold text-rose-700">{error}</p>
                <button
                  type="button"
                  onClick={fetchAvailability}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white border border-rose-200 px-3 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                >
                  <RefreshCw size={12} />
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && data && (
              <>
                {/* Current showroom */}
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                        Current location
                      </span>
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {showroomName || 'Current showroom'}
                      </p>
                    </div>
                    <span className="text-xs font-black text-rose-600 ml-2 shrink-0">
                      {Math.max(current?.available ?? 0, 0)} available
                    </span>
                  </div>
                </div>

                {/* Other locations */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Available at
                  </span>
                  <div className="mt-1.5 space-y-2">
                    {network.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">
                        Not available in any other location
                      </p>
                    ) : (
                      network.map((row) => {
                        const qty = qtys[row.warehouseId] ?? row.available
                        const alreadyRequested = row.warehouseId in requested
                        const valid = qty >= 1 && qty <= row.available
                        const isSubmitting = submitting === row.warehouseId
                        // The location may hold this product under a DIFFERENT
                        // variant, so say so: a transfer is variant-precise and
                        // the cashier should not promise a specific one.
                        const otherVariantOnly =
                          target?.variantId != null &&
                          (row.exactVariantAvailable ?? 0) === 0
                        return (
                          <div
                            key={row.warehouseId}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {typeIcon(row.warehouseType)}
                                <span className="text-xs font-semibold text-slate-700 truncate">
                                  {row.warehouseName}
                                </span>
                              </div>
                              <span className="text-xs font-bold tabular-nums text-slate-800 shrink-0">
                                {row.available} available
                              </span>
                            </div>

                            {otherVariantOnly && (
                              <p className="mt-1.5 text-[10px] leading-snug text-amber-600">
                                This location has the product under a different variant.
                                Request it, then confirm the variant before transferring.
                              </p>
                            )}

                            <div className="mt-2 flex items-center gap-2">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Qty
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={row.available}
                                value={qty}
                                disabled={alreadyRequested}
                                onChange={(e) => {
                                  const next = Number(e.target.value)
                                  setQtys((prev) => ({ ...prev, [row.warehouseId]: next }))
                                }}
                                className="h-7 w-16 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold tabular-nums text-slate-800 outline-none focus:border-emerald-500 disabled:opacity-50"
                              />
                              <button
                                type="button"
                                onClick={() => requestFrom(row)}
                                disabled={alreadyRequested || !valid || isSubmitting}
                                className={cn(
                                  'ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-[11px] font-extrabold transition cursor-pointer active:scale-95 disabled:cursor-not-allowed disabled:opacity-60',
                                  alreadyRequested
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-emerald-500 text-slate-950 border border-emerald-400 hover:bg-emerald-400',
                                )}
                              >
                                {isSubmitting ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : alreadyRequested ? (
                                  <Check size={12} />
                                ) : (
                                  <Send size={12} />
                                )}
                                <span>
                                  {alreadyRequested
                                    ? `Requested ${requested[row.warehouseId]}`
                                    : 'Request transfer'}
                                </span>
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                <p className="text-[10px] leading-relaxed text-slate-400">
                  A transfer request does not move stock. It is queued for
                  approval in <span className="font-semibold text-slate-500">Inventory → Transfers</span>,
                  where an admin approves it and the stock moves.
                </p>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="mt-5 border-t border-slate-100 pt-4 shrink-0">
            <Dialog.Close className="w-full rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-500 hover:bg-slate-200 transition cursor-pointer">
              Close
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
