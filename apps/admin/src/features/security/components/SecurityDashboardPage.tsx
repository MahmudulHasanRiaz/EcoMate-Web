import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Separator } from '@/components/ui/separator'
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Security Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Real-time security event monitoring, rate limiting insights, and threat intelligence.
          </p>
        </div>

        <div className="space-y-6">
          <SummaryCards data={summary.data} isLoading={summary.isLoading} />

          <Separator />

          <div className="grid gap-6 lg:grid-cols-2">
            <TrendsChart data={trends.data?.data} isLoading={trends.isLoading} interval={trends.data?.interval ?? 'hourly'} />
            <BlockActivity data={blockActivity.data?.data} isLoading={blockActivity.isLoading} />
          </div>

          <TopOffenders data={topOffenders.data?.items} isLoading={topOffenders.isLoading} window={topOffenders.data?.window ?? '24h'} />

          <EventTimeline data={timeline.data?.items} isLoading={timeline.isLoading} />
        </div>
      </Main>
    </>
  )
}
