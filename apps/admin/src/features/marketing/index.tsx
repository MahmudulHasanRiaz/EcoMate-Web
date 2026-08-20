import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Megaphone, TrendingUp, TrendingDown, Wallet, ShoppingCart, BadgeDollarSign, PiggyBank, RefreshCw } from 'lucide-react'
import { marketingApi, money, fmtDate } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import { Link } from '@tanstack/react-router'

function deltaBadge(d: number | null) {
  if (d === null) return <span className="text-muted-foreground text-xs">—</span>
  const up = d >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(d).toFixed(1)}%
    </span>
  )
}

function StatCard({ title, value, sub, icon: Icon, delta }: {
  title: string
  value: string
  sub?: string
  icon: any
  delta?: number | null
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        {delta !== undefined && <div className="mt-2">{deltaBadge(delta)}</div>}
      </CardContent>
    </Card>
  )
}

export function MarketingDashboard() {
  const [days, setDays] = useState(30)

  const toDate = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  const { data: kpis } = useQuery({
    queryKey: ['marketing-kpis', from, toDate],
    queryFn: () => marketingApi.analysis.kpis({ fromDate: from, toDate }).then(r => r.data),
  })
  const { data: overview } = useQuery({
    queryKey: ['marketing-overview', from, toDate],
    queryFn: () => marketingApi.analysis.overview({ fromDate: from, toDate }).then(r => r.data),
  })
  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['marketing-campaigns-dash'],
    queryFn: () => marketingApi.campaigns.list({ page: 1, perPage: 8 }).then(r => r.data),
  })
  const { data: fundingSummary } = useQuery({
    queryKey: ['marketing-funding-summary'],
    queryFn: () => marketingApi.funding.summary().then(r => r.data),
  })
  const { data: accounts } = useQuery({
    queryKey: ['marketing-ad-accounts-dash'],
    queryFn: () => marketingApi.adAccounts.list({ page: 1, perPage: 50 }).then(r => r.data),
  })

  const rows = overview?.series?.slice(-30) ?? []

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Marketing Dashboard</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Platform Spend"
            value={money(kpis?.platform.spend, kpis?.platform.purchaseValue ? 'USD' : 'BDT')}
            sub={`${kpis?.platform.impressions ?? 0} impressions · ${kpis?.platform.clicks ?? 0} clicks`}
            icon={Wallet}
            delta={overview?.deltas.spend}
          />
          <StatCard
            title="Platform ROAS"
            value={kpis?.platform.roas ? `${kpis.platform.roas.toFixed(2)}x` : '—'}
            sub={`${kpis?.platform.purchases ?? 0} purchases`}
            icon={TrendingUp}
          />
          <StatCard
            title="Attributed Revenue"
            value={money(kpis?.store.revenue)}
            sub={`${kpis?.store.orders ?? 0} orders attributed`}
            icon={ShoppingCart}
            delta={overview?.deltas.revenue}
          />
          <StatCard
            title="Gross Profit"
            value={money(kpis?.store.grossProfit)}
            sub={`Marketing cost ${money(kpis?.store.marketingCost)} · Store ROAS ${kpis?.store.roas ? `${kpis.store.roas.toFixed(2)}x` : '—'}`}
            icon={PiggyBank}
            delta={overview?.deltas.profit}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Daily revenue vs spend</CardTitle>
              <CardDescription>BDT revenue · platform spend</CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No daily summaries yet. Sync an ad account and run "Recalculate summaries" in Reports.
                </p>
              ) : (
                <div className="flex h-48 items-end gap-1">
                  {rows.map((r) => (
                    <div key={r.date} className="group relative flex-1">
                      <div
                        className="w-full rounded-t bg-primary/30 transition-colors group-hover:bg-primary/50"
                        style={{ height: `${Math.max(2, (r.revenue / Math.max(...rows.map(x => x.revenue), 1)) * 160)}px` }}
                        title={`${r.date} · revenue ${money(r.revenue)}`}
                      />
                      <div
                        className="w-full rounded-t bg-red-400/60"
                        style={{ height: `${Math.max(1, (r.spend / Math.max(...rows.map(x => x.revenue), 1)) * 160)}px` }}
                        title={`${r.date} · spend ${money(r.spend)}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funding balance</CardTitle>
              <CardDescription>Per connected ad account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(fundingSummary ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No funding entries yet.</p>
              )}
              {(fundingSummary ?? []).map((f) => (
                <div key={f.adAccountId} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{f.adAccountName ?? 'Ad account'}</p>
                    <p className="text-xs text-muted-foreground">
                      received {money(f.receivedAmount)} · consumed {money(f.consumedAmount)}
                    </p>
                  </div>
                  <Badge variant="secondary">{money(f.remainingAmount)} left</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Recent campaigns</CardTitle>
              <Link to="/op/marketing/campaigns">
                <Button variant="outline" size="sm">All campaigns</Button>
              </Link>
            </CardHeader>
            <CardContent>
              {campaignsLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {(campaigns?.data ?? []).length === 0 && !campaignsLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No synced campaigns. Connect a platform and sync an ad account.
                </p>
              )}
              {(campaigns?.data ?? []).length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attributed orders</TableHead>
                      <TableHead className="text-right">Last sync</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(campaigns?.data ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link to="/op/marketing/campaigns/$id" params={{ id: c.id }} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{c.adAccount?.name}</TableCell>
                        <TableCell>
                          <Badge variant={c.isArchived ? 'secondary' : c.status === 'ACTIVE' ? 'default' : 'outline'}>
                            {c.effectiveStatus ?? c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c._count?.orderAttributions ?? 0}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm">{fmtDate(c.lastSyncedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ad accounts</CardTitle>
              <CardDescription>Sync state</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(accounts?.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No ad accounts. <Link to="/op/marketing/ad-accounts" className="text-primary underline">Add one</Link>.
                </p>
              )}
              {(accounts?.data ?? []).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.providerAccountId} · {a.currency}{a.lastSyncAt ? ` · synced ${fmtDate(a.lastSyncAt)}` : ''}
                    </p>
                  </div>
                  <Badge variant={a.syncStatus?.status === 'running' ? 'default' : a.syncStatus?.status === 'error' ? 'destructive' : 'secondary'}>
                    {a.syncStatus?.status ?? 'never'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <RefreshCw className="mr-1 inline h-3 w-3" />
          Numbers come from recorded rows (insights, attributions, allocations) and are reproducible. Use the
          <Link to="/op/marketing/reports" className="mx-1 text-primary underline">Reports</Link>
          page to re-run summaries or allocations after data fixes.
          <BadgeDollarSign className="ml-2 inline h-3 w-3" /> Funding posts a journal entry (marketing expense) once confirmed — it flows into the P&amp;L.
        </div>
      </Main>
    </>
  )
}