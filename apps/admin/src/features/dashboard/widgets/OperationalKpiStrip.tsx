'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ShoppingCart,
  Wallet,
  CreditCard,
  PauseCircle,
  PhoneCall,
  PhoneOff,
  PackageCheck,
  Package,
  PackageX,
  Truck,
  TruckIcon,
  CheckCircle2,
  PieChart,
  RotateCcw,
  Undo2,
  ShieldAlert,
  XCircle,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react'
import { dashboardApi } from '../api'
import { formatNumber } from '../utils'
import { CountUp, riseStyle, type KpiAccent } from '@/components/ui/dashboard'
import { apiClient } from '@/lib/api-client'
import { useOrdersFilterStore } from '@/stores/orders-filter-store'
import type { DatePresetKey, OrderStatusCount, WidgetProps } from '../types'

interface KpiTile {
  /** Display label; `Pending` is shown as "New Orders" (see STATUS_PRESENTATION). */
  label: string
  /** The `OrderStatus.name` this tile represents (used as the React key). */
  statusName: string
  /** Null while loading — renders "—", never a misleading 0. */
  raw: number | null
  format: (v: number) => string
  subtext: string
  icon: React.ReactNode
  accent: KpiAccent
  link: string
  /**
   * Status name the tile filters the order list to on click. Null = the
   * tile's number has no matching status filter (a creation total, not a
   * status backlog), so the click clears any filter instead.
   */
  filterStatusName: string | null
  /** Native hover tooltip (title attr) — used where the label needs a basis note. */
  tooltip?: string
}

/** Human label of the selected period, shown so no number is ambiguous. */
export const PERIOD_LABELS: Record<DatePresetKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  all_time: 'All time',
  custom: 'Custom range',
}

interface StatusPresentation {
  label: string
  icon: LucideIcon
  accent: KpiAccent
  /** Activity-vs-Pipeline basis note, where the two views genuinely differ. */
  activityTooltip?: string
  pipelineTooltip?: string
}

/**
 * Per-status presentation. The tile LIST is data-driven (every configured
 * `OrderStatus` gets one, in lifecycle order); this map only supplies the
 * label/icon/accent, with a sensible fallback so a status added later still
 * renders correctly.
 *
 * `Pending` is deliberately labelled "New Orders": the status is a backlog
 * concept, while the panel has always shown it as newly-created orders.
 */
const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  Pending: {
    label: 'New Orders',
    icon: ShoppingCart,
    accent: 'primary',
    activityTooltip: 'Orders created in the selected period',
    pipelineTooltip: 'Orders created in the selected period, currently in Pending status',
  },
  'Payment Pending': { label: 'Payment Pending', icon: Wallet, accent: 'warning' },
  'Payment Verifying': { label: 'Payment Verifying', icon: CreditCard, accent: 'violet' },
  Hold: { label: 'Hold', icon: PauseCircle, accent: 'warning' },
  // E: the call-center pre-confirmation pair.
  Recall: { label: 'Recall', icon: PhoneCall, accent: 'warning' },
  'No Response': { label: 'No Response', icon: PhoneOff, accent: 'violet' },
  Confirmed: { label: 'Confirmed', icon: PackageCheck, accent: 'info' },
  Packed: { label: 'Packed', icon: Package, accent: 'cyan' },
  'Packing Hold': { label: 'Packing Hold', icon: PackageX, accent: 'warning' },
  Shipping: {
    label: 'Shipping',
    icon: Truck,
    accent: 'info',
    activityTooltip: 'Orders picked up in the selected period',
    pipelineTooltip: 'Orders created in the selected period, currently in Shipping status',
  },
  Delivered: {
    label: 'Delivered',
    icon: TruckIcon,
    accent: 'success',
    activityTooltip: 'Orders delivered in the selected period',
    pipelineTooltip: 'Orders created in the selected period, currently in Delivered status',
  },
  Partial: { label: 'Partial', icon: PieChart, accent: 'warning' },
  'Return Pending': { label: 'Return Pending', icon: RotateCcw, accent: 'danger' },
  Returned: { label: 'Returned', icon: Undo2, accent: 'danger' },
  Damaged: { label: 'Damaged', icon: ShieldAlert, accent: 'danger' },
  Cancelled: { label: 'Cancelled', icon: XCircle, accent: 'danger' },
}

/** Fallback presentation for a status this build has never seen. */
function presentationFor(name: string): StatusPresentation {
  return STATUS_PRESENTATION[name] ?? {
    label: name,
    icon: Package,
    accent: 'info' as KpiAccent,
  }
}

export function OperationalKpiStrip({ dateRange, preset, view = 'activity' }: WidgetProps) {
  const startStr = dateRange.start.toISOString()
  const endStr = dateRange.end.toISOString()
  const isPipeline = view === 'pipeline'

  // View-aware KPI query. View is part of the key so Activity (event counts
  // in period) and Pipeline (cohort current-state) never share a cache entry.
  const {
    data: kpiRes,
    isLoading: kpiLoading,
    isError: kpiError,
  } = useQuery({
    queryKey: ['operational-kpis', view, startStr, endStr],
    queryFn: () =>
      view === 'pipeline'
        ? dashboardApi.getOperationalPipelineKpis(startStr, endStr)
        : dashboardApi.getOperationalKpis(startStr, endStr),
    refetchInterval: 30_000,
  })

  const kpi = kpiRes?.data
  const isLoading = kpiLoading
  const hasError = kpiError
  const periodLabel = PERIOD_LABELS[preset] ?? PERIOD_LABELS.last_30_days
  // Pipeline tiles show CURRENT state of the period cohort, never period
  // events — the subtext must say so on every tile.
  const cohortLabel = `Now · ${periodLabel} cohort`

  // Order statuses for tile-click filtering (shared cache with the
  // PendingOrders widget). Tiles carry a status NAME; the order list
  // filters by status ID, so the name has to resolve here.
  const { data: statusesData } = useQuery({
    queryKey: ['order-statuses'],
    queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]),
  })
  const setStatusFilter = useOrdersFilterStore(s => s.setStatusFilter)

  /**
   * Tile click → the order list, filtered to that tile's status. The list
   * filter is a Zustand store (persisted to sessionStorage), so setting it
   * before navigation is enough — the list reads the store on mount. A
   * tile whose number is a creation total (not a status backlog) clears
   * any filter instead: filtering it to a status would show a different
   * population than the number. If statuses haven't loaded, fall through
   * to an unfiltered list rather than blocking navigation.
   */
  const handleTileClick = (tile: KpiTile) => {
    if (tile.filterStatusName === null) {
      setStatusFilter('all')
      return
    }
    const match = statusesData?.find(s => s.name === tile.filterStatusName)
    if (match) setStatusFilter(match.id)
  }

  // One tile per order status, straight from the response. While loading or on
  // error the catalogue is unknown, so tiles fall back to the known statuses
  // with a null (—) value rather than collapsing the strip to nothing.
  const statusCounts: OrderStatusCount[] =
    kpi?.statusCounts ??
    (isLoading || hasError
      ? Object.keys(STATUS_PRESENTATION).map((name, i) => ({
          name,
          count: 0,
          color: '',
          sortOrder: i,
        }))
      : [])

  const tiles: KpiTile[] = statusCounts
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const p = presentationFor(s.name)
      const Icon = p.icon
      return {
        label: p.label,
        statusName: s.name,
        // Null (not 0) while the value is unknown, so an empty tile is never
        // mistaken for a real zero and silently hidden below.
        raw: kpi ? s.count : null,
        format: formatNumber,
        subtext: isPipeline ? cohortLabel : periodLabel,
        tooltip: isPipeline ? p.pipelineTooltip : p.activityTooltip,
        icon: <Icon className="h-4 w-4" />,
        accent: p.accent,
        link: '/op/orders',
        // Activity "New Orders" is a CREATION count (orders created in the
        // period), not the current Pending backlog — filtering it to Pending
        // would show a different population than the number. Every other
        // tile filters to its status; the order list itself is current-state,
        // not period-scoped, so an activity tile's list is the status as it
        // stands now, not the period events.
        filterStatusName: !isPipeline && s.name === 'Pending' ? null : s.name,
      }
    })
    // A status with no orders in the selected period is not shown at all —
    // but only once its real (zero) value is known, never while loading.
    .filter((t) => t.raw === null || t.raw > 0)

  // Total Orders — pipeline view only. In pipeline, `newOrders` is the
  // cohort total, a number no status tile shows (Pending there is the
  // cohort's CURRENT Pending count, a subset). In activity view the
  // "New Orders" tile already IS `newOrders`, so a second tile with the
  // same number would be a confusing duplicate — the activity caption
  // below says the tiles do not sum to a total instead. Gated on `kpi`
  // so no phantom dash renders while loading.
  const totalTile: KpiTile | null =
    kpi && isPipeline
      ? {
          label: 'Total Orders',
          statusName: '__total__',
          raw: kpi.newOrders,
          format: formatNumber,
          subtext: `Cohort total · ${periodLabel}`,
          tooltip: 'All orders created in the selected period',
          icon: <ShoppingCart className="h-4 w-4" />,
          accent: 'primary',
          link: '/op/orders',
          filterStatusName: null,
        }
      : null
  const allTiles = [
    ...(totalTile && totalTile.raw !== null && totalTile.raw > 0 ? [totalTile] : []),
    ...tiles,
  ]

  return (
    <div className="space-y-2">
      {hasError && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-[11px] font-medium text-destructive"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          Some KPIs could not be loaded — showing values where available.
        </p>
      )}
      {/* Basis caption: Activity and Pipeline count different populations,
          and neither is labelled as the other anywhere on this page. */}
      <p className="text-[11px] text-muted-foreground font-medium">
        {isPipeline
          ? 'Pipeline basis: current status of orders created in the selected period. One count per order; tiles sum to Total Orders.'
          : 'Activity basis: orders entering each status in the selected period. One order can appear under several statuses, so tiles do not sum to a total.'}
      </p>
      {/* Every configured order status gets a card, so the row reflows with the
          filter: a status with no orders in the period is simply absent. */}
      <div key={view} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {allTiles.map((tile, i) => (
          <Link
            key={tile.statusName}
            to={tile.link as any}
            onClick={() => handleTileClick(tile)}
            className="block h-full animate-rise"
            style={riseStyle(i)}
          >
            <div
              title={tile.tooltip}
              className={`kpi-card kpi-accent-${tile.accent} flex flex-col h-full p-3 ${isLoading ? 'opacity-75' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground leading-tight line-clamp-2">
                  {tile.label}
                </span>
                <span className="kpi-icon-badge shrink-0" aria-hidden>
                  {tile.icon}
                </span>
              </div>
              <div className="mt-auto space-y-0.5 pt-2">
                <span
                  className={`kpi-value block leading-tight truncate ${tile.raw === 0 ? 'is-zero' : ''}`}
                  title={tile.raw === null ? '—' : tile.format(tile.raw)}
                >
                  {tile.raw === null ? '—' : <CountUp value={tile.raw} format={tile.format} />}
                </span>
                <p className="text-[10px] text-muted-foreground font-medium leading-tight truncate">
                  {tile.subtext}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
