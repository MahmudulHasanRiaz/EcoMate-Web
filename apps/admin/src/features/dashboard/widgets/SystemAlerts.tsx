'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CreditCard, RotateCcw, AlertTriangle, ShieldCheck, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'
import { formatCurrency } from '../utils'
import type { WidgetProps } from '../types'

export function SystemAlerts(_props: WidgetProps) {
  const { data: imEnabled = true } = useInventoryManagement()
  const { data: paymentsRes, isLoading: paymentsLoading } = useQuery({
    queryKey: ['dashboard-pending-payments-alerts'],
    queryFn: () => dashboardApi.getPendingPayments(),
    refetchInterval: 30_000,
  })

  const { data: refundsRes, isLoading: refundsLoading } = useQuery({
    queryKey: ['dashboard-pending-refunds-alerts'],
    queryFn: () => dashboardApi.getPendingRefunds(),
    refetchInterval: 30_000,
  })

  const { data: stockRes, isLoading: stockLoading } = useQuery({
    queryKey: ['dashboard-low-stock-alerts'],
    queryFn: () => dashboardApi.getLowStockProducts(),
    refetchInterval: 60_000,
  })

  const isLoading = paymentsLoading || refundsLoading || stockLoading

  const pendingPayments = paymentsRes?.data || []
  const pendingRefunds = refundsRes?.data || []
  const lowStockCount = stockRes?.data?.count || 0

  // Build the list of alerts
  const alerts: Array<{
    id: string
    type: 'payment' | 'refund' | 'inventory'
    title: string
    description: string
    severity: 'critical' | 'warning'
    link: string
  }> = []

  // 1. Refund Requests (Critical)
  pendingRefunds.forEach((ref) => {
    alerts.push({
      id: `refund-${ref.id}`,
      type: 'refund',
      title: 'Refund Request Pending',
      description: `Order #${ref.order?.displayId || '—'} requires refund of ${formatCurrency(ref.amount)}`,
      severity: 'critical',
      link: '/op/refunds',
    })
  })

  // 2. Payment Issues (Warning)
  pendingPayments.forEach((pay) => {
    alerts.push({
      id: `payment-${pay.id}`,
      type: 'payment',
      title: 'Payment Pending Check',
      description: `Order #${pay.order?.displayId || '—'} payment status is PENDING (${formatCurrency(pay.amount)})`,
      severity: 'warning',
      link: '/op/payments',
    })
  })

  // 3. Low Stock Warning (Warning)
  if (lowStockCount > 0) {
    alerts.push({
      id: 'low-stock-summary',
      type: 'inventory',
      title: 'Critical Inventory Warning',
      description: `${lowStockCount} products are below low-stock threshold`,
      severity: 'warning',
      link: '/op/inventory',
    })
  }

  const iconMap = {
    payment: <CreditCard className="h-3.5 w-3.5 text-amber-500" />,
    refund: <RotateCcw className="h-3.5 w-3.5 text-destructive" />,
    inventory: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  }

  return (
    <WidgetShell
      title="System Alerts"
      description="Payment, refund & inventory status"
      isLoading={isLoading}
      error={undefined}
    >
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="h-9 w-9 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          </div>
          <p className="text-xs font-semibold text-foreground">System Healthy</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">All processes operating normally</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {alerts.slice(0, 10).map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-2.5 p-2 rounded-lg border text-left transition-all ${
                alert.severity === 'critical'
                  ? 'bg-destructive/5 border-destructive/15'
                  : 'bg-amber-500/5 border-amber-500/15'
              }`}
            >
              <div className={`p-1.5 rounded-md mt-0.5 ${
                alert.severity === 'critical' ? 'bg-destructive/10' : 'bg-amber-500/10'
              }`}>
                {iconMap[alert.type]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-foreground leading-none">{alert.title}</span>
                  <Badge
                    variant={alert.severity === 'critical' ? 'destructive' : 'outline'}
                    className={`h-4 px-1 text-[9px] font-bold uppercase tracking-wider ${
                      alert.severity === 'warning' ? 'text-amber-600 bg-amber-500/10 border-amber-500/20' : ''
                    }`}
                  >
                    {alert.severity}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-normal">{alert.description}</p>
                <Link to={alert.link as any} className="inline-block mt-1.5">
                  <Button variant="link" className="p-0 h-auto text-[10px] font-bold text-primary flex items-center gap-0.5">
                    Resolve Alert <ChevronRight className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  )
}
