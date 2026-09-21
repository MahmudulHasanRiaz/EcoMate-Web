'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useAnalyticsProducts, useUncostedProducts } from './hooks'
import { DEFAULT_FILTERS, formatBDT, type ProductAnalyticsFilters } from './types'
import { buildProductsQuery } from './api'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { ProductPnlTable } from './components/ProductPnlTable'
import { ContributionFloor } from './components/ContributionFloor'
import { UncostedFixList } from './components/UncostedFixList'

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
    return `/op/analytics/products/${row.productId}${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Product Analytics</h1>
          <p className="text-xs text-muted-foreground">Delivery-recognised orders only — Delivered is the recognition event.</p>
        </div>
        {data && data.data.uncosted.lines > 0 ? (
          <button onClick={() => setShowUncosted((v) => !v)} title="Lines without costSnapshot — COGS is never back-filled from standardCost">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              Uncosted: {data.data.uncosted.lines} line(s) missing
            </Badge>
          </button>
        ) : null}
      </div>

      <ContributionFloor />

      <AnalyticsFilterBar value={filters} onChange={(n) => setFilters((f) => ({ ...f, ...n }))} />

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search products…"
          className="max-w-xs"
          value={filters.search ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
        />
        <Select value={filters.sort ?? 'netSales'} onValueChange={(v) => setFilters((f) => ({ ...f, sort: v as ProductAnalyticsFilters['sort'] }))}>
          <SelectTrigger className="w-[180px]">
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
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Desc</SelectItem>
            <SelectItem value="asc">Asc</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <WidgetShell
        title="Products"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Net Sales (Σ products)</p>
                  <p className="text-2xl font-bold">{formatBDT(data.data.totals.netSales)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Contribution (Σ products)</p>
                  <p className="text-2xl font-bold">{formatBDT(data.data.totals.contribution)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Units recognised</p>
                  <p className="text-2xl font-bold">{data.data.totals.units.toLocaleString('en-US')}</p>
                </CardContent>
              </Card>
            </div>

            <ProductPnlTable title="Product P&L — parent rows (parent = Σ variants)" rows={data.data.rows} detailHref={detailHref} />

            {showUncosted ? (
              uncosted.data ? (
                <UncostedFixList uncosted={uncosted.data.data} />
              ) : (
                <Skeleton className="h-[200px] w-full rounded-lg" />
              )
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              Formula {data.meta.formulaVersion} · Data as of {data.meta.dataAsOf} · {data.meta.dateBasis} · Ladder state:{' '}
              {data.meta.ladderState} · Period {data.meta.range.periodDays} day(s)
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
