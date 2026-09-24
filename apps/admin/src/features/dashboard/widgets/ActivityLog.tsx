'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { StatusBadge, orderStatusTone } from '@/components/ui/dashboard'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { timeAgo } from '../utils'
import type { WidgetProps } from '../types'

export function ActivityLog(_props: WidgetProps) {
  // NOTE: ActivityLog is a current-state "recent activity" snapshot, not a
  // period-filtered metric. It always shows the 20 most-recently-updated
  // orders regardless of the date filter — this is intentional: operators
  // need to see the latest activity even outside the selected range.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => dashboardApi.getActivityLog(),
    refetchInterval: 30_000,
  })

  const activities = data?.data || []

  return (
    <WidgetShell
      title="Activity Log"
      description="Live updates on order processing"
      isLoading={isLoading}
      error={error ?? undefined}
      onRetry={() => refetch()}
      icon={<Activity className="h-4 w-4" />}
      iconTone="violet"
    >
      {activities.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground font-medium">No recent activity</p>
        </div>
      ) : (
        <div className="relative pl-3 space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[1.5px] before:bg-border/60 max-h-[260px] overflow-y-auto pr-1">
          {activities.map(a => {
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
                    <StatusBadge tone={orderStatusTone(a.status)} className="text-[8px] px-1 capitalize">
                      {a.status}
                    </StatusBadge>
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
