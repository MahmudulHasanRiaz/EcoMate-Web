import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DashboardSummary } from '../types'

interface SummaryCardsProps {
  data: DashboardSummary | undefined
  isLoading: boolean
}

const cards = [
  {
    key: 'events1h',
    label: 'Events (1h)',
    color: 'text-info',
    bg: 'bg-info-soft',
    border: 'border-info/25',
    get: (d: DashboardSummary) => d.totalEvents1h.toLocaleString(),
  },
  {
    key: 'events24h',
    label: 'Events (24h)',
    color: 'text-accent-violet',
    bg: 'bg-accent-violet-soft',
    border: 'border-accent-violet/25',
    get: (d: DashboardSummary) => d.totalEvents24h.toLocaleString(),
  },
  {
    key: 'critical',
    label: 'Critical (24h)',
    color: 'text-danger',
    bg: 'bg-danger-soft',
    border: 'border-danger/25',
    get: (d: DashboardSummary) => d.criticalEvents24h.toLocaleString(),
  },
  {
    key: 'autoBlocks',
    label: 'Auto-Blocks (24h)',
    color: 'text-warning',
    bg: 'bg-warning-soft',
    border: 'border-warning/25',
    get: (d: DashboardSummary) => d.autoBlocks24h.toLocaleString(),
  },
  {
    key: 'activeBlocks',
    label: 'Active Blocks',
    color: 'text-danger',
    bg: 'bg-danger-soft',
    border: 'border-danger/25',
    get: (d: DashboardSummary) => d.activeBlocks.toLocaleString(),
  },
  {
    key: 'topEvent',
    label: 'Top Event Type',
    color: 'text-success',
    bg: 'bg-success-soft',
    border: 'border-success/25',
    get: (d: DashboardSummary) => d.topEventType?.eventType ?? '—',
  },
] as const

export function SummaryCards({ data, isLoading }: SummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.key} className="chart-card rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-8 w-20 skeleton-shimmer rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.key} className={`chart-card rounded-2xl border ${c.border}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`kpi-value inline-block max-w-full break-all rounded-lg px-2 py-0.5 ${c.bg} ${c.color}`}>{c.get(data)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
