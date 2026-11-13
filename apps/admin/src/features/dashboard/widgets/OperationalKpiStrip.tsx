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
  /** Display label — view-aware for `Pending` (see STATUS_PRESENTATION). */
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
   * tile's number is a creation/cohort total with no matching status filter,
   * so the tile is NOT a link: clicking it would land on a different
   * population (the unfiltered, current-state order list) than the number
   * counted. Such tiles render as plain cards, never as links.
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
 * `Pending` is labelled by VIEW, never "New Orders": in Activity it is a
 * creation count ("Created Today" — orders created in the period, all
 * statuses), in Pipeline it is the cohort's current Pending backlog
 * ("Currently Pending"). The old "New Orders" label read as a backlog while
 * counting creations, which is exactly the confusion this strip fixes.
 */
const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  Pending: {
    label: 'Currently Pending',
    icon: ShoppingCart,
    accent: 'primary',
    activityTooltip:
      'Orders created in the selected period, all statuses. Same total as Pipeline Total Orders.',
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
  // Activity label for the creation count. "Created Today" only when the
  // period really is today; any other preset names itself so the label can
  // never promise a day it does not cover.
  const createdLabel = preset === 'today' ? 'Created Today' : `Created · ${periodLabel}`

  // The Activity view also needs the Pipeline cohort's CURRENT Pending
  // count, so the owner's "currently pending" number sits next to the
  // creation count instead of having to be inferred from a click. Frontend-
  // only: the pipeline endpoint already returns it as its `Pending`
  // statusCount (same range, shared cache key with the Pipeline view), so
  // no backend field is needed. Skipped in the Pipeline view, where the
  // main query already is the pipeline one.
  const { data: pipelineKpiRes, isError: pipelineKpiError } = useQuery({
    queryKey: ['operational-kpis', 'pipeline', startStr, endStr],
    queryFn: () => dashboardApi.getOperationalPipelineKpis(startStr, endStr),
    refetchInterval: 30_000,
    enabled: !isPipeline,
  })
  const pipelineKpi = isPipeline ? kpi : pipelineKpiRes?.data
  const currentlyPending =
    pipelineKpi?.statusCounts?.find((s) => s.name === 'Pending')?.count ?? null

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
   * before navigation is enough — the list reads the store on mount.
   * Creation/cohort totals have no status filter (filterStatusName null)
   * and are NOT links at all (see render below): filtering one to a status
   * would show a different population than the number, and clearing the
   * filter would land on the unfiltered list. If statuses haven't loaded,
   * fall through to an unfiltered list rather than blocking navigation.
   */
  const handleTileClick = (tile: KpiTile) => {
    if (tile.filterStatusName === null) {
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
      const isCreationTile = !isPipeline && s.name === 'Pending'
      return {
        // Activity Pending is the creation count, Pipeline Pending is the
        // cohort's current Pending backlog — different numbers, different
        // labels, never the shared "New Orders".
        label: isCreationTile ? createdLabel : p.label,
        statusName: s.name,
        // Null (not 0) while the value is unknown, so an empty tile is never
        // mistaken for a real zero and silently hidden below.
        raw: kpi ? s.count : null,
        format: formatNumber,
        // G7: every tile carries its basis AND its period in its subtext —
        // creation vs status-entry (activity) vs current-state-of-cohort
        // (pipeline) — not only in the strip caption or a hover tooltip.
        subtext: isPipeline
          ? cohortLabel
          : isCreationTile
            ? `Created · ${periodLabel}`
            : `Entered · ${periodLabel}`,
        tooltip: isPipeline ? p.pipelineTooltip : p.activityTooltip,
        icon: <Icon className="h-4 w-4" />,
        accent: p.accent,
        link: '/op/orders',
        // Activity "Created Today" is a CREATION count (orders created in
        // the period), not the current Pending backlog — filtering it to
        // Pending would show a different population than the number. Every
        // other tile filters to its status; the order list itself is
        // current-state, not period-scoped, so an activity tile's list is
        // the status as it stands now, not the period events.
        filterStatusName: isCreationTile ? null : s.name,
      }
    })
    // A status with no orders in the selected period is not shown at all —
    // but only once its real (zero) value is known, never while loading.
    .filter((t) => t.raw === null || t.raw > 0)

  // Activity view only: "Currently Pending" next to "Created Today" — the
  // pipeline cohort's current Pending count, from the pipeline endpoint
  // above. Hidden while the pipeline query errors (no phantom dash) and
  // when the count is a known zero, like every other tile.
  const currentlyPendingTile: KpiTile | null =
    !isPipeline && !pipelineKpiError
      ? {
          label: 'Currently Pending',
          statusName: '__currently_pending__',
          raw: currentlyPending,
          format: formatNumber,
          subtext: cohortLabel,
          tooltip: STATUS_PRESENTATION.Pending.pipelineTooltip,
          icon: <ShoppingCart className="h-4 w-4" />,
          accent: 'primary',
          link: '/op/orders',
          filterStatusName: 'Pending',
        }
      : null

  // Total Orders — pipeline view only. In pipeline, `newOrders` is the
  // cohort total, a number no status tile shows (Pending there is the
  // cohort's CURRENT Pending count, a subset). In activity view the
  // "Created Today" tile already IS `newOrders`, so a second tile with the
  // same number would be a confusing duplicate — the activity caption
  // below says the two views share that total instead. Gated on `kpi`
  // so no phantom dash renders while loading.
  const totalTile: KpiTile | null =
    kpi && isPipeline
      ? {
          label: 'Total Orders',
          statusName: '__total__',
          raw: kpi.newOrders,
          format: formatNumber,
          subtext: `Cohort total · ${periodLabel}`,
          tooltip:
            'All orders created in the selected period. Same total the Activity view shows as created orders.',
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
  // Currently Pending sits directly after Created Today, so the two numbers
  // the owner compares are adjacent; a known-zero backlog stays hidden.
  if (currentlyPendingTile && (currentlyPendingTile.raw === null || currentlyPendingTile.raw > 0)) {
    const createdIdx = allTiles.findIndex((t) => t.statusName === 'Pending')
    allTiles.splice(createdIdx >= 0 ? createdIdx + 1 : 0, 0, currentlyPendingTile)
  }

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
          and neither is labelled as the other anywhere on this page. G1:
          the caption excepts the creation tile — creation is not a
          status-entry event. The shared total is named, not left to be
          inferred: Activity's creation count IS Pipeline's Total Orders. */}
      <p className="text-[11px] text-muted-foreground font-medium">
        {isPipeline
          ? 'Pipeline basis: current status of orders created in the selected period. One count per order; tiles sum to Total Orders. Total Orders is the same total the Activity view shows as created orders.'
          : `Activity basis: orders entering each status in the selected period — except ${createdLabel}, which counts orders created in the period (all statuses). One order can appear under several statuses, so tiles do not sum to a total. ${createdLabel} is the same total Pipeline calls Total Orders.`}
      </p>
      {/* Every configured order status gets a card, so the row reflows with the
          filter: a status with no orders in the period is simply absent. */}
      <div key={view} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {allTiles.map((tile, i) => {
          // G5: a creation/cohort total has no status filter, so it must not
          // look clickable — it renders as a plain card (no link, no hover
          // lift), never as a tile that promises to show the counted orders.
          // The inline transform/box-shadow neutralises the `.kpi-card:hover`
          // lift, which lives in dashboard.css outside this feature's files.
          const card = (
            <div
              title={tile.tooltip}
              className={`kpi-card kpi-accent-${tile.accent} flex flex-col h-full p-3 ${isLoading ? 'opacity-75' : ''}`}
              style={
                tile.filterStatusName === null
                  ? { transform: 'none', boxShadow: 'var(--shadow-card)' }
                  : undefined
              }
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
          )
          return tile.filterStatusName === null ? (
            <div key={tile.statusName} className="block h-full animate-rise cursor-default" style={riseStyle(i)}>
              {card}
            </div>
          ) : (
            <Link
              key={tile.statusName}
              to={tile.link as any}
              onClick={() => handleTileClick(tile)}
              className="block h-full animate-rise"
              style={riseStyle(i)}
            >
              {card}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
