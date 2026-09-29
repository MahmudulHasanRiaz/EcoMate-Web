import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X, Download, ChevronLeft, ChevronRight, BarChart3, ShoppingBag,
  DollarSign, Package, Receipt, Banknote, BadgePercent, RotateCcw,
} from 'lucide-react'
import { useSessionStore } from '../stores/session-store'
import {
  getPosAnalyticsOverview, getPosAnalyticsTransactions, exportPosAnalyticsExcel,
  type PosAnalyticsScope, type PosAnalyticsPreset, type PosAnalyticsKpis,
  type PosAnalyticsTransaction, type PosAnalyticsSort, type SortOrder,
} from '../api/client'
import {
  ANALYTICS_PRESETS, defaultCustomRange, validateCustomRange, rangeLabel,
  formatBDT, formatReportDateTime, resolveExportFilename, parseTransactionsMeta,
} from '../lib/analytics-range'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ScopeTab = PosAnalyticsScope

const SORT_OPTIONS: { value: string; label: string; sort: PosAnalyticsSort; order: SortOrder }[] = [
  { value: 'newest', label: 'Newest first', sort: 'reportingAt', order: 'desc' },
  { value: 'oldest', label: 'Oldest first', sort: 'reportingAt', order: 'asc' },
  { value: 'highest', label: 'Highest total', sort: 'total', order: 'desc' },
  { value: 'lowest', label: 'Lowest total', sort: 'total', order: 'asc' },
]

const PAGE_SIZE = 20

function errStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

function KpiCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-3.5 ${accent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-slate-50'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <p className={`text-xl font-black leading-tight ${accent ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-slate-100 h-12" />
      ))}
    </div>
  )
}

export function SalesAnalytics({ open, onOpenChange }: Props) {
  const { showroomName, cashierName } = useSessionStore()

  const [scope, setScope] = useState<ScopeTab>('showroom')
  const [preset, setPreset] = useState<PosAnalyticsPreset>('today')
  const [customFrom, setCustomFrom] = useState(() => defaultCustomRange().from)
  const [customTo, setCustomTo] = useState(() => defaultCustomRange().to)
  const [rangeError, setRangeError] = useState<string | null>(null)

  const [kpis, setKpis] = useState<PosAnalyticsKpis | null>(null)
  const [kpiLoading, setKpiLoading] = useState(false)
  const [kpiError, setKpiError] = useState<string | null>(null)

  const [rows, setRows] = useState<PosAnalyticsTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txError, setTxError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [sortKey, setSortKey] = useState('newest')

  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)

  // Guards out-of-order responses when scope/range flips quickly.
  const reqSeq = useRef(0)

  // ESC closes (full-screen overlay, no router).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const customActive = preset === 'custom'
  const invalidCustom = customActive ? validateCustomRange(customFrom, customTo) : null
  const label = rangeLabel(preset, customFrom, customTo)

  const fetchOverview = useCallback(async () => {
    if (invalidCustom) return
    const seq = ++reqSeq.current
    setKpiLoading(true)
    setKpiError(null)
    try {
      const params = customActive
        ? { scope, preset, from: customFrom, to: customTo }
        : { scope, preset }
      const res = await getPosAnalyticsOverview(params)
      if (seq !== reqSeq.current) return
      setKpis(res.data?.data ?? null)
    } catch (err) {
      if (seq !== reqSeq.current) return
      const status = errStatus(err)
      if (status === 401 || status === 403) {
        toast.error('Session expired — please log in again.')
        setKpiError('Session expired — please log in again.')
      } else {
        toast.error('Failed to load sales overview.')
        setKpiError('Could not load sales overview. Check your connection and retry.')
      }
    } finally {
      if (seq === reqSeq.current) setKpiLoading(false)
    }
  }, [scope, preset, customActive, customFrom, customTo, invalidCustom])

  const fetchTransactions = useCallback(async (targetPage: number, targetSortKey: string) => {
    if (invalidCustom) return
    const seq = ++reqSeq.current
    setTxLoading(true)
    setTxError(null)
    try {
      const opt = SORT_OPTIONS.find((o) => o.value === targetSortKey) ?? SORT_OPTIONS[0]
      const params = {
        ...(customActive
          ? { scope, preset, from: customFrom, to: customTo }
          : { scope, preset }),
        page: targetPage,
        pageSize: PAGE_SIZE,
        sort: opt.sort,
        order: opt.order,
      }
      const res = await getPosAnalyticsTransactions(params)
      if (seq !== reqSeq.current) return
      setRows(Array.isArray(res.data?.data) ? res.data.data : [])
      const meta = parseTransactionsMeta(res.data?.meta)
      setPage(meta.page)
      setTotal(meta.total)
      setTotalPages(meta.totalPages)
    } catch (err) {
      if (seq !== reqSeq.current) return
      const status = errStatus(err)
      if (status === 401 || status === 403) {
        toast.error('Session expired — please log in again.')
        setTxError('Session expired — please log in again.')
      } else {
        toast.error('Failed to load transactions.')
        setTxError('Could not load transactions. Check your connection and retry.')
      }
    } finally {
      if (seq === reqSeq.current) setTxLoading(false)
    }
  }, [scope, preset, customActive, customFrom, customTo, invalidCustom])

  // Shared range state: KPIs + table + export all follow scope/preset/custom.
  useEffect(() => {
    if (!open) return
    if (invalidCustom) {
      setRangeError(invalidCustom)
      return
    }
    setRangeError(null)
    setPage(1)
    fetchOverview()
    fetchTransactions(1, sortKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, preset, customFrom, customTo])

  const changeSort = (key: string) => {
    setSortKey(key)
    setPage(1)
    fetchTransactions(1, key)
  }

  const changePage = (next: number) => {
    if (next < 1 || (totalPages > 0 && next > totalPages) || txLoading) return
    setPage(next)
    fetchTransactions(next, sortKey)
  }

  const retry = () => {
    fetchOverview()
    fetchTransactions(page, sortKey)
  }

  const handleExport = async () => {
    if (exporting) return // duplicate-click guard
    if (invalidCustom) {
      toast.error(invalidCustom)
      return
    }
    setExporting(true)
    setExportPct(null)
    try {
      const params = customActive
        ? { scope, preset, from: customFrom, to: customTo }
        : { scope, preset }
      const res = await exportPosAnalyticsExcel(params, (e) => {
        if (e.total && e.total > 0) {
          setExportPct(Math.min(99, Math.round((e.loaded / e.total) * 100)))
        }
      })
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const filename = resolveExportFilename({
        contentDisposition: res.headers?.['content-disposition'],
        showroomName,
        from: customFrom,
        to: customTo,
        preset,
      })
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast.success('Excel exported.')
    } catch (err) {
      const status = errStatus(err)
      if (status === 401 || status === 403) {
        toast.error('Session expired — please log in again.')
      } else {
        toast.error('Export failed. Try again or narrow the date range.')
      }
    } finally {
      setExporting(false)
      setExportPct(null)
    }
  }

  if (!open) return null

  const emptyMessage = scope === 'showroom'
    ? `No sales in this showroom for ${label}. Try another date range.`
    : `You have no sales in ${label}.`

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 text-slate-800 antialiased">
      {/* Header */}
      <header className="border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
              <BarChart3 size={18} className="text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 leading-tight">Sales Analytics</p>
              <p className="text-xs font-semibold text-emerald-700 truncate">Showroom: {showroomName || '—'}</p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            title="Back to terminal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scope tabs */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex rounded-xl bg-slate-100 p-1 w-full sm:w-auto">
            <button
              onClick={() => setScope('showroom')}
              className={`flex-1 sm:flex-none rounded-lg px-4 py-1.5 text-xs font-bold transition cursor-pointer ${scope === 'showroom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Overall Sales
            </button>
            <button
              onClick={() => setScope('mine')}
              className={`flex-1 sm:flex-none rounded-lg px-4 py-1.5 text-xs font-bold transition cursor-pointer ${scope === 'mine' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              My Sales
            </button>
          </div>
          <p className="text-[11px] font-semibold text-slate-500">
            Viewing: {scope === 'showroom'
              ? 'all staff in this showroom'
              : `your sales${cashierName ? ` (${cashierName})` : ''}`}
          </p>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {/* Range controls */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
          <div className="flex flex-wrap gap-2">
            {ANALYTICS_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${preset === p.value ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {customActive && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-400"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-400"
                />
              </label>
              <span className="text-[11px] font-semibold text-slate-400 pb-2">Range: {label} · max 366 days</span>
            </div>
          )}
          {rangeError && (
            <p className="mt-2 text-xs font-semibold text-rose-600">{rangeError}</p>
          )}
        </div>

        {/* KPI cards */}
        <div className="mt-4">
          {kpiLoading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl bg-slate-200/70 h-24" />
              ))}
            </div>
          ) : kpiError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
              <p className="text-xs font-semibold text-rose-700">{kpiError}</p>
              <button
                onClick={retry}
                className="mt-2 rounded-lg bg-white px-4 py-1.5 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-100 transition cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : kpis ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard
                accent
                icon={<Banknote size={13} className="text-emerald-600" />}
                label="Total Sales (net)"
                value={formatBDT(kpis.netSales)}
                sub={`${kpis.totalOrders} orders · ${label}`}
              />
              <KpiCard
                icon={<ShoppingBag size={13} className="text-blue-500" />}
                label="Orders"
                value={String(kpis.totalOrders)}
                sub={`${kpis.unitsSold} units sold`}
              />
              <KpiCard
                icon={<DollarSign size={13} className="text-violet-500" />}
                label="Avg Order Value"
                value={formatBDT(kpis.avgOrderValue)}
                sub={`Gross ${formatBDT(kpis.grossSales)}`}
              />
              <KpiCard
                icon={<Package size={13} className="text-amber-500" />}
                label="Discounts"
                value={formatBDT(kpis.discountTotal)}
                sub={`Refunds ${formatBDT(kpis.refundsTotal)}`}
              />
              <KpiCard
                icon={<Receipt size={13} className="text-slate-500" />}
                label="Gross Sales"
                value={formatBDT(kpis.grossSales)}
              />
              <KpiCard
                icon={<RotateCcw size={13} className="text-rose-500" />}
                label="Refunds"
                value={formatBDT(kpis.refundsTotal)}
              />
              <div className="col-span-2 md:col-span-2 rounded-2xl border border-slate-100 bg-slate-50 p-3.5 flex items-center gap-2">
                <BadgePercent size={13} className="text-slate-400 shrink-0" />
                <p className="text-[11px] font-semibold text-slate-500">
                  Net = gross ({formatBDT(kpis.grossSales)}) − approved refunds ({formatBDT(kpis.refundsTotal)}).
                  Fully refunded orders contribute zero.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Transactions */}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-black text-slate-800">
              Transactions <span className="font-semibold text-slate-400">· {total} · {label}</span>
            </p>
            <div className="flex items-center gap-2">
              <select
                value={sortKey}
                onChange={(e) => changeSort(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400 cursor-pointer"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={handleExport}
                disabled={exporting}
                title="Export Excel"
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-400 transition cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                <Download size={13} className={exporting ? 'animate-bounce' : ''} />
                <span>{exporting ? (exportPct !== null ? `Exporting ${exportPct}%…` : 'Exporting…') : 'Export Excel'}</span>
              </button>
            </div>
          </div>

          <div className="p-4">
            {txLoading ? (
              <SkeletonRows count={5} />
            ) : txError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center">
                <p className="text-xs font-semibold text-rose-700">{txError}</p>
                <button
                  onClick={retry}
                  className="mt-2 rounded-lg bg-white px-4 py-1.5 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-100 transition cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <Package size={40} className="mb-3 opacity-50" />
                <p className="text-sm font-semibold text-slate-500 text-center px-4">{emptyMessage}</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <th className="pb-2 pr-3">Order No</th>
                      <th className="pb-2 pr-3">Date / Time</th>
                      <th className="pb-2 pr-3">Customer</th>
                      <th className="pb-2 pr-3">Staff</th>
                      <th className="pb-2 pr-3">Items</th>
                      <th className="pb-2 pr-3 text-right">Qty</th>
                      <th className="pb-2 pr-3 text-right">Discount</th>
                      <th className="pb-2 pr-3 text-right">Total</th>
                      <th className="pb-2 pr-3">Payment</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const dt = formatReportDateTime(r.reportingAt)
                      return (
                        <tr key={r.orderId} className="hover:bg-slate-50/70 transition">
                          <td className="py-2.5 pr-3 font-bold text-slate-800 whitespace-nowrap">{r.displayId}</td>
                          <td className="py-2.5 pr-3 whitespace-nowrap">
                            <p className="font-semibold text-slate-700">{dt.date}</p>
                            <p className="text-[10px] text-slate-400">{dt.time}</p>
                          </td>
                          <td className="py-2.5 pr-3 font-semibold text-slate-700 max-w-[140px] truncate" title={r.customerName}>{r.customerName}</td>
                          <td className="py-2.5 pr-3 font-semibold text-slate-700 max-w-[120px] truncate" title={r.staffName}>{r.staffName}</td>
                          <td className="py-2.5 pr-3 text-slate-500 max-w-[200px] truncate" title={r.itemsSummary}>{r.itemsSummary}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-slate-700">{r.quantity}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-slate-500">{formatBDT(r.discount)}</td>
                          <td className="py-2.5 pr-3 text-right font-black text-slate-900 whitespace-nowrap">{formatBDT(r.total)}</td>
                          <td className="py-2.5 pr-3 text-slate-500 max-w-[120px] truncate" title={(r.paymentMethods || []).join(', ')}>
                            {(r.paymentMethods || []).join(', ') || '—'}
                          </td>
                          <td className="py-2.5">
                            <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 whitespace-nowrap">
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {!txLoading && !txError && totalPages > 0 && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <p className="text-[11px] font-semibold text-slate-400">
                  Page {page} of {totalPages} · {total} transactions
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => changePage(page - 1)}
                    disabled={page <= 1 || txLoading}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition cursor-pointer"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => changePage(page + 1)}
                    disabled={page >= totalPages || txLoading}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition cursor-pointer"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
