import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CountUp, kpiAccentForTitle, kpiIconForTitle } from '@/components/ui/dashboard'
import { cn } from '@/lib/utils'
import { formatBDT, type KpiValue } from '../types'
import { MetricUnavailable } from './badges'
import { InfoDisclosure } from './analytics-ui'
import { plainDateBasis, plainFormulaLabel, plainReason, plainReference } from './info-copy'

interface KpiCardProps {
  title: string
  kpi: KpiValue
  /** Value formatter for ok/zero/estimated states. Defaults to ৳. */
  format?: (v: number) => string
  formulaVersion?: string
  drilldownHref?: string
  /**
   * Disable the per-card CountUp animation. Pages pass band-level motion
   * instead (a single staggered rise) so N cards never animate simultaneously.
   * Defaults to true.
   */
  animate?: boolean
}

/**
 * [small icon] name [info] / dominant value / compact state.
 *
 * Reason + dateBasis + formula + estimatedReference live in the info
 * interaction (tap-friendly tooltip ≤2 lines, else popover) plus an sr-only
 * audit span — never a visible caption. Every number traceable to backend
 * meta (§6 auditability): null never renders ৳0; not_applicable "—" is
 * visually distinct from unavailable; estimated shows a badge.
 */
export function KpiCard({ title, kpi, format, formulaVersion, drilldownHref, animate = true }: KpiCardProps) {
  const fmt = format ?? formatBDT
  const accent = kpiAccentForTitle(title)
  const Icon = kpiIconForTitle(title)
  const value = (v: number) =>
    animate ? <CountUp value={v} format={fmt} /> : <span className="tabular-nums">{fmt(v)}</span>
  // Unavailable renders its reason inline (MetricUnavailable) — keep it out
  // of the disclosure so screen readers don't hear it twice.
  const infoLines = [
    kpi.state === 'unavailable' ? null : plainReason(kpi.reason),
    plainDateBasis(kpi.dateBasis),
    plainFormulaLabel(formulaVersion),
    kpi.estimatedReference ? plainReference(kpi.estimatedReference.label) : null,
  ]
  const infoText = infoLines.filter(Boolean).join(' · ')

  const body = (() => {
    switch (kpi.state) {
      case 'ok':
        return (
          <p className="kpi-value">
            {value(kpi.value as number)}
          </p>
        )
      case 'zero':
        return (
          <p className="kpi-value">
            {value(0)}
          </p>
        )
      case 'no_data':
        return <p className="kpi-value text-muted-foreground">No data</p>
      case 'not_applicable':
        return <p className="kpi-value text-muted-foreground/60">—</p>
      case 'unavailable':
        return <MetricUnavailable reason={kpi.reason} />
      case 'estimated':
        return (
          <div className="flex items-center gap-2">
            <p className="kpi-value">
              {value(kpi.value as number)}
            </p>
            <Badge variant="warning">Estimated</Badge>
          </div>
        )
    }
  })()

  // drilldownHref wraps the VALUE area only — the InfoDisclosure button stays
  // a sibling of the anchor, never nested inside it (button-in-link is an
  // invalid nested interactive). The Card keeps the hover lift as the affordance.
  const valueNode = drilldownHref ? (
    <a
      href={drilldownHref}
      aria-label={`Drill down into ${title}`}
      className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {body}
    </a>
  ) : (
    body
  )

  return (
    <Card className={cn('kpi-card', `kpi-accent-${accent}`, drilldownHref && 'transition-all duration-200 hover:-translate-y-0.5 hover:opacity-95')}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="kpi-icon-badge shrink-0" aria-hidden>
            <Icon className="h-4 w-4" />
          </span>
          <CardTitle className="line-clamp-2 text-sm font-medium leading-snug">{title}</CardTitle>
        </div>
        <InfoDisclosure label={`About ${title}`} lines={infoLines} contentTestId="kpi-meta-detail" />
      </CardHeader>
      <CardContent>
        {valueNode}
        {infoText ? (
          <span className="sr-only" data-testid="kpi-meta-sr">
            {infoText}
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}
