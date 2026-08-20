import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Megaphone } from 'lucide-react'
import { marketingApi, fmtDate } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Link } from '@tanstack/react-router'

export function MarketingCampaigns() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [adAccountId, setAdAccountId] = useState('')
  const perPage = 15

  const { data, isLoading } = useQuery({
    queryKey: ['marketing-campaigns', page, search, adAccountId],
    queryFn: () => marketingApi.campaigns.list({ page, perPage, search: search || undefined, adAccountId: adAccountId || undefined }).then(r => r.data),
  })

  const { data: accounts } = useQuery({
    queryKey: ['marketing-ad-accounts-opt'],
    queryFn: () => marketingApi.adAccounts.list({ page: 1, perPage: 100 }).then(r => r.data),
  })

  const campaigns = data?.data ?? []

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Campaigns</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-64 pl-8"
              placeholder="Search campaigns…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
            />
          </div>
          <Select value={adAccountId} onValueChange={(v) => { setAdAccountId(v); setPage(1) }}>
            <SelectTrigger className="w-56"><SelectValue placeholder="All ad accounts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" onClick={() => setAdAccountId('')}>All ad accounts</SelectItem>
              {(accounts?.data ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => { setSearch(''); setSearchInput(''); setAdAccountId(''); setPage(1) }}>
            Reset
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Objective</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attributed orders</TableHead>
                  <TableHead>Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
                {!isLoading && campaigns.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No campaigns. Sync an ad account to pull them from the platform.
                  </TableCell></TableRow>
                )}
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link to="/op/marketing/campaigns/$id" params={{ id: c.id }} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{c.providerCampaignId}</p>
                    </TableCell>
                    <TableCell className="text-sm">{c.adAccount?.name}</TableCell>
                    <TableCell className="text-sm">{c.objective ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={c.isArchived ? 'secondary' : c.status === 'ACTIVE' ? 'default' : 'outline'}>
                        {c.effectiveStatus ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{c._count?.orderAttributions ?? 0}</TableCell>
                    <TableCell className="text-sm">{fmtDate(c.lastSyncedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t p-3">
              <p className="text-sm text-muted-foreground">
                Page {page} of {data?.totalPages ?? 1} · {data?.total ?? 0} campaigns
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}