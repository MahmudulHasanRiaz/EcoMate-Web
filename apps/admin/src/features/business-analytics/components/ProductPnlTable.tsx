'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, formatPct, RETURN_INCIDENCE_LABEL, type KpiValue, type ProductPnlRow, type ProductVariantRow } from '../types'
import { MetricUnavailable } from './badges'
import { BasisBadge } from './ProductBasisBadge'

/** Compact KpiValue cell — same empty-vs-zero contract as KpiCard (§6). */
export function PnlCell({ kpi, format }: { kpi: KpiValue; format?: (v: number) => string }) {
  const fmt = format ?? formatBDT
  switch (kpi.state) {
    case 'ok':
    case 'estimated':
      return (
        <span className="tabular-nums">
          {fmt(kpi.value as number)}
          {kpi.state === 'estimated' ? (
            <Badge variant="warning" className="ml-1">
              Estimated
            </Badge>
          ) : null}
        </span>
      )
    case 'zero':
      return <span className="tabular-nums">{fmt(0)}</span>
    case 'no_data':
      return <span className="text-muted-foreground">No data</span>
    case 'not_applicable':
      return <span className="text-muted-foreground/60">—</span>
    case 'unavailable':
      return <MetricUnavailable reason={kpi.reason} compact />
  }
}

type Row = ProductPnlRow | ProductVariantRow

function isVariantRow(r: Row): r is ProductVariantRow {
  return 'variantId' in r
}

/**
 * Product / variant P&L rows (§2.6): every column header carries its basis —
 * direct (own lines, combos expanded) · attributed (marketing) · allocated
 * (fulfillment, fees). Contribution is the bottom line (floor stated above
 * the table). Return rate is order-level incidence, labelled. Low-margin rows
 * drill to the product detail (§4.2).
 */
export function ProductPnlTable({
  title,
  rows,
  detailHref,
  showVariant,
}: {
  title: string
  rows: Row[]
  /** Drill-down href per row (§4.2 product rows). */
  detailHref: (row: Row) => string
  showVariant?: boolean
}) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <p className="text-[11px] text-muted-foreground" data-testid="pnl-basis-legend">
          How each number is worked out — <BasisBadge basis="direct" /> Sales and cost lines ·{' '}
          <BasisBadge basis="attributed" /> Marketing · <BasisBadge basis="allocated" /> Delivery and gateway fees
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">No data</div>
        ) : (
          <Table className="dash-table">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card z-10">{showVariant ? 'Variant' : 'Product'}</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Discounts</TableHead>
                <TableHead className="text-right">Returns</TableHead>
                <TableHead className="text-right">Net Sales</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Marketing</TableHead>
                <TableHead className="text-right">Fulfillment</TableHead>
                <TableHead className="text-right">Gateway Fees</TableHead>
                <TableHead className="text-right">Contribution</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right" title={RETURN_INCIDENCE_LABEL}>
                  Return Rate <span className="font-normal text-muted-foreground">(incidence)</span>
                </TableHead>
                <TableHead className="text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={showVariant && isVariantRow(r) ? `${r.productId}::${r.variantId ?? ''}` : r.productId}>
                  <TableCell className="text-sm sticky left-0 bg-card z-10">
                    <a href={detailHref(r)} className="font-medium text-foreground hover:underline">
                      {showVariant && isVariantRow(r) ? r.variantLabel : r.name}
                    </a>
                    {r.lowMargin ? (
                      <a href={detailHref(r)} title="Profit margin below 10%. Open the product to see why.">
                        <Badge variant="warning" className="ml-2">
                          Low margin
                        </Badge>
                      </a>
                    ) : null}
                    {r.uncostedLines > 0 ? (
                      <span className="block text-[11px] text-muted-foreground" title="Lines with no saved cost. See the fix-list below.">
                        {r.uncostedUnits} uncosted unit(s)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.gross} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.discounts} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.returns} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.netSales} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.units} format={(v) => String(v)} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.cogs} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.marketing} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.fulfillment} /></TableCell>
                  <TableCell className="text-sm text-right"><PnlCell kpi={r.fees} /></TableCell>
                  <TableCell className="text-sm text-right font-medium"><PnlCell kpi={r.contribution} /></TableCell>
                  <TableCell className="text-sm text-right">{formatPct(r.contributionMargin)}</TableCell>
                  <TableCell className="text-sm text-right" title={r.returnRate.reason ?? RETURN_INCIDENCE_LABEL}>
                    {r.returnRate.value === null ? (
                      <span className="text-muted-foreground">N/A</span>
                    ) : (
                      formatPct(r.returnRate.value)
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.recognisedOrders}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
