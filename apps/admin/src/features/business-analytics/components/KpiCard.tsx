import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatBDT, type KpiValue } from '../types'
import { MetricUnavailable } from './badges'

interface KpiCardProps {
  title: string
  kpi: KpiValue
  /** Value formatter for ok/zero/estimated states. Defaults to ৳. */
  format?: (v: number) => string
  formulaVersion?: string
  drilldownHref?: string
}

/**
 * Every number traceable to backend meta (§6 auditability): footer carries
 * formulaVersion + dateBasis. Empty-vs-zero (§6): null never renders ৳0;
 * not_applicable "—" is visually distinct from unavailable; estimated shows a
 * badge plus the estimatedReference visually separated and excluded-from-total.
 */
export function KpiCard({ title, kpi, format, formulaVersion, drilldownHref }: KpiCardProps) {
  const fmt = format ?? formatBDT
  const meta = [kpi.dateBasis ? `Date basis: ${kpi.dateBasis}` : null, formulaVersion ? `Formula: ${formulaVersion}` : null]
    .filter(Boolean)
    .join(' · ')

  const body = (() => {
    switch (kpi.state) {
      case 'ok':
        return <p className="text-2xl font-bold">{fmt(kpi.value as number)}</p>
      case 'zero':
        return (
          <>
            <p className="text-2xl font-bold">{fmt(0)}</p>
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
      case 'no_data':
        return (
          <>
            <p className="text-2xl font-bold text-muted-foreground">No data</p>
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
      case 'not_applicable':
        return (
          <>
            <p className="text-2xl font-bold text-muted-foreground/60">—</p>
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
      case 'unavailable':
        return <MetricUnavailable reason={kpi.reason} />
      case 'estimated':
        return (
          <>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold">{fmt(kpi.value as number)}</p>
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                Estimated
              </Badge>
            </div>
            {kpi.estimatedReference ? (
              <p className="text-xs text-muted-foreground mt-1 border-t border-dashed pt-1">
                Reference: {kpi.estimatedReference.label} — excluded from total.
              </p>
            ) : null}
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
    }
  })()

  const card = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {meta ? (
          <span title={meta} aria-label={meta}>
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        {body}
        {kpi.dateBasis ? <p className="text-[11px] text-muted-foreground mt-2">{kpi.dateBasis}</p> : null}
      </CardContent>
    </Card>
  )

  if (drilldownHref) {
    return (
      <a href={drilldownHref} className="block transition-opacity hover:opacity-90">
        {card}
      </a>
    )
  }
  return card
}
