import { ShieldCheck } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Separator } from '@/components/ui/separator'
import { riseStyle } from '@/components/ui/dashboard'
import { SummaryCards } from './SummaryCards'
import { EventTimeline } from './EventTimeline'
import { TrendsChart } from './TrendsChart'
import { TopOffenders } from './TopOffenders'
import { BlockActivity } from './BlockActivity'
import { useSecuritySummary, useSecurityTimeline, useSecurityTrends, useSecurityTopOffenders, useSecurityBlockActivity } from '../hooks'

export function SecurityDashboardPage() {
  const summary = useSecuritySummary()
  const timeline = useSecurityTimeline({ limit: 25 })
  const trends = useSecurityTrends({ interval: 'hourly' })
  const topOffenders = useSecurityTopOffenders({ window: '24h', limit: 10 })
  const blockActivity = useSecurityBlockActivity()

  return (
    <>
      <Header fixed>
        <div className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main>
        <div className="mb-6 flex items-center gap-3">
          <span className="chart-card-header-icon bg-danger-soft text-danger border border-danger/25">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Security Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Real-time security event monitoring, rate limiting insights, and threat intelligence.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="animate-rise" style={riseStyle(0)}>
            <SummaryCards data={summary.data} isLoading={summary.isLoading} />
          </div>

          <Separator />

          <div className="grid gap-6 lg:grid-cols-2 animate-rise" style={riseStyle(1)}>
            <TrendsChart data={trends.data?.data} isLoading={trends.isLoading} interval={trends.data?.interval ?? 'hourly'} />
            <BlockActivity data={blockActivity.data?.data} isLoading={blockActivity.isLoading} />
          </div>

          <div className="animate-rise" style={riseStyle(2)}>
            <TopOffenders data={topOffenders.data?.items} isLoading={topOffenders.isLoading} window={topOffenders.data?.window ?? '24h'} />
          </div>

          <div className="animate-rise" style={riseStyle(3)}>
            <EventTimeline data={timeline.data?.items} isLoading={timeline.isLoading} />
          </div>
        </div>
      </Main>
    </>
  )
}
