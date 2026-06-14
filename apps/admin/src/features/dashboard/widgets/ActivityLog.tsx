'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { timeAgo } from '../utils'
import type { WidgetProps } from '../types'

export function ActivityLog(_props: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => dashboardApi.getActivityLog(),
    refetchInterval: 30_000,
  })

  const activities = data?.data || []

  const getStatusBadgeStyle = (statusName: string) => {
    const normalized = statusName.toLowerCase()
    if (normalized.includes('pending') || normalized.includes('awaiting')) {
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    }
    if (normalized.includes('delivered') || normalized === 'paid') {
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    }
    if (normalized.includes('refund') || normalized.includes('cancelled') || normalized.includes('fail') || normalized.includes('damage') || normalized === 'returned') {
      return 'bg-rose-500/10 text-rose-600 border-rose-500/20'
    }
    if (normalized.includes('process')) {
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    }
    if (normalized.includes('confirm')) {
      return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20'
    }
    return 'bg-muted text-muted-foreground border-border'
  }

  return (
    <WidgetShell
      title="Activity Log"
      description="Live updates on order processing"
      isLoading={isLoading}
      error={error ?? undefined}
      onRetry={() => refetch()}
    >
      {activities.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground font-medium">No recent activity</p>
        </div>
      ) : (
        <div className="relative pl-3 space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[1.5px] before:bg-border/60 max-h-[260px] overflow-y-auto pr-1">
          {activities.map(a => {
            const badgeStyle = getStatusBadgeStyle(a.status)
            return (
              <div key={a.id} className="relative flex gap-3.5 items-start text-left">
                {/* Timeline Dot */}
                <div className="absolute -left-[10.5px] top-1 h-[7px] w-[7px] rounded-full bg-background border-[1.5px] border-primary z-10" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 leading-none">
                    <span className="text-xs font-bold text-foreground font-mono truncate">{a.displayId}</span>
                    <span className="text-[9px] text-muted-foreground whitespace-nowrap">{timeAgo(a.updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 gap-2 leading-none">
                    <p className="text-[10px] text-muted-foreground truncate">
                      {a.customerName}
                    </p>
                    <Badge variant="outline" className={`text-[8px] h-3.5 px-1 font-bold border capitalize leading-none ${badgeStyle}`}>
                      {a.status}
                    </Badge>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}
