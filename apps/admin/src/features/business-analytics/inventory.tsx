'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Info, Package } from 'lucide-react'
import { riseStyle, type StatusTone } from '@/components/ui/dashboard'
import { apiClient } from '@/lib/api-client'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import {
  useInventoryLedger,
  useInventoryMovement,
  useInventoryStockouts,
  useInventoryValue,
} from './hooks'
import {
  DEFAULT_FILTERS,
  INVENTORY_CLOSING_ONLY_NOTE,
  INVENTORY_DRILL_LABEL,
  INVENTORY_VALUE_BASIS_STATEMENT,
  LOST_SALES_NOTE,
  MOVEMENT_POLICY_LABEL,
  formatBDT,
  formatPct,
  type AnalyticsFilters,
  type InventoryLedgerData,
  type InventoryMovementData,
  type InventoryMovementRow,
  type InventoryStockoutsData,
  type InventoryValueData,
  type KpiValue,
} from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { DataCoverageBadge } from './components/badges'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'
import { buildInventoryQuery } from './api'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')
const RATIO_FORMAT = (v: number) => `${v.toFixed(2)}×`
const DAYS_FORMAT = (v: number) => `${v.toFixed(1)} days`

const MOVEMENT_TONE: Record<string, Exclude<StatusTone, 'neutral'>> = {
  Fast: 'success',
  Normal: 'info',
  Slow: 'warning',
  Dead: 'danger',
}

const INVENTORY_DRILLDOWN: DrilldownItem[] = [
  { label: 'Inventory value → movement class', description: 'Reconstructed value down to per-product movement', to: '/op/analytics/inventory', params: { view: 'movement' } },
  { label: 'Movement class → product/variant', description: 'Dead / Fast / Slow / Normal down to the sold entity', to: '/op/analytics/products' },
  { label: 'Product/variant → stock ledger', description: 'Ledger entries behind the closing stock', to: '/op/analytics/inventory', params: { view: 'ledger' } },
  { label: 'Stock-out → lost sales evidence', description: 'Days at stock ≤ 0 with measurable demand only', to: '/op/analytics/inventory', params: { view: 'stockouts' } },
]

/** Router search params for the §4.2 inventory drill landing (query objects). */
export interface InventoryDrillSearch {
  view?: string
  productId?: string
  variantId?: string
}

/**
 * Resolve the drill landing: view=ledger — or bare product params — focuses
 * the ledger section pre-filtered by productId/variantId. Pure so the
 * params → filtered-ledger effect is unit-testable.
 */
export function resolveInventoryDrill(search: InventoryDrillSearch | undefined): {
  focusLedger: boolean
  productId?: string
  variantId?: string
} {
  const productId = search?.productId || undefined
  const variantId = search?.variantId || undefined
  const focusLedger = search?.view === 'ledger' || productId !== undefined || variantId !== undefined
  return { focusLedger, productId, variantId }
}

/** Drill href built from query objects — the landing above honours it. */
export function inventoryLedgerHref(productId: string, variantId: string | null): string {
  const qs = new URLSearchParams({
    view: 'ledger',
    productId,
    ...(variantId ? { variantId } : {}),
  }).toString()
  return `/op/analytics/inventory?${qs}`
}

/** Falls back to the live URL when no router search is passed (plain <a> landings). */
export function readInventoryDrillSearch(): InventoryDrillSearch {
  if (typeof window === 'undefined') return {}
  const qs = new URLSearchParams(window.location.search)
  return {
    view: qs.get('view') ?? undefined,
    productId: qs.get('productId') ?? undefined,
    variantId: qs.get('variantId') ?? undefined,
  }
}

interface WarehouseOption {
  id: string
  name: string
}

/** Warehouse scope for inventory pages (§4.1 — fulfillment location). */
export function InventoryWarehouseScope({
  value,
  onChange,
}: {
  value: AnalyticsFilters
  onChange: (n: AnalyticsFilters) => void
}) {
  const { data } = useQuery({
    queryKey: ['inventory-warehouses'],
    queryFn: () => apiClient.get<WarehouseOption[]>('/warehouses').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const options = (Array.isArray(data) ? data : []) as WarehouseOption[]
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Warehouse
      <select
        aria-label="Warehouse scope"
        className="tap-h rounded-lg border border-border/50 bg-background px-2 text-xs"
        value={value.warehouseId ?? ''}
        onChange={(e) => onChange({ ...value, warehouseId: e.target.value || undefined })}
        data-testid="warehouse-scope"
      >
        <option value="">All warehouses</option>
        {options.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** §2.8 value panel: reconstructed open/close/average with basis honesty. */
export function ValueBasisBanner({ value }: { value: InventoryValueData }) {
  const closingOnly = value.basis === 'closing_only'
  return (
    <Card data-testid="value-basis" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Inventory Value — reconstructed</CardTitle>
          <span className="flex gap-2">
            <DataCoverageBadge
              missing={closingOnly ? 1 : 0}
              label="History gap"
              title="Reconstruction diverged from the FIFO valuation — closing-only basis"
            />
            <Badge variant="info">{value.basis === 'closing_only' ? 'closing_only' : 'reconstructed'}</Badge>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{value.basisStatement || INVENTORY_VALUE_BASIS_STATEMENT}</p>
        {closingOnly ? (
          <p className="text-xs text-warning border border-warning/30 bg-warning-soft rounded-md px-2 py-1.5" data-testid="closing-only-note">
            {value.basisNote || INVENTORY_CLOSING_ONLY_NOTE}
          </p>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)}>
          <KpiCard title="Opening value" kpi={value.value.opening} />
          <KpiCard title="Closing value" kpi={value.value.closing} />
          <KpiCard title="Average value" kpi={value.value.average} />
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Reconstructed at {value.reconstructedAt} · {COUNT_FORMAT(value.coverage.lots)} lot(s) ·{' '}
          {COUNT_FORMAT(value.coverage.products)} product(s)
          {value.coverage.inactiveExcluded > 0 ? ` · ${value.coverage.inactiveExcluded} inactive lot(s) excluded` : null} ·{' '}
          Period {value.periodDays} day(s)
        </p>
      </CardContent>
    </Card>
  )
}

/** Turnover / DOI / sell-through summary (COGS from the P2 recognised cohort). */
export function TurnoverCards({ value }: { value: InventoryValueData }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-rise" style={riseStyle(1)} data-testid="turnover-cards">
      <KpiCard title="Stock turnover (COGS ÷ avg)" kpi={value.turnover} format={RATIO_FORMAT} />
      <KpiCard title="Days of inventory" kpi={value.doi} format={DAYS_FORMAT} />
    </div>
  )
}

/** Movement table with the default-policy label + rationale tooltip. */
export function MovementTable({ data }: { data: InventoryMovementData }) {
  return (
    <Card data-testid="movement-table" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Movement Classes</CardTitle>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
            title={data.policyRationale}
            data-testid="movement-policy"
          >
            <Info className="h-3.5 w-3.5" />
            {data.policyLabel || MOVEMENT_POLICY_LABEL}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dash-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 pr-3 font-medium">Class</th>
                  <th className="py-2 pr-3 font-medium">Sold</th>
                  <th className="py-2 pr-3 font-medium">Closing</th>
                  <th className="py-2 pr-3 font-medium">DOI</th>
                  <th className="py-2 pr-3 font-medium">Sell-through</th>
                  <th className="py-2 pr-3 font-medium">Stock-out days</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: InventoryMovementRow) => (
                  <tr key={`${r.productId}|${r.variantId ?? ''}`} className="border-t border-border/50" data-testid={`movement-row-${r.productId}`}>
                    <td className="py-2 pr-3 font-medium">
                      <a
                        className="underline underline-offset-2"
                        href={inventoryLedgerHref(r.productId, r.variantId)}
                        data-testid={`movement-drill-${r.productId}`}
                      >
                        {r.name}
                      </a>
                      {r.variantId ? <span className="block text-[11px] text-muted-foreground">{r.variantId}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={MOVEMENT_TONE[r.movementClass] ?? 'info'} title={r.policyLabel}>
                        {r.movementClass}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(r.unitsSold)}</td>
                    <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(r.closingUnits)}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.doi === null ? 'N/A' : DAYS_FORMAT(r.doi)}</td>
                    <td className="py-2 pr-3 tabular-nums">{formatPct(r.sellThrough)}</td>
                    <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(r.stockoutDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Page {data.page} of {data.totalPages} · {data.total} row(s)
        </p>
      </CardContent>
    </Card>
  )
}

/** Lost-sales honesty: estimated only with stock-out + measurable demand. */
export function LostSalesCard({ data }: { data: InventoryStockoutsData }) {
  const kpi: KpiValue = data.lostSales
  return (
    <Card data-testid="lost-sales" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Lost Sales</CardTitle>
          <Badge variant="info">
            {kpi.state === 'estimated' ? 'Estimated' : 'Honesty'}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">{data.lostSalesNote || LOST_SALES_NOTE}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KpiCard title="Stock-out days" kpi={data.stockoutDays} format={COUNT_FORMAT} />
          <KpiCard title="Lost sales" kpi={kpi} />
        </div>
        {kpi.state === 'estimated' && data.lostSales.lostUnits != null ? (
          <p className="text-xs text-muted-foreground tabular-nums" data-testid="lost-units">
            ≈ {data.lostSales.lostUnits.toFixed(1)} units · {data.productsAffected} product(s) affected
          </p>
        ) : (
          <p className="text-xs text-muted-foreground tabular-nums">{data.productsAffected} product(s) affected</p>
        )}
      </CardContent>
    </Card>
  )
}

/** Age buckets of the reconstructed remainder. */
export function AgingTable({ value }: { value: InventoryValueData }) {
  return (
    <Card data-testid="aging-table" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Aging</CardTitle>
        <p className="text-[11px] text-muted-foreground">{value.aging.dateBasis}</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Age</th>
                <th className="py-2 pr-3 font-medium">Units</th>
                <th className="py-2 pr-3 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {value.aging.buckets.map((b) => (
                <tr key={b.label} className="border-t border-border/50">
                  <td className="py-2 pr-3 font-medium">{b.label} days</td>
                  <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(b.units)}</td>
                  <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(b.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Ledger drill-down: quantities only, never unitCost. */
export function LedgerTable({ data }: { data: InventoryLedgerData }) {
  return (
    <Card data-testid="ledger-table" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Stock Ledger</CardTitle>
        <p className="text-[11px] text-muted-foreground">{data.dateBasis} · quantities only</p>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="dash-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium">Before → After</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-t border-border/50">
                    <td className="py-2 pr-3 tabular-nums">{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
                    <td className="py-2 pr-3">{r.source}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.direction === 'OUT' ? '-' : '+'}
                      {COUNT_FORMAT(r.quantity)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.stockBefore ?? '—'} → {r.stockAfter ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.type ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          Page {data.page} of {data.totalPages} · {data.total} row(s)
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Ledger section: when a drill landing focuses it, the section is marked,
 * announced, and pre-filtered by the drill product — the params → filtered
 * ledger effect lives here (not in the href shape).
 */
export function InventoryLedgerSection({
  data,
  focus,
  productId,
  variantId,
  sectionRef,
}: {
  data: InventoryLedgerData
  focus: boolean
  productId?: string
  variantId?: string
  sectionRef?: Ref<HTMLElement>
}) {
  return (
    <section
      ref={sectionRef}
      data-testid="ledger-section"
      data-focus={focus ? 'true' : 'false'}
      tabIndex={focus ? 0 : -1}
      aria-label={focus ? 'Stock ledger (drill-down filtered)' : 'Stock ledger'}
    >
      {focus ? (
        <p className="mb-2 text-xs text-muted-foreground" data-testid="ledger-focus-note">
          Ledger pre-filtered by drill-down
          {productId ? ` · product ${productId}` : ''}
          {variantId ? ` · variant ${variantId}` : ''}
        </p>
      ) : null}
      <LedgerTable data={data} />
    </section>
  )
}

/**
 * Inventory Analytics (P8, §2.8): reconstructed value with closing_only
 * disclosure + reconstructedAt; turnover/DOI/sell-through/stock-out;
 * aging; movement classes under the default 30/90-day policy;
 * lost-sales honesty; drill-down value → movement → product/variant → ledger.
 *
 * Drill landing: ?view=ledger&productId=&variantId= (router search, or the
 * live URL fallback) focuses the ledger section pre-filtered by the drill
 * product — every ledger request carries the narrow via buildInventoryQuery.
 */
export default function InventoryAnalytics({ initialSearch }: { initialSearch?: InventoryDrillSearch } = {}) {
  const [drill] = useState(() => resolveInventoryDrill(initialSearch ?? readInventoryDrillSearch()))
  const [filters, setFilters] = useState<AnalyticsFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...(drill.productId ? { productId: drill.productId } : {}),
    ...(drill.variantId ? { variantId: drill.variantId } : {}),
  }))
  const [page, setPage] = useState(1)
  const pageSize = 20
  const ledgerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (drill.focusLedger) {
      ledgerRef.current?.focus?.()
      ledgerRef.current?.scrollIntoView?.({ block: 'start' })
    }
  }, [drill.focusLedger])
  const { data, isLoading, error, refetch } = useInventoryValue(filters)
  const movement = useInventoryMovement(filters, page, pageSize)
  const stockouts = useInventoryStockouts(filters, page, pageSize)
  const ledger = useInventoryLedger(filters, page, pageSize)

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n)
    setPage(1)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="chart-card-header-icon bg-accent-violet-soft text-accent-violet border border-accent-violet/25">
            <Package className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Inventory Analytics</h1>
            <p className="text-xs text-muted-foreground">{INVENTORY_DRILL_LABEL}. Movement {MOVEMENT_POLICY_LABEL}.</p>
          </div>
        </div>
        <InventoryWarehouseScope value={filters} onChange={onFilters} />
      </div>

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Inventory"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <ValueBasisBanner value={data.data} />

            <TurnoverCards value={data.data} />

            <AgingTable value={data.data} />

            {movement.data ? (
              <MovementTable data={movement.data.data} />
            ) : movement.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            {stockouts.data ? (
              <LostSalesCard data={stockouts.data.data} />
            ) : stockouts.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            {ledger.data ? (
              <InventoryLedgerSection
                data={ledger.data.data}
                focus={drill.focusLedger}
                productId={drill.productId}
                variantId={drill.variantId}
                sectionRef={ledgerRef}
              />
            ) : ledger.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            <DrilldownPanel filters={filters} items={INVENTORY_DRILLDOWN} queryBuilder={buildInventoryQuery} />

            <p className="text-[11px] text-muted-foreground">
              Formula {data.meta.formulaVersion} · Data as of {data.meta.dataAsOf} · {data.meta.dateBasis} · Period {data.meta.range.periodDays} day(s)
            </p>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-lg" />
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        )}
      </WidgetShell>
    </div>
  )
}
