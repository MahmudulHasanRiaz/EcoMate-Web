'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Package } from 'lucide-react'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function LowStockAlert(_props: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const items = data?.data || []

  return (
    <WidgetShell title="Low Stock" description="Products running out" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Package className="h-8 w-8 text-emerald-500 mb-2" />
          <p className="text-sm text-muted-foreground">All products well stocked</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.sku}</p>
              </div>
              <span className={`text-xs font-medium ${item.stock === 0 ? 'text-destructive flex items-center gap-1' : 'text-amber-600'}`}>
                {item.stock === 0 && <AlertTriangle className="h-3 w-3" />}
                {item.stock}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
