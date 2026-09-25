'use client'

import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useAnalyticsProductDetail } from './hooks'
import { DEFAULT_FILTERS, formatPct, RETURN_INCIDENCE_LABEL, type ProductAnalyticsFilters, type ProductDetailData } from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { AnalyticsSection, EmptyState, InfoDisclosure, MetricMetaFooter } from './components/analytics-ui'
import { KpiCard } from './components/KpiCard'
import { TrendChart } from './components/TrendChart'
import { ProductPnlTable } from './components/ProductPnlTable'
import { ContributionFloor } from './components/ContributionFloor'
import { UncostedFixList } from './components/UncostedFixList'
import { buildOverviewQuery } from './api'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')

/**
 * Variant-row drill href (§4.2): the current filter params propagate onto the
 * orders link together with the row's product/variant scope — never a bare
 * /op/orders. Pure so params propagation is unit-testable.
 */
export function productVariantOrdersHref(
  filters: ProductAnalyticsFilters,
  row: { productId: string; variantId?: string | null },
): string {
  const qs = new URLSearchParams({
    ...buildOverviewQuery(filters),
    productId: row.productId,
    ...(row.variantId ? { variantId: row.variantId } : {}),
  }).toString()
  return `/op/orders${qs ? `?${qs}` : ''}`
}

/**
 * Inventory relation — stock and days-of-inventory as KpiCards plus the
 * movement class in the same kpi-card idiom (categorical, so no KpiValue
 * semantics are bent to fit it).
 */
export function InventoryRelationBand({ product }: { product: ProductDetailData['product'] }) {
  return (
    <AnalyticsSection title="Inventory relation" subtext="Stock, sales speed and cover. Not sales.">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="inventory-relation">
        <KpiCard
          title="Stock on hand"
          kpi={{ value: product.stock, state: 'ok', reason: 'Stock you have now in all warehouses.' }}
          format={COUNT_FORMAT}
          animate={false}
        />
        <Card className="kpi-card">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="kpi-icon-badge shrink-0" aria-hidden>
                <Activity className="h-4 w-4" />
              </span>
              <CardTitle className="truncate text-sm font-medium">Movement class</CardTitle>
            </div>
            <InfoDisclosure label="About movement class" lines={['Grouped by sales in the last 30 and 90 days.']} contentTestId="movement-class-detail" />
          </CardHeader>
          <CardContent>
            <p className="kpi-value">{product.movementClass}</p>
            <span className="sr-only" data-testid="movement-class-sr">Grouped by sales in the last 30 and 90 days.</span>
          </CardContent>
        </Card>
        <KpiCard
          title="Days of inventory"
          kpi={
            product.doi === null
              ? { value: null, state: 'not_applicable', reason: 'No sales in this period, so cover days cannot be worked out.' }
              : { value: product.doi, state: 'ok', reason: 'Stock divided by average daily sales.' }
          }
          format={(v) => v.toFixed(1)}
          animate={false}
        />
      </div>
    </AnalyticsSection>
  )
}

/**
 * Product detail (P4, §2.6 + §4.2): parent P&L with basis labels, variant P&L
 * rows (parent = Σ variants), performance trend, return-rate incidence
 * labelling, inventory relation (movement class, DOI, stock + link), catalog
 * link, and the product-scoped uncosted fix-list drilling to orders.
 */
export default function ProductAnalyticsDetail() {
  const { id } = useParams({ from: '/_authenticated/mon/analytics/products/$id' })
  const [filters, setFilters] = useState<ProductAnalyticsFilters>(DEFAULT_FILTERS)
  const { data, isLoading, error, refetch } = useAnalyticsProductDetail(id, filters)

  const inventoryQs = new URLSearchParams(buildOverviewQuery(filters)).toString()

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{data ? data.data.product.name : 'Product'}</h1>
          <p className="text-xs text-muted-foreground">Parent profit with size breakdown. Delivered orders only.</p>
        </div>
        {data ? (
          <div className="flex gap-2">
            <a href={`/op/inventory${inventoryQs ? `?${inventoryQs}` : ''}`} title="Stock check: sales speed, cover days and stock below">
              <Badge variant="outline">View in inventory →</Badge>
            </a>
            <a href={`/op/products/${data.data.product.id}`} title="Open this product in the catalog">
              <Badge variant="outline">Open in catalog →</Badge>
            </a>
          </div>
        ) : null}
      </div>

      <ContributionFloor />

      <AnalyticsFilterBar value={filters} onChange={(n) => setFilters((f) => ({ ...f, ...n }))} />

      <WidgetShell
        title="Product P&L"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Net Sales (direct)" kpi={data.data.parent.netSales} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard title="Contribution" kpi={data.data.parent.contribution} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard
                title="Contribution Margin"
                kpi={{
                  value: data.data.parent.contributionMargin,
                  state: data.data.parent.contributionMargin === null ? 'no_data' : 'ok',
                  reason: 'Profit left per 100 taka of sales.',
                  dateBasis: 'Delivery date',
                }}
                format={(v) => formatPct(v)}
                formulaVersion={data.meta.formulaVersion}
                animate={false}
              />
              <KpiCard
                title="Return Rate (incidence)"
                kpi={{ ...data.data.parent.returnRate, reason: RETURN_INCIDENCE_LABEL }}
                format={(v) => formatPct(v)}
                formulaVersion={data.meta.formulaVersion}
                animate={false}
              />
            </div>

            <InventoryRelationBand product={data.data.product} />

            <ProductPnlTable
              title="Variant P&L — parent = Σ variants (simple products show one implicit child)"
              rows={data.data.variants}
              showVariant
              detailHref={(r) => productVariantOrdersHref(filters, r)}
            />

            <TrendChart points={data.data.trend.points} granularity={data.data.trend.granularity} requestedGranularity={data.data.trend.requestedGranularity} />

            {data.data.uncosted.rows.length > 0 ? (
              <UncostedFixList
                uncosted={{
                  rows: data.data.uncosted.rows.map((r) => ({ ...r, productName: data.data.product.name, variantLabel: r.variantId ?? 'Simple product' })),
                  totals: { units: data.data.uncosted.units, lines: data.data.uncosted.lines },
                }}
              />
            ) : (
              <EmptyState message="No lines missing cost. Every Delivered line has a saved cost." />
            )}

            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">
                Delivered orders: {data.data.parent.recognisedOrders} · Return orders: {data.data.parent.returnOrders} · Missing cost:{' '}
                {data.data.uncosted.units} unit(s)
              </p>
              <MetricMetaFooter
                formulaVersion={data.meta.formulaVersion}
                dataAsOf={data.meta.dataAsOf}
                dateBasis={data.meta.dateBasis}
                ladderState={data.meta.ladderState}
                periodDays={data.meta.range.periodDays}
              />
            </div>
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
