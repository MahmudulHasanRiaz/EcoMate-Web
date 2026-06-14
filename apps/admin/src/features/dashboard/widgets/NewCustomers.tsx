'use client'

import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatDate } from '../utils'
import type { WidgetProps } from '../types'

export function NewCustomers({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-new-customers', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getNewCustomers(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const customers = data?.data || []

  return (
    <WidgetShell title="New Customers" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {customers.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <UserPlus className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No new customers</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {customers.map(c => (
            <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div>
                <p className="text-sm font-medium">{c.firstName} {c.lastName}</p>
                <p className="text-xs text-muted-foreground">{c.email}</p>
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
