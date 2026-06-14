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

  return (
    <WidgetShell title="Activity" description="Recent order updates" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {activities.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No recent activity</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {activities.map(a => (
            <div key={a.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{a.displayId}</p>
                <p className="text-xs text-muted-foreground truncate">{a.customerName || (a.customer ? `${a.customer.firstName} ${a.customer.lastName}` : '')}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className="text-xs">{typeof a.status === 'string' ? a.status : a.status?.name}</Badge>
                <span className="text-xs text-muted-foreground">{timeAgo(a.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
