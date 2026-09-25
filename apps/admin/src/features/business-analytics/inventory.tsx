'use client'

import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, Package } from 'lucide-react'
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
import { AnalyticsPageHeader, EmptyState, InfoDisclosure, MetricMetaFooter } from './components/analytics-ui'
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
  { label: 'Inventory value → movement class', description: 'Reconstructed value down to per-product movement', to: '/mon/analytics/inventory', params: { view: 'movement' } },
  { label: 'Movement class → product/variant', description: 'Dead / Fast / Slow / Normal down to the sold entity', to: '/mon/analytics/products' },
  { label: 'Product/variant → stock ledger', description: 'Ledger entries behind the closing stock', to: '/mon/analytics/inventory', params: { view: 'ledger' } },
  { label: 'Stock-out → lost sales evidence', description: 'Days at stock ≤ 0 with measurable demand only', to: '/mon/analytics/inventory', params: { view: 'stockouts' } },
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
  return `/mon/analytics/inventory?${qs}`
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

/**
 * Product names for the ledger focus note, resolved from the movement rows
 * already on the page (pure so the id → name resolution is unit-testable).
 * Keyed `${productId}|${variantId ?? ''}`.
 */
export function resolveLedgerNames(
  rows: { productId: string; variantId: string | null; name: string }[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const r of rows) map[`${r.productId}|${r.variantId ?? ''}`] = r.name
  return map
}

interface WarehouseOption {
  id: string
  name: string
}

/**
 * Warehouse scope for inventory pages (§4.1 — fulfillment location). W3: the
 * shadcn Select idiom (never a native select), rendered in the filter row
 * below the page header so the header never squeezes at 360px.
 */
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
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span id="warehouse-scope-label">Warehouse</span>
      <Select
        value={value.warehouseId ?? '__all'}
        onValueChange={(v) => onChange({ ...value, warehouseId: v === '__all' ? undefined : v })}
      >
        <SelectTrigger
          className="tap-h h-10 w-44 cursor-pointer text-xs"
          aria-labelledby="warehouse-scope-label"
          data-testid="warehouse-scope"
        >
          <SelectValue placeholder="All warehouses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All warehouses</SelectItem>
          {options.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * §2.8 value panel (W3): a section, never a Card nesting KpiCards. The
 * closing-only warning is a compact role=alert shown only on closing_only;
 * coverage counts live in disclosure, never a caption.
 */
export function ValueBasisBanner({ value, formulaVersion }: { value: InventoryValueData; formulaVersion?: string }) {
  const closingOnly = value.basis === 'closing_only'
  return (
    <section aria-label="Inventory Value — reconstructed" data-testid="value-basis" className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold">Inventory Value — reconstructed</h2>
        <span className="flex gap-2">
          <DataCoverageBadge
            missing={closingOnly ? 1 : 0}
            label="History gap"
            title="Reconstruction diverged from the FIFO valuation — closing-only basis"
          />
          <Badge variant="info">{value.basis === 'closing_only' ? 'closing_only' : 'reconstructed'}</Badge>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{value.basisStatement || INVENTORY_VALUE_BASIS_STATEMENT}</p>
      {closingOnly ? (
        <div role="alert" className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning" data-testid="closing-only-note">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{value.basisNote || INVENTORY_CLOSING_ONLY_NOTE}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)}>
        <KpiCard title="Opening value" kpi={value.value.opening} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Closing value" kpi={value.value.closing} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Average value" kpi={value.value.average} formulaVersion={formulaVersion} animate={false} />
      </div>
      <InfoDisclosure
        label="About inventory coverage"
        lines={[
          `Reconstructed at ${value.reconstructedAt}`,
          `${COUNT_FORMAT(value.coverage.lots)} lot(s) · ${COUNT_FORMAT(value.coverage.products)} product(s)${value.coverage.inactiveExcluded > 0 ? ` · ${value.coverage.inactiveExcluded} inactive lot(s) excluded` : ''}`,
          `Period ${value.periodDays} day(s)`,
        ]}
        contentTestId="value-coverage"
      />
    </section>
  )
}

/** Turnover / DOI / sell-through summary (COGS from the P2 recognised cohort). */
export function TurnoverCards({ value, formulaVersion }: { value: InventoryValueData; formulaVersion?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-rise" style={riseStyle(1)} data-testid="turnover-cards">
      <KpiCard title="Stock turnover (COGS ÷ avg)" kpi={value.turnover} format={RATIO_FORMAT} formulaVersion={formulaVersion} animate={false} />
      <KpiCard title="Days of inventory" kpi={value.doi} format={DAYS_FORMAT} formulaVersion={formulaVersion} animate={false} />
    </div>
  )
}

/**
 * Movement table (W3): the default-policy label stays visible; the rationale
 * moved from a hover-only title into a tap-friendly disclosure. Per-row
 * variant ids are quiet sublines; the class Badge carries no title (the
 * class word itself is the indicator, colour never sole).
 */
export function MovementTable({ data }: { data: InventoryMovementData }) {
  return (
    <Card data-testid="movement-table" className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Movement Classes</CardTitle>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="movement-policy">
            {data.policyLabel || MOVEMENT_POLICY_LABEL}
            <InfoDisclosure
              label="About movement policy"
              lines={[data.policyLabel || MOVEMENT_POLICY_LABEL, data.policyRationale]}
              contentTestId="movement-policy-notes"
              compact
            />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="dash-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Product</th>
                  <th className="py-2 pr-3 font-medium">Class</th>
                  <th className="py-2 pr-3 font-medium text-right">Sold</th>
                  <th className="py-2 pr-3 font-medium text-right">Closing</th>
                  <th className="py-2 pr-3 font-medium text-right">DOI</th>
                  <th className="py-2 pr-3 font-medium text-right">Sell-through</th>
                  <th className="py-2 pr-3 font-medium text-right">Stock-out days</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: InventoryMovementRow) => (
                  <tr key={`${r.productId}|${r.variantId ?? ''}`} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`movement-row-${r.productId}`}>
                    <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">
                      <a
                        className="underline underline-offset-2"
                        href={inventoryLedgerHref(r.productId, r.variantId)}
                        data-testid={`movement-drill-${r.productId}`}
                      >
                        {r.name}
                      </a>
                      {r.variantId ? <span className="block text-[10px] font-normal text-muted-foreground/70">Variant {r.variantId}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={MOVEMENT_TONE[r.movementClass] ?? 'info'}>
                        {r.movementClass}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(r.unitsSold)}</td>
                    <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(r.closingUnits)}</td>
                    <td className="py-2 pr-3 tabular-nums text-right">{r.doi === null ? 'N/A' : DAYS_FORMAT(r.doi)}</td>
                    <td className="py-2 pr-3 tabular-nums text-right">{formatPct(r.sellThrough)}</td>
                    <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(r.stockoutDays)}</td>
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
export function LostSalesCard({ data, formulaVersion }: { data: InventoryStockoutsData; formulaVersion?: string }) {
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
          <KpiCard title="Stock-out days" kpi={data.stockoutDays} format={COUNT_FORMAT} formulaVersion={formulaVersion} animate={false} />
          <KpiCard title="Lost sales" kpi={kpi} formulaVersion={formulaVersion} animate={false} />
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
          <table className="dash-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Age</th>
                <th className="py-2 pr-3 font-medium text-right">Units</th>
                <th className="py-2 pr-3 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {value.aging.buckets.map((b) => (
                <tr key={b.label} className="border-t border-border/50 transition-colors hover:bg-muted/40">
                  <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">{b.label} days</td>
                  <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(b.units)}</td>
                  <td className="py-2 pr-3 tabular-nums font-medium text-right">{formatBDT(b.value)}</td>
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
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="dash-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Date</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium text-right">Qty</th>
                  <th className="py-2 pr-3 font-medium text-right">Before → After</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-t border-border/50 transition-colors hover:bg-muted/40">
                    <td className="py-2 pr-3 tabular-nums sticky left-0 bg-card z-10">{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
                    <td className="py-2 pr-3">{r.source}</td>
                    <td className="py-2 pr-3 tabular-nums text-right">
                      {r.direction === 'OUT' ? '-' : '+'}
                      {COUNT_FORMAT(r.quantity)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-right">
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
 * ledger effect lives here (not in the href shape). The focus note names the
 * product from the movement rows on the page (raw ids only as fallback —
 * variant labels exist nowhere in the inventory payload).
 */
export function InventoryLedgerSection({
  data,
  focus,
  productId,
  variantId,
  names,
  sectionRef,
}: {
  data: InventoryLedgerData
  focus: boolean
  productId?: string
  variantId?: string
  names?: Record<string, string>
  sectionRef?: Ref<HTMLElement>
}) {
  const productName = productId
    ? (names?.[`${productId}|${variantId ?? ''}`] ?? names?.[`${productId}|`])
    : undefined
  return (
    <section
      ref={sectionRef}
      data-testid="ledger-section"
      data-focus={focus ? 'true' : 'false'}
      tabIndex={focus ? 0 : -1}
      aria-label={focus ? 'Stock ledger (drill-down filtered)' : 'Stock ledger'}
    >
      {focus ? (
        <p className="mb-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" data-testid="ledger-focus-note">
          Ledger pre-filtered by drill-down
          {productId ? ` · product ${productName ?? productId}` : ''}
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
  // Product names for the ledger focus note come from the movement rows —
  // the ledger payload itself carries ids only.
  const ledgerNames = useMemo(
    () => resolveLedgerNames(movement.data?.data.rows ?? []),
    [movement.data],
  )

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n)
    setPage(1)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <AnalyticsPageHeader
        icon={Package}
        title="Inventory Analytics"
        subtitle={`${INVENTORY_DRILL_LABEL}. Movement ${MOVEMENT_POLICY_LABEL}.`}
        tileClassName="bg-accent-violet-soft text-accent-violet border-accent-violet/25"
      />

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <div className="flex flex-wrap items-center gap-2">
        <InventoryWarehouseScope value={filters} onChange={onFilters} />
      </div>

      <WidgetShell
        title="Inventory"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <ValueBasisBanner value={data.data} formulaVersion={data.meta.formulaVersion} />

            <TurnoverCards value={data.data} formulaVersion={data.meta.formulaVersion} />

            <AgingTable value={data.data} />

            {movement.data ? (
              <MovementTable data={movement.data.data} />
            ) : movement.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <EmptyState />
            )}

            {stockouts.data ? (
              <LostSalesCard data={stockouts.data.data} formulaVersion={data.meta.formulaVersion} />
            ) : stockouts.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <EmptyState />
            )}

            {ledger.data ? (
              <InventoryLedgerSection
                data={ledger.data.data}
                focus={drill.focusLedger}
                productId={drill.productId}
                variantId={drill.variantId}
                names={ledgerNames}
                sectionRef={ledgerRef}
              />
            ) : ledger.isLoading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : (
              <EmptyState />
            )}

            <DrilldownPanel filters={filters} items={INVENTORY_DRILLDOWN} queryBuilder={buildInventoryQuery} />

            <MetricMetaFooter
              formulaVersion={data.meta.formulaVersion}
              dataAsOf={data.meta.dataAsOf}
              dateBasis={data.meta.dateBasis}
              ladderState={data.meta.ladderState}
              periodDays={data.meta.range.periodDays}
            />
          </div>
        ) : isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-lg" />
        ) : (
          <EmptyState />
        )}
      </WidgetShell>
    </div>
  )
}
