import { Filter } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBDT, formatPct, type SalesFunnelStage } from '../types'
import { HintTooltip } from './analytics-ui'

/**
 * Sales funnel (P5, §8.7): supported stages mapped from real statuses carry
 * counts; Add-to-Cart / Checkout-started render "Not instrumented" — never
 * zeros. Outcomes (returned / cancelled) show share-of-booked, not chain
 * conversion.
 *
 * Bar idiom (W2): neutral progression bars; semantic colour for outcomes
 * only — success for Delivered-positive, danger for returned, warning for
 * cancelled. Colour is never the sole indicator: every bar carries its
 * counts + conversion in words.
 */
function funnelBarClass(key: string): string {
  const k = key.toLowerCase()
  if (k.includes('deliver')) return 'bg-success/70'
  if (k.includes('return')) return 'bg-danger/60'
  if (k.includes('cancel')) return 'bg-warning/60'
  return 'bg-muted-foreground/40'
}
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
          {stages.map((s) => {
            const hint = s.dateBasis ?? s.reason
            return (
            <div key={s.key} data-testid={`funnel-stage-${s.key}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="font-medium min-w-0">{s.label}</span>
                  {hint ? <HintTooltip label={`About ${s.label}`} text={hint} compact /> : null}
                </span>
                {s.instrumented ? (
                  <span className="tabular-nums text-muted-foreground text-right shrink-0">
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
                    className={`h-full rounded-full ${funnelBarClass(s.key)}`}
                    style={{ width: `${Math.max(0, Math.min(100, ((s.orders ?? 0) / max) * 100))}%` }}
                  />
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.reason}</p>
              )}
            </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
