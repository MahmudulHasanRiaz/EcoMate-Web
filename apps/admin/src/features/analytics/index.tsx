'use client'

import { BarChart3 } from 'lucide-react'
import { useDateFilter } from '../dashboard/use-date-filter'
import { riseStyle } from '@/components/ui/dashboard'
import { SalesKpiCards } from './components/SalesKpiCards'
import { RevenueTrendChart } from './components/RevenueTrendChart'
import { MarketingKpiWidget } from './components/MarketingKpiWidget'
import { TrafficSourcesChart } from './components/TrafficSourcesChart'
import { OrderStatusPieChart } from './components/OrderStatusPieChart'
import { PaymentMethodPieChart } from './components/PaymentMethodPieChart'
import { TopProductsTable } from './components/TopProductsTable'
import { useLicenseStore } from '../../stores/license-store'

const WIDGET_FEATURES = {
  SalesKpiCards: 'admin_analytics',
  RevenueTrendChart: 'admin_analytics',
  MarketingKpiWidget: 'integration_ga4',
  TrafficSourcesChart: 'integration_ga4',
  OrderStatusPieChart: 'admin_orders',
  PaymentMethodPieChart: 'admin_payments',
  TopProductsTable: 'admin_products',
} as const

export default function AnalyticsPage() {
  const { preset, dateRange, setPreset, setCustomRange, formatParam } = useDateFilter()
  const hasFeature = useLicenseStore((s) => s.hasFeature)

  const range = {
    startDate: formatParam(dateRange.start),
    endDate: formatParam(dateRange.end),
  }

  const showAnalytics = hasFeature('admin_analytics')
  const showGa4 = hasFeature('integration_ga4')
  const showOrders = hasFeature('admin_orders')
  const showPayments = hasFeature('admin_payments')
  const showProducts = hasFeature('admin_products')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <BarChart3 className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold">Analytics</h1>
        </div>
        <div className="flex items-center gap-2">
          {['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'].map(p => (
            <button
              key={p}
              onClick={() => setPreset(p as any)}
              className={`px-3 py-1.5 min-h-10 text-xs rounded-xl font-medium transition-all duration-200 ${
                preset === p ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      {showAnalytics && <SalesKpiCards dateRange={range} />}

      {(showAnalytics || showGa4) && (
        <div className={`grid grid-cols-1 gap-6 animate-rise ${showAnalytics && showGa4 ? 'lg:grid-cols-2' : ''}`} style={riseStyle(1)}>
          {showAnalytics && <RevenueTrendChart dateRange={range} />}
          {showGa4 && <MarketingKpiWidget dateRange={range} />}
        </div>
      )}

      {(showGa4 || showPayments) && (
        <div className={`grid grid-cols-1 gap-6 animate-rise ${showGa4 && showPayments ? 'lg:grid-cols-2' : ''}`} style={riseStyle(2)}>
          {showGa4 && <TrafficSourcesChart dateRange={range} />}
          {showPayments && <PaymentMethodPieChart dateRange={range} />}
        </div>
      )}

      {(showOrders || showProducts) && (
        <div className={`grid grid-cols-1 gap-6 animate-rise ${showOrders && showProducts ? 'lg:grid-cols-2' : ''}`} style={riseStyle(3)}>
          {showOrders && <OrderStatusPieChart dateRange={range} />}
          {showProducts && <TopProductsTable dateRange={range} />}
        </div>
      )}
    </div>
  )
}
