'use client'

import type { WidgetConfig, WidgetProps } from '../types'

interface DashboardGridProps {
  configs: WidgetConfig[]
  widgetProps: Omit<WidgetProps, 'isLoading' | 'error'>
}

export function DashboardGrid({ configs, widgetProps }: DashboardGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
      {configs.map(cfg => {
        const colSpan = cfg.sizes?.xl ?? cfg.defaultSpan
        const spanMap: Record<number, string> = { 2: 'xl:col-span-2', 3: 'xl:col-span-3', 4: 'xl:col-span-4' }
        const spanClass = spanMap[colSpan] || ''
        return (
          <div key={cfg.id} className={`${spanClass} col-span-1`}>
            <cfg.component
              dateRange={widgetProps.dateRange}
              preset={widgetProps.preset}
              userRole={widgetProps.userRole}
              isLoading={false}
              error={undefined}
            />
          </div>
        )
      })}
    </div>
  )
}
