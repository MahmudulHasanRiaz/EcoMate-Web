'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, Package, ChevronRight, Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/dashboard'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'
import type { WidgetProps } from '../types'

export function LowStockAlert(_props: WidgetProps) {
  const { data: imEnabled = true } = useInventoryManagement()
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
      icon={<Boxes className="h-4 w-4" />}
      iconTone="violet"
      action={
        <Link to="/op/inventory">
          <Button variant="ghost" size="sm" className="tap-h text-xs font-semibold px-2 hover:bg-muted text-primary">
            View Inventory
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </Link>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <Package className="h-8 w-8 text-success mb-2" />
          <p className="text-sm text-muted-foreground font-medium">All products well stocked</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
          {items.map(item => {
            const isCritical = item.stock === 0
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-2 p-2 rounded-xl border transition-colors duration-200 ${
                  isCritical
                    ? 'bg-danger-soft border-danger/20 hover:bg-danger-soft'
                    : 'bg-muted/30 border-border/50 hover:bg-muted/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate text-foreground">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate font-mono">{item.sku}</p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  {isCritical ? (
                    <StatusBadge tone="danger" icon={AlertTriangle} className="text-[10px] font-bold uppercase">
                      Out
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="warning" icon={null} className="text-[10px] font-bold">
                      {item.stock} left
                    </StatusBadge>
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
