'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CreditCard, RotateCcw, AlertTriangle, ShieldCheck, ChevronRight, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/dashboard'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'
import { formatCurrency } from '../utils'
import type { WidgetProps } from '../types'

export function SystemAlerts(_props: WidgetProps) {
  // NOTE: SystemAlerts is a current-state alert panel, not period-filtered:
  // pending payments, pending refunds, and low stock are all actionable
  // backlogs that must always show the current situation regardless of the
  // date filter. Only period-based metrics (KPIs, pending orders, recent
  // orders) respect the global date range.
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
    payment: <CreditCard className="h-3.5 w-3.5 text-warning" />,
    refund: <RotateCcw className="h-3.5 w-3.5 text-danger" />,
    inventory: <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
  }

  return (
    <WidgetShell
      title="System Alerts"
      description="Payment, refund & inventory status"
      isLoading={isLoading}
      error={undefined}
      icon={<BellRing className="h-4 w-4" />}
      iconTone="warning"
    >
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="h-9 w-9 rounded-full bg-success-soft border border-success/25 flex items-center justify-center mb-2">
            <ShieldCheck className="h-5 w-5 text-success" />
          </div>
          <p className="text-xs font-semibold text-foreground">System Healthy</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">All processes operating normally</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {alerts.slice(0, 10).map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-2.5 p-2 rounded-xl border text-left transition-colors duration-200 ${
                alert.severity === 'critical'
                  ? 'bg-danger-soft border-danger/20'
                  : 'bg-warning-soft border-warning/20'
              }`}
            >
              <div className={`p-1.5 rounded-md mt-0.5 border ${
                alert.severity === 'critical' ? 'bg-danger-soft border-danger/25' : 'bg-warning-soft border-warning/25'
              }`}>
                {iconMap[alert.type]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-foreground leading-none">{alert.title}</span>
                  <StatusBadge
                    tone={alert.severity === 'critical' ? 'danger' : 'warning'}
                    icon={null}
                    className="text-[9px] font-bold uppercase"
                  >
                    {alert.severity}
                  </StatusBadge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-normal">{alert.description}</p>
                <Link to={alert.link as any} className="inline-block mt-1.5">
                  <Button variant="link" className="p-0 h-auto min-h-10 text-[10px] font-bold text-primary inline-flex items-center gap-0.5">
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
