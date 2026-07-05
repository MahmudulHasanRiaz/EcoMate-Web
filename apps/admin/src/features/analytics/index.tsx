'use client'

import { useDateFilter } from '../dashboard/use-date-filter'
import { SalesKpiCards } from './components/SalesKpiCards'
import { RevenueTrendChart } from './components/RevenueTrendChart'
import { MarketingKpiWidget } from './components/MarketingKpiWidget'
import { TrafficSourcesChart } from './components/TrafficSourcesChart'
import { OrderStatusPieChart } from './components/OrderStatusPieChart'
import { PaymentMethodPieChart } from './components/PaymentMethodPieChart'
import { TopProductsTable } from './components/TopProductsTable'

export default function AnalyticsPage() {
  const { preset, dateRange, setPreset, setCustomRange, formatParam } = useDateFilter()

  const range = {
    startDate: formatParam(dateRange.start),
    endDate: formatParam(dateRange.end),
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div className="flex items-center gap-2">
          {['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'].map(p => (
            <button
              key={p}
              onClick={() => setPreset(p as any)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                preset === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      <SalesKpiCards dateRange={range} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueTrendChart dateRange={range} />
        <MarketingKpiWidget dateRange={range} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrafficSourcesChart dateRange={range} />
        <PaymentMethodPieChart dateRange={range} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrderStatusPieChart dateRange={range} />
        <TopProductsTable dateRange={range} />
      </div>
    </div>
  )
}
