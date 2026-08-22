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
import { Link } from '@tanstack/react-router'

export function MarketingAdAccounts() {
  const [page, setPage] = useState(1)
  const perPage = 10

  const { data, isLoading } = useQuery({
    queryKey: ['marketing-ad-accounts', page],
    queryFn: () => marketingApi.adAccounts.list({ page, perPage }).then(r => r.data),
  })
  const accounts = data?.data ?? []
  const totalPages = data?.totalPages ?? 1

  const { data: connections } = useQuery({
    queryKey: ['marketing-connections-list'],
    queryFn: () => marketingApi.connections.list().then(r => r.data),
  })

  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)

  const syncAccount = async (id: string) => {
    setSyncingId(id)
    try {
      await marketingApi.adAccounts.sync(id)
    } finally {
      setSyncingId(null)
    }
  }

  const discover = async (connectionId: string) => {
    setDiscovering(true)
    try {
      await marketingApi.adAccounts.discover(connectionId)
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Ad Accounts</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sync</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
                  {!isLoading && accounts.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      No ad accounts yet. Add manually or click Discover on a connection.
                    </TableCell></TableRow>
                  )}
                  {accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="font-medium">{a.name}</p>
                        <p className="text-xs text-muted-foreground">{a.providerAccountId} · {a.currency}</p>
                      </TableCell>
                      <TableCell>{a.connection.platform.name}</TableCell>
                      <TableCell>
                        <Badge variant={a.syncStatus?.status === 'error' ? 'destructive' : a.isActive ? 'default' : 'secondary'}>
                          {a.syncStatus?.status === 'error' ? 'error' : a.isActive ? a.status : 'inactive'}
                        </Badge>
                        {a.syncStatus?.status === 'running' && (
                          <span className="ml-1 text-xs text-muted-foreground">{a.syncStatus.stage}…</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(a.lastSyncAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={syncingId === a.id}
                          onClick={() => syncAccount(a.id)}
                        >
                          {syncingId === a.id ? 'Syncing…' : 'Sync'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t p-3">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} · {data?.total ?? 0} accounts
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h3 className="font-medium">Sync an account</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pull campaigns, ad sets, ads and daily spend from the connected platform.
                </p>
                <Link to="/op/marketing/ad-accounts/manage">
                  <Button className="mt-3 w-full">Add / discover accounts</Button>
                </Link>
              </div>
              <div className="border-t pt-4">
                <h3 className="font-medium">Connections ({connections?.length ?? 0})</h3>
                <div className="mt-2 space-y-2">
                  {(connections ?? []).map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span>{c.platform.name}</span>
                      <Button variant="outline" size="sm" disabled={discovering} onClick={() => discover(c.id)}>
                        Discover
                      </Button>
                    </div>
                  ))}
                  {(connections ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No connections. <Link to="/op/marketing/connections" className="text-primary underline">Connect a platform first</Link>.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}