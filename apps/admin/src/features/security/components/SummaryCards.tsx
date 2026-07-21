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
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    get: (d: DashboardSummary) => d.totalEvents1h.toLocaleString(),
  },
  {
    key: 'events24h',
    label: 'Events (24h)',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    get: (d: DashboardSummary) => d.totalEvents24h.toLocaleString(),
  },
  {
    key: 'critical',
    label: 'Critical (24h)',
    color: 'text-red-600',
    bg: 'bg-red-50',
    get: (d: DashboardSummary) => d.criticalEvents24h.toLocaleString(),
  },
  {
    key: 'autoBlocks',
    label: 'Auto-Blocks (24h)',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    get: (d: DashboardSummary) => d.autoBlocks24h.toLocaleString(),
  },
  {
    key: 'activeBlocks',
    label: 'Active Blocks',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    get: (d: DashboardSummary) => d.activeBlocks.toLocaleString(),
  },
  {
    key: 'topEvent',
    label: 'Top Event Type',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    get: (d: DashboardSummary) => d.topEventType?.eventType ?? '—',
  },
] as const

export function SummaryCards({ data, isLoading }: SummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-8 w-20 animate-pulse rounded bg-muted" />
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
        <Card key={c.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${c.color}`}>{c.get(data)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
