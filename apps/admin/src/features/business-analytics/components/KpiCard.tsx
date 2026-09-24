import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CountUp, kpiAccentForTitle, kpiIconForTitle } from '@/components/ui/dashboard'
import { cn } from '@/lib/utils'
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
  const accent = kpiAccentForTitle(title)
  const Icon = kpiIconForTitle(title)
  const meta = [kpi.dateBasis ? `Date basis: ${kpi.dateBasis}` : null, formulaVersion ? `Formula: ${formulaVersion}` : null]
    .filter(Boolean)
    .join(' · ')

  const body = (() => {
    switch (kpi.state) {
      case 'ok':
        return (
          <p className="kpi-value">
            <CountUp value={kpi.value as number} format={fmt} />
          </p>
        )
      case 'zero':
        return (
          <>
            <p className="kpi-value">
              <CountUp value={0} format={fmt} />
            </p>
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
      case 'no_data':
        return (
          <>
            <p className="kpi-value text-muted-foreground">No data</p>
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
      case 'not_applicable':
        return (
          <>
            <p className="kpi-value text-muted-foreground/60">—</p>
            {kpi.reason ? <p className="text-xs text-muted-foreground mt-1">{kpi.reason}</p> : null}
          </>
        )
      case 'unavailable':
        return <MetricUnavailable reason={kpi.reason} />
      case 'estimated':
        return (
          <>
            <div className="flex items-center gap-2">
              <p className="kpi-value">
                <CountUp value={kpi.value as number} format={fmt} />
              </p>
              <Badge variant="warning">Estimated</Badge>
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
    <Card className={cn('kpi-card', `kpi-accent-${accent}`)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="kpi-icon-badge shrink-0" aria-hidden>
            <Icon className="h-4 w-4" />
          </span>
          <CardTitle className="text-sm font-medium truncate">{title}</CardTitle>
        </div>
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
      <a href={drilldownHref} className="block transition-all duration-200 hover:-translate-y-0.5 hover:opacity-95">
        {card}
      </a>
    )
  }
  return card
}
