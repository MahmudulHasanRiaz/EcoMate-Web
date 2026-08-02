import { Link, useLocation } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Configuration', to: '/mon/settings/tracking' },
  { label: 'Monitoring', to: '/mon/settings/tracking/monitoring' },
]

/**
 * Tab navigation shared by the Tracking Configuration and Monitoring pages so
 * either page is reachable from the other.
 */
export function TrackingTabs() {
  const { pathname } = useLocation()
  return (
    <div className='flex items-center gap-1 border-b border-border'>
      {TABS.map((tab) => {
        const active =
          tab.to === '/mon/settings/tracking'
            ? pathname === '/mon/settings/tracking' || pathname === '/mon/settings/tracking/'
            : pathname.startsWith(tab.to)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
