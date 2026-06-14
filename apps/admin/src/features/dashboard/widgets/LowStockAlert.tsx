'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Package, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'

export function LowStockAlert(_props: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const response = data?.data
  const items = response?.products || []

  return (
    <WidgetShell
      title="Low Stock Alert"
      description="Products below threshold"
      isLoading={isLoading}
      error={error ?? undefined}
      onRetry={() => refetch()}
      action={
        <Link to="/op/inventory">
          <Button variant="ghost" size="sm" className="h-7 text-xs font-semibold px-2 hover:bg-muted text-primary">
            View Inventory
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </Link>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Package className="h-8 w-8 text-emerald-500 mb-2" />
          <p className="text-sm text-muted-foreground font-medium">All products well stocked</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
          {items.map(item => {
            const isCritical = item.stock === 0
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${
                  isCritical
                    ? 'bg-destructive/5 border-destructive/20 hover:bg-destructive/10'
                    : 'bg-muted/30 border-border/50 hover:bg-muted/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate text-foreground">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate font-mono">{item.sku}</p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  {isCritical ? (
                    <Badge variant="destructive" className="h-5 px-1.5 text-[10px] font-bold gap-1 flex items-center uppercase tracking-wider">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Out
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-bold text-amber-600 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/10">
                      {item.stock} left
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}
