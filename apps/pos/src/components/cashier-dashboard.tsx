import { useEffect, useState, useCallback } from 'react'
import { getSessionOrders } from '../api/client'
import { useSessionStore } from '../stores/session-store'
import { X, TrendingUp, ShoppingBag, DollarSign, Clock, Package, ChevronRight, BarChart3, RefreshCw } from 'lucide-react'

interface Order {
  id: string
  totalAmount: number
  createdAt: string
  items: { id: string; quantity: number; price: number }[]
  payments: { method: string; amount: number }[]
  customer?: { firstName?: string; phoneNumber?: string } | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(amount: number) {
  return `৳${Number(amount).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`
}

function timeSince(dateStr: string) {
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export function CashierDashboard({ open, onOpenChange }: Props) {
  const { sessionId, showroomName, cashierName, openedAt } = useSessionStore()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await getSessionOrders(sessionId)
      setOrders(res.data || [])
      setLastFetched(new Date())
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (open) {
      fetchOrders()
    }
  }, [open, fetchOrders])

  const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0)
  const totalOrders = orders.length
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0
  const totalItems = orders.reduce((s, o) => s + o.items.reduce((si, i) => si + i.quantity, 0), 0)

  const sessionStart = openedAt ? new Date(openedAt) : null
  const sessionDuration = sessionStart
    ? Math.floor((Date.now() - sessionStart.getTime()) / 1000 / 60)
    : 0

  // Payment method breakdown
  const methodBreakdown: Record<string, number> = {}
  orders.forEach((o) => {
    o.payments?.forEach((p) => {
      methodBreakdown[p.method] = (methodBreakdown[p.method] || 0) + Number(p.amount)
    })
  })

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={() => onOpenChange(false)}
      />

      {/* Slide-in Panel */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right duration-300">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
              <BarChart3 size={18} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 leading-tight">Session Dashboard</p>
              <p className="text-[11px] text-slate-400 font-medium">{showroomName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchOrders}
              disabled={loading}
              title="Refresh"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer disabled:opacity-40"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Cashier Info Strip */}
        <div className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-emerald-50 to-slate-50 border-b border-slate-100">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white font-black text-sm shadow-sm">
            {cashierName ? cashierName.charAt(0).toUpperCase() : '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-800 truncate">{cashierName || 'Cashier'}</p>
            <p className="text-[10px] text-slate-500 font-medium">
              {sessionStart ? `Session started ${timeSince(sessionStart.toISOString())}` : 'Active Session'}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1">
            <Clock size={10} className="text-emerald-600" />
            <span className="text-[10px] font-bold text-emerald-700">
              {sessionDuration < 60
                ? `${sessionDuration}m`
                : `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m`}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 p-4 border-b border-slate-100">
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="rounded-lg bg-blue-500/10 p-1.5">
                <ShoppingBag size={13} className="text-blue-500" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Orders</span>
            </div>
            <p className="text-2xl font-black text-slate-900">{totalOrders}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{totalItems} items sold</p>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="rounded-lg bg-emerald-500/10 p-1.5">
                <DollarSign size={13} className="text-emerald-500" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Revenue</span>
            </div>
            <p className="text-xl font-black text-emerald-700 leading-tight">{formatCurrency(totalRevenue)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Avg: {formatCurrency(avgOrderValue)}</p>
          </div>
        </div>

        {/* Payment Method Breakdown */}
        {Object.keys(methodBreakdown).length > 0 && (
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2.5">Payment Methods</p>
            <div className="space-y-2">
              {Object.entries(methodBreakdown).map(([method, amount]) => {
                const pct = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0
                return (
                  <div key={method} className="flex items-center gap-2">
                    <span className="w-16 text-[11px] font-bold text-slate-600 capitalize">{method}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-slate-700 w-20 text-right">{formatCurrency(amount)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent Orders */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Recent Orders</p>
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <TrendingUp size={10} />
                <span>{totalOrders} total</span>
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse rounded-xl bg-slate-100 h-14" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="text-sm font-semibold">No orders yet</p>
                <p className="text-xs text-slate-400 mt-1">Your completed orders will appear here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.slice(0, 20).map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3 hover:bg-slate-100/60 transition"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                      <ShoppingBag size={14} className="text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800">
                        {order.customer?.firstName || order.customer?.phoneNumber || 'Walk-in'}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {order.items.length} items · {formatTime(order.createdAt)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-slate-900">{formatCurrency(order.totalAmount)}</p>
                      <p className="text-[10px] text-slate-400 capitalize">{order.payments?.[0]?.method || 'cash'}</p>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Last Updated Footer */}
        {lastFetched && (
          <div className="border-t border-slate-100 px-5 py-2.5 text-center">
            <p className="text-[10px] text-slate-400">Updated {timeSince(lastFetched.toISOString())}</p>
          </div>
        )}
      </aside>
    </>
  )
}
