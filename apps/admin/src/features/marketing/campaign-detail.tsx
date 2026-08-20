import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { marketingApi, money, fmtDate } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import { Link, useParams } from '@tanstack/react-router'

export function MarketingCampaignDetail() {
  const params = useParams({ from: '/_authenticated/op/marketing/campaigns/$id' }) as { id: string }
  const [days, setDays] = useState(30)

  const toDate = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  const { data: campaign } = useQuery({
    queryKey: ['marketing-campaign', params.id],
    queryFn: () => marketingApi.campaigns.get(params.id).then(r => r.data),
  })

  const { data: perf } = useQuery({
    queryKey: ['marketing-campaign-perf', params.id, from, toDate],
    queryFn: () => marketingApi.campaigns.performance(params.id, { fromDate: from, toDate }).then(r => r.data),
  })

  const { data: insights } = useQuery({
    queryKey: ['marketing-insights', params.id, from],
    queryFn: () => marketingApi.insights({ campaignId: params.id, fromDate: from, toDate, page: 1, perPage: 60 }).then(r => r.data),
  })

  const store = perf?.store
  const platform = perf?.platform

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          <h1 className="text-lg font-semibold">{campaign?.name ?? 'Campaign'}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/op/marketing/campaigns">
            <button className="text-sm text-muted-foreground hover:underline">Back</button>
          </Link>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Platform spend</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(platform?.spend)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {platform?.impressions ?? 0} impressions · {platform?.clicks ?? 0} clicks
                {platform?.purchases !== undefined ? ` · ${platform.purchases} purchases` : ''}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Platform ROAS</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{platform?.roas ? `${platform.roas.toFixed(2)}x` : '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">keyed on platform purchase value</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Attributed store revenue</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(store?.revenue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{store?.orders ?? 0} orders attributed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Marketing cost</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(store?.marketingCost)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                profit {money(store?.profit)} · store ROAS {store?.roas ? `${store.roas.toFixed(2)}x` : '—'} · AOV {money(store?.aov)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Daily insights</CardTitle>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="text-right">Purchase value</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(insights?.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    No insights in this window. Sync the ad account to pull them.
                  </TableCell></TableRow>
                )}
                {(insights?.data ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-sm">{fmtDate(i.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.impressions}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.clicks}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(i.spend).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.purchases}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.purchaseValue != null ? Number(i.purchaseValue).toFixed(2) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.roas != null ? `${Number(i.roas).toFixed(2)}x` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardContent className="space-y-2 p-5">
            <CardDescription>Campaign metadata</CardDescription>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p><span className="text-muted-foreground">Status</span> <Badge variant="outline">{campaign?.effectiveStatus ?? campaign?.status}</Badge></p>
              <p><span className="text-muted-foreground">Objective</span> {campaign?.objective ?? '—'}</p>
              <p><span className="text-muted-foreground">Daily budget</span> {campaign?.dailyBudget ? `${campaign.dailyBudget} ${campaign.adAccount?.providerAccountId ? '' : ''}` : '—'}</p>
              <p><span className="text-muted-foreground">Last synced</span> {fmtDate(campaign?.lastSyncedAt)}</p>
            </div>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}