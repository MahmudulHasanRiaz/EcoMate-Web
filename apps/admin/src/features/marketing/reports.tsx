import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BarChart3, TrendingUp, TrendingDown, RefreshCw, Scale } from 'lucide-react'
import { marketingApi, money, fmtDate } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function MarketingReports() {
  const queryClient = useQueryClient()

  const { data: overview, isLoading } = useQuery({
    queryKey: ['marketing-analysis-overview'],
    queryFn: () => marketingApi.analysis.overview().then(r => r.data as any),
  })
  const { data: kpis } = useQuery({
    queryKey: ['marketing-analysis-kpis'],
    queryFn: () => marketingApi.analysis.kpis().then(r => r.data as any),
  })
  const { data: perf } = useQuery({
    queryKey: ['marketing-analysis-campaign-performance'],
    queryFn: () => marketingApi.campaigns.list({ page: 1, perPage: 50 }).then(r => r.data),
  })
  const { data: profitability } = useQuery({
    queryKey: ['marketing-analysis-profitability'],
    queryFn: () => marketingApi.analysis.profitability().then(r => r.data as any),
  })
  const { data: fundingPnl } = useQuery({
    queryKey: ['marketing-funding-pnl'],
    queryFn: () => marketingApi.analysis.fundingPnL().then(r => r.data as any),
  })

  const recalcMut = useMutation({
    mutationFn: () => marketingApi.analysis.recalculate(),
    onSuccess: () => {
      toast.success('Summaries recalculated')
      ;['marketing-analysis-overview', 'marketing-analysis-kpis', 'marketing-analysis-profitability'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }))
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Recalculate failed'),
  })

  const series = useMemo(() => ((overview?.series ?? []) as any[]).slice(-30), [overview])
  const maxSpend = Math.max(1, ...series.map((d) => Number(d.spend)))

  const stat = (label: string, value: string, sub?: string) => (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </CardContent></Card>
  )

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Reports</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={recalcMut.isPending} onClick={() => recalcMut.mutate()}>
            <RefreshCw className={`mr-1 h-4 w-4 ${recalcMut.isPending ? 'animate-spin' : ''}`} />
            Recalculate summaries
          </Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stat('Campaign spend', money(Number(kpis?.platform?.spend ?? 0)), `${Number(kpis?.platform?.impressions ?? 0).toLocaleString()} impressions`)}
            {stat('Platform revenue', money(Number(kpis?.platform?.purchaseValue ?? 0)), `${Number(kpis?.platform?.purchases ?? 0)} purchases`)}
            {stat('Order revenue', money(Number(kpis?.store?.revenue ?? 0)), `${kpis?.store?.orders ?? 0} attributed orders`)}
            {stat('Net profit', money(Number(kpis?.store?.grossProfit ?? 0)), `ROAS ${Number(kpis?.store?.roas ?? 0).toFixed(2)}`)}
          </div>
        )}

        <Card className="mt-4">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Daily spend vs order revenue</CardTitle></CardHeader>
          <CardContent>
            {series.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No daily data yet — sync an ad account to populate.</p>}
            <div className="flex h-44 items-end gap-1">
              {series.map((d) => (
                <div key={String(d.date)} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end gap-0.5">
                    <div className="w-1/2 rounded-t bg-primary/70" style={{ height: `${(Number(d.spend) / maxSpend) * 100}%`, minHeight: 2 }}
                      title={`spend ${money(Number(d.spend))}`} />
                    <div className="w-1/2 rounded-t bg-emerald-400/80" style={{ height: `${Math.min(100, (Number(d.revenue) / Math.max(1, maxSpend)) * 100)}%`, minHeight: 2 }}
                      title={`revenue ${money(Number(d.revenue))}`} />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{String(d.date).slice(5)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="mt-4">
          <Tabs defaultValue="campaigns">
            <TabsList>
              <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
              <TabsTrigger value="profitability">Profitability</TabsTrigger>
              <TabsTrigger value="funding">Funding P&amp;L</TabsTrigger>
            </TabsList>

            <TabsContent value="campaigns">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead>Ad account</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Budget/day</TableHead>
                        <TableHead className="text-right">Attributed orders</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(perf?.data ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          No campaigns yet. Connect an ad account and run a sync.
                        </TableCell></TableRow>
                      )}
                      {(perf?.data ?? []).map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm font-medium">{c.name}</TableCell>
                          <TableCell className="text-sm">{c.adAccount?.name ?? '—'}</TableCell>
                          <TableCell><span className="text-xs">{c.status}</span></TableCell>
                          <TableCell className="text-right tabular-nums">{c.dailyBudget ? `$${Number(c.dailyBudget).toFixed(2)}` : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{c._count?.orderAttributions ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="profitability">
              <Card>
                <CardContent className="p-0">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <p className="text-xs text-muted-foreground">Order-total share of campaign day spend (product_value).</p>
                    <Button variant="outline" size="sm" onClick={() => marketingApi.analysis.rebuildAllocations().then(() => {
                      toast.success('Allocations rebuilt')
                      queryClient.invalidateQueries({ queryKey: ['marketing-analysis-profitability'] })
                    })}>
                      <Scale className="mr-1 h-3 w-3" />Rebuild allocations
                    </Button>
                  </div>
                  <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    {stat('Store revenue', money(Number(profitability?.storeRevenue ?? 0)))}
                    {stat('Marketing cost', money(Number(profitability?.marketingCost ?? 0)))}
                    {stat('Gross profit', money(Number(profitability?.grossProfit ?? 0)),
                      `${Number(profitability?.grossMargin ?? 0).toFixed(1)}% margin`)}
                    {stat('Attributed orders', String(profitability?.attributedOrders ?? 0),
                      `${money(Number(profitability?.platformSpend ?? 0))} platform spend`)}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="funding">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entry</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((fundingPnl?.entries ?? []) as any[]).length === 0 && (
                        <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No funding journal entries yet — post confirmed funding to accounting.
                        </TableCell></TableRow>
                      )}
                      {((fundingPnl?.entries ?? []) as any[]).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-sm font-medium">{e.entryNo}</TableCell>
                          <TableCell className="text-sm tabular-nums">{fmtDate(e.entryDate)}</TableCell>
                          <TableCell className="text-sm">{e.description}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(Number(e.totalDebit))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex justify-end border-t px-4 py-2">
                    <p className="text-sm font-semibold tabular-nums">Total {money(Number(fundingPnl?.total ?? 0))}</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Positive net
          <TrendingDown className="h-3.5 w-3.5 text-red-500" /> Negative net
          <span className="ml-auto">Period {fmtDate(overview?.series?.[0]?.date)} — {fmtDate(overview?.series?.[overview?.series?.length - 1]?.date)}</span>
        </div>
      </Main>
    </>
  )
}