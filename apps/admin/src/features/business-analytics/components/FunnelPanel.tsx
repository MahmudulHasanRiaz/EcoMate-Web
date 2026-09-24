import { Filter } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBDT, formatPct, type SalesFunnelStage } from '../types'

/**
 * Sales funnel (P5, §8.7): supported stages mapped from real statuses carry
 * counts; Add-to-Cart / Checkout-started render "Not instrumented" — never
 * zeros. Outcomes (returned / cancelled) show share-of-booked, not chain
 * conversion.
 */
export function FunnelPanel({ stages }: { stages: SalesFunnelStage[] }) {
  const max = Math.max(1, ...stages.filter((s) => s.instrumented).map((s) => s.orders ?? 0))
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <Filter className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-sm font-medium">Order Funnel</CardTitle>
            <p className="text-[11px] text-muted-foreground">Intake cohort (booked in range) reaching each supported stage.</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {stages.map((s) => (
            <div key={s.key} title={s.dateBasis ?? s.reason} data-testid={`funnel-stage-${s.key}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{s.label}</span>
                {s.instrumented ? (
                  <span className="tabular-nums text-muted-foreground">
                    {s.orders} · {formatBDT(s.value ?? 0)}
                    {s.conversionFromPrev !== null && s.conversionFromPrev !== undefined ? (
                      <span className="ml-2 text-xs">({formatPct(s.conversionFromPrev)} conv.)</span>
                    ) : null}
                  </span>
                ) : (
                  <Badge variant="outline">Not instrumented</Badge>
                )}
              </div>
              {s.instrumented ? (
                <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success/70"
                    style={{ width: `${Math.max(0, Math.min(100, ((s.orders ?? 0) / max) * 100))}%` }}
                  />
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.reason}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
