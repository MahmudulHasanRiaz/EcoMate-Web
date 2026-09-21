'use client'

import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useAnalyticsProductDetail } from './hooks'
import { DEFAULT_FILTERS, formatPct, RETURN_INCIDENCE_LABEL, type ProductAnalyticsFilters } from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { TrendChart } from './components/TrendChart'
import { ProductPnlTable } from './components/ProductPnlTable'
import { ContributionFloor } from './components/ContributionFloor'
import { UncostedFixList } from './components/UncostedFixList'
import { buildOverviewQuery } from './api'

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
 * Product detail (P4, §2.6 + §4.2): parent P&L with basis labels, variant P&L
 * rows (parent = Σ variants), performance trend, return-rate incidence
 * labelling, inventory relation (movement class, DOI, stock + link), catalog
 * link, and the product-scoped uncosted fix-list drilling to orders.
 */
export default function ProductAnalyticsDetail() {
  const { id } = useParams({ from: '/_authenticated/op/analytics/products/$id' })
  const [filters, setFilters] = useState<ProductAnalyticsFilters>(DEFAULT_FILTERS)
  const { data, isLoading, error, refetch } = useAnalyticsProductDetail(id, filters)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{data ? data.data.product.name : 'Product'}</h1>
          <p className="text-xs text-muted-foreground">Parent P&L with variant drill-down — delivery-recognised orders only.</p>
        </div>
        {data ? (
          <div className="flex gap-2">
            <a href="/op/inventory" title="Inventory relation: movement class, days of inventory and stock below">
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
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Net Sales (direct)" kpi={data.data.parent.netSales} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Contribution" kpi={data.data.parent.contribution} formulaVersion={data.meta.formulaVersion} />
              <KpiCard
                title="Contribution Margin"
                kpi={{
                  value: data.data.parent.contributionMargin,
                  state: data.data.parent.contributionMargin === null ? 'no_data' : 'ok',
                  reason: 'Contribution ÷ Net Sales — the product bottom line',
                  dateBasis: 'Delivered transition',
                }}
                format={(v) => formatPct(v)}
                formulaVersion={data.meta.formulaVersion}
              />
              <KpiCard
                title="Return Rate (incidence)"
                kpi={{ ...data.data.parent.returnRate, reason: RETURN_INCIDENCE_LABEL }}
                format={(v) => formatPct(v)}
                formulaVersion={data.meta.formulaVersion}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Stock on hand</p>
                  <p className="text-2xl font-bold">{data.data.product.stock.toLocaleString('en-US')}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Movement class (default 30/90-day policy)</p>
                  <p className="text-2xl font-bold">{data.data.product.movementClass}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Days of inventory</p>
                  <p className="text-2xl font-bold">{data.data.product.doi === null ? 'N/A' : data.data.product.doi.toFixed(1)}</p>
                </CardContent>
              </Card>
            </div>

            <ProductPnlTable
              title="Variant P&L — parent = Σ variants (simple products show one implicit child)"
              rows={data.data.variants}
              showVariant
              detailHref={(r) => productVariantOrdersHref(filters, r)}
            />

            <TrendChart points={data.data.trend.points} granularity={data.data.trend.granularity} requestedGranularity={data.data.trend.requestedGranularity} />

            <UncostedFixList
              uncosted={{
                rows: data.data.uncosted.rows.map((r) => ({ ...r, productName: data.data.product.name, variantLabel: r.variantId ?? 'Simple product' })),
                totals: { units: data.data.uncosted.units, lines: data.data.uncosted.lines },
              }}
            />

            <p className="text-[11px] text-muted-foreground">
              Formula {data.meta.formulaVersion} · Data as of {data.meta.dataAsOf} · {data.meta.dateBasis} · Recognised orders:{' '}
              {data.data.parent.recognisedOrders} · Return orders: {data.data.parent.returnOrders} · Uncosted:{' '}
              {data.data.uncosted.units} unit(s)
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
