'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Info } from 'lucide-react'
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

const INVENTORY_DRILLDOWN: DrilldownItem[] = [
  { label: 'Inventory value → movement class', description: 'Reconstructed value down to per-product movement', to: '/op/analytics/inventory', params: { view: 'movement' } },
  { label: 'Movement class → product/variant', description: 'Dead / Fast / Slow / Normal down to the sold entity', to: '/op/analytics/products' },
  { label: 'Product/variant → stock ledger', description: 'Ledger entries behind the closing stock', to: '/op/analytics/inventory', params: { view: 'ledger' } },
  { label: 'Stock-out → lost sales evidence', description: 'Days at stock ≤ 0 with measurable demand only', to: '/op/analytics/inventory', params: { view: 'stockouts' } },
]

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
        className="h-8 rounded-lg border border-border/50 bg-background px-2 text-xs"
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
    <Card data-testid="value-basis">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Inventory Value — reconstructed</CardTitle>
          <span className="flex gap-2">
            <DataCoverageBadge
              missing={closingOnly ? 1 : 0}
              label="History gap"
              title="Reconstruction diverged from the FIFO valuation — closing-only basis"
            />
            <Badge variant="outline">{value.basis === 'closing_only' ? 'closing_only' : 'reconstructed'}</Badge>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{value.basisStatement || INVENTORY_VALUE_BASIS_STATEMENT}</p>
        {closingOnly ? (
          <p className="text-xs text-amber-600 border border-amber-500/30 bg-amber-500/5 rounded-md px-2 py-1.5" data-testid="closing-only-note">
            {value.basisNote || INVENTORY_CLOSING_ONLY_NOTE}
          </p>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="turnover-cards">
      <KpiCard title="Stock turnover (COGS ÷ avg)" kpi={value.turnover} format={RATIO_FORMAT} />
      <KpiCard title="Days of inventory" kpi={value.doi} format={DAYS_FORMAT} />
    </div>
  )
}

/** Movement table with the default-policy label + rationale tooltip. */
export function MovementTable({ data }: { data: InventoryMovementData }) {
  return (
    <Card data-testid="movement-table">
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
            <table className="w-full text-sm">
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
                        href={`/op/analytics/inventory?view=ledger&productId=${r.productId}${r.variantId ? `&variantId=${r.variantId}` : ''}`}
                        data-testid={`movement-drill-${r.productId}`}
                      >
                        {r.name}
                      </a>
                      {r.variantId ? <span className="block text-[11px] text-muted-foreground">{r.variantId}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" title={r.policyLabel}>
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
    <Card data-testid="lost-sales">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Lost Sales</CardTitle>
          <Badge variant="outline" className="bg-sky-500/10 text-sky-600 border-sky-500/20">
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
    <Card data-testid="aging-table">
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
    <Card data-testid="ledger-table">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Stock Ledger</CardTitle>
        <p className="text-[11px] text-muted-foreground">{data.dateBasis} · quantities only</p>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
 * Inventory Analytics (P8, §2.8): reconstructed value with closing_only
 * disclosure + reconstructedAt; turnover/DOI/sell-through/stock-out;
 * aging; movement classes under the default 30/90-day policy;
 * lost-sales honesty; drill-down value → movement → product/variant → ledger.
 */
export default function InventoryAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const pageSize = 20
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
        <div>
          <h1 className="text-2xl font-bold">Inventory Analytics</h1>
          <p className="text-xs text-muted-foreground">{INVENTORY_DRILL_LABEL}. Movement {MOVEMENT_POLICY_LABEL}.</p>
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
              <LedgerTable data={ledger.data.data} />
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
