import { useEffect, useCallback, useState, useRef } from 'react'
import { useSidebar } from '@/components/ui/sidebar'
import { useAuthStore } from '@/stores/auth-store'
import { usePackingQueue, usePackingStats, useOpenOrder, useMarkDone, useMarkHold } from './hooks'
import { PackingQueue } from './PackingQueue'
import { HoldModal } from './HoldModal'
import { StatsBar } from './StatsBar'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { QueueItem, HoldFormData } from './types'

export function PackingWorkspace() {
  const { setOpen } = useSidebar()
  const currentUser = useAuthStore((s) => s.auth.user)
  const currentPackerId = currentUser?.id ?? ''
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [holdOrderId, setHoldOrderId] = useState<string | null>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const { data: queue = [], isLoading } = usePackingQueue(search)
  const { data: stats } = usePackingStats()
  const openOrder = useOpenOrder()
  const markDone = useMarkDone()
  const markHold = useMarkHold()

  useEffect(() => {
    setOpen(false)
    return () => setOpen(true)
  }, [setOpen])

  useEffect(() => {
    setFocusedIndex(0)
  }, [queue.length])

  const openAndSelect = useCallback(async (order: QueueItem) => {
    if (order.packingLock && order.packingLock.packerId !== currentPackerId) return
    try {
      await openOrder.mutateAsync(order.id)
      setSelectedOrderId(order.id)
    } catch {
      // lock conflict handled by UI feedback
    }
  }, [openOrder, currentPackerId])

  const handleDone = useCallback(async (orderId: string) => {
    await markDone.mutateAsync(orderId)
    setSelectedOrderId(null)
  }, [markDone])

  const handleHold = useCallback((orderId: string) => {
    setHoldOrderId(orderId)
  }, [])

  const handleHoldSubmit = useCallback(async (data: HoldFormData) => {
    if (!holdOrderId) return
    await markHold.mutateAsync({ orderId: holdOrderId, data })
    setHoldOrderId(null)
    setSelectedOrderId(null)
  }, [holdOrderId, markHold])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (holdOrderId) return

      const order = queue[focusedIndex]
      if (!order) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, queue.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          openAndSelect(order)
          break
        case ' ':
          e.preventDefault()
          if (selectedOrderId === order.id) handleDone(order.id)
          break
        case 'h':
        case 'H':
          if (selectedOrderId === order.id) handleHold(order.id)
          break
        case 'Escape':
          setSelectedOrderId(null)
          break
        case 'p':
        case 'P':
          window.open(`/op/print/sticker/${order.id}`, '_blank')
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queue, focusedIndex, selectedOrderId, holdOrderId, openAndSelect, handleDone, handleHold])

  useEffect(() => {
    cardRefs.current[focusedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedIndex])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-white px-6 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">Packing Workspace</h1>
        <div className="relative ml-auto max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order ID, customer, phone..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <StatsBar stats={stats} />
      </header>

      <div className="flex flex-1 gap-0 overflow-hidden">
        <PackingQueue
          items={queue}
          isLoading={isLoading}
          selectedOrderId={selectedOrderId}
          focusedIndex={focusedIndex}
          currentPackerId={currentPackerId}
          cardRefs={cardRefs}
          onSelect={openAndSelect}
          onDone={handleDone}
          onHold={handleHold}
        />

        {selectedOrderId && (
          <div className="w-96 shrink-0 border-l bg-white p-6 dark:bg-zinc-900">
            <DetailsPanel orderId={selectedOrderId} queue={queue} />
          </div>
        )}
      </div>

      {holdOrderId && (
        <HoldModal
          orderId={holdOrderId}
          onClose={() => setHoldOrderId(null)}
          onSubmit={handleHoldSubmit}
          isSubmitting={markHold.isPending}
        />
      )}
    </div>
  )
}

function DetailsPanel({ orderId, queue }: { orderId: string; queue: QueueItem[] }) {
  const order = queue.find((o) => o.id === orderId)
  if (!order) return null

  const c = order.customer
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Order {order.displayId}</h2>
      <div className="space-y-2 text-sm">
        <p><span className="text-muted-foreground">Customer:</span> {c?.name ?? 'N/A'}</p>
        <p><span className="text-muted-foreground">Phone:</span> {c?.phone ?? 'N/A'}</p>
        <p><span className="text-muted-foreground">Items:</span> {order.totalItems}</p>
        <p><span className="text-muted-foreground">Created:</span> {new Date(order.createdAt).toLocaleString()}</p>
      </div>
      <div className="space-y-2">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg border p-2">
            {item.image && (
              <img src={item.image} alt="" className="h-12 w-12 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.productName}</p>
              <p className="text-xs text-muted-foreground">{item.variantName} x{item.quantity}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
