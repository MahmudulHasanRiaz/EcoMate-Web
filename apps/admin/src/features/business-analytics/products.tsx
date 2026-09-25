'use client'

import { useState } from 'react'
import { Package } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { riseStyle } from '@/components/ui/dashboard'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useAnalyticsProducts, useUncostedProducts } from './hooks'
import { DEFAULT_FILTERS, type ProductAnalyticsFilters, type ProductsData } from './types'
import { buildProductsQuery } from './api'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { AnalyticsPageHeader, MetricMetaFooter } from './components/analytics-ui'
import { KpiCard } from './components/KpiCard'
import { ProductPnlTable } from './components/ProductPnlTable'
import { ContributionFloor } from './components/ContributionFloor'
import { UncostedFixList } from './components/UncostedFixList'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')

/**
 * Σ-product totals as KpiCards — the unified idiom, carrying the backend
 * formula version in every card disclosure (W2 restores info/formulaVersion).
 */
export function ProductTotalsBand({
  totals,
  formulaVersion,
}: {
  totals: ProductsData['totals']
  formulaVersion: string
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)} data-testid="product-totals">
      <KpiCard
        title="Net Sales (Σ products)"
        kpi={{ value: totals.netSales, state: 'ok', reason: 'Σ over product rows — delivery-recognised', dateBasis: 'Delivered transition' }}
        formulaVersion={formulaVersion}
        animate={false}
      />
      <KpiCard
        title="Contribution (Σ products)"
        kpi={{ value: totals.contribution, state: 'ok', reason: 'Σ over product rows — the product bottom line', dateBasis: 'Delivered transition' }}
        formulaVersion={formulaVersion}
        animate={false}
      />
      <KpiCard
        title="Units recognised"
        kpi={{ value: totals.units, state: 'ok', reason: 'Σ recognised units over product rows', dateBasis: 'Delivered transition' }}
        format={COUNT_FORMAT}
        formulaVersion={formulaVersion}
        animate={false}
      />
    </div>
  )
}

/**
 * Product Analytics list (P4, §2.6): parent P&L rows with direct / allocated /
 * attributed basis labels, Contribution floor stated verbatim, low-margin
 * drill-down to product detail (§4.2), and the uncosted-products fix-list
 * behind the coverage badge.
 */
export default function ProductAnalytics() {
  const [filters, setFilters] = useState<ProductAnalyticsFilters>({ ...DEFAULT_FILTERS, sort: 'netSales', dir: 'desc' })
  const [showUncosted, setShowUncosted] = useState(false)
  const { data, isLoading, error, refetch } = useAnalyticsProducts(filters)
  const uncosted = useUncostedProducts(filters)

  const detailHref = (row: { productId: string }) => {
    const qs = new URLSearchParams(buildProductsQuery(filters)).toString()
    return `/mon/analytics/products/${row.productId}${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <AnalyticsPageHeader
          icon={Package}
          title="Product Analytics"
          subtitle="Delivery-recognised orders only — Delivered is the recognition event."
          tileClassName="bg-success-soft text-success border-success/25"
        />
        {data && data.data.uncosted.lines > 0 ? (
          <button onClick={() => setShowUncosted((v) => !v)} title="Lines without costSnapshot — COGS is never back-filled from standardCost" className="tap-h cursor-pointer rounded-lg">
            <Badge variant="warning">
              Uncosted: {data.data.uncosted.lines} line(s) missing
            </Badge>
          </button>
        ) : null}
      </div>

      <ContributionFloor />

      <AnalyticsFilterBar value={filters} onChange={(n) => setFilters((f) => ({ ...f, ...n }))} />

      <WidgetShell
        title="Products"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <ProductTotalsBand totals={data.data.totals} formulaVersion={data.meta.formulaVersion} />

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" data-testid="product-table-controls">
                <Input
                  placeholder="Search products…"
                  aria-label="Search products"
                  className="max-w-xs"
                  value={filters.search ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
                />
                <Select value={filters.sort ?? 'netSales'} onValueChange={(v) => setFilters((f) => ({ ...f, sort: v as ProductAnalyticsFilters['sort'] }))}>
                  <SelectTrigger className="w-[180px] tap-h" aria-label="Sort products by">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="netSales">Net Sales</SelectItem>
                    <SelectItem value="units">Units</SelectItem>
                    <SelectItem value="contribution">Contribution</SelectItem>
                    <SelectItem value="margin">Margin</SelectItem>
                    <SelectItem value="returnRate">Return Rate</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.dir ?? 'desc'} onValueChange={(v) => setFilters((f) => ({ ...f, dir: v as 'asc' | 'desc' }))}>
                  <SelectTrigger className="w-[120px] tap-h" aria-label="Sort direction">
                    <SelectValue placeholder="Direction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Desc</SelectItem>
                    <SelectItem value="asc">Asc</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <ProductPnlTable title="Product P&L — parent rows (parent = Σ variants)" rows={data.data.rows} detailHref={detailHref} />
            </div>

            {showUncosted ? (
              uncosted.data ? (
                <UncostedFixList uncosted={uncosted.data.data} />
              ) : (
                <Skeleton className="h-[200px] w-full rounded-lg" />
              )
            ) : null}

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
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        )}
      </WidgetShell>
    </div>
  )
}
