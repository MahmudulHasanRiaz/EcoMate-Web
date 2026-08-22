import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Megaphone, RefreshCw } from 'lucide-react'
import { marketingApi } from './api'
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

export function MarketingAdAccountsManage() {
  const [connectionId, setConnectionId] = useState('')
  const [providerAccountId, setProviderAccountId] = useState('')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('BDT')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoverResult, setDiscoverResult] = useState('')

  const { data: connections } = useQuery({
    queryKey: ['marketing-connections-list'],
    queryFn: () => marketingApi.connections.list().then(r => r.data),
  })

  const addAccount = async () => {
    setAddError('')
    if (!connectionId) return setAddError('Pick a connection')
    if (!providerAccountId || !name) return setAddError('Provider account id and name are required')
    setAdding(true)
    try {
      await marketingApi.adAccounts.create({ connectionId, providerAccountId, name, currency })
      setProviderAccountId('')
      setName('')
    } catch (e: any) {
      setAddError(e?.response?.data?.message ?? 'Failed to add account')
    } finally {
      setAdding(false)
    }
  }

  const discover = async () => {
    if (!connectionId) return setDiscoverResult('Pick a connection first')
    setDiscovering(true)
    setDiscoverResult('')
    try {
      const res = await marketingApi.adAccounts.discover(connectionId)
      setDiscoverResult(`Discovered ${(res.data as any).discovered ?? 0} account(s)`)
    } catch (e: any) {
      setDiscoverResult(e?.response?.data?.message ?? 'Discover failed — check the access token')
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Manage Ad Accounts</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/op/marketing/ad-accounts">
            <Button variant="outline" size="sm">Back</Button>
          </Link>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h3 className="font-medium">Add account manually</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Paste the provider account id (e.g. act_123456789) and a display name.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Connection</label>
                  <Select value={connectionId} onValueChange={setConnectionId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select connection" /></SelectTrigger>
                    <SelectContent>
                      {(connections ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.platform.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Provider account id</label>
                  <Input value={providerAccountId} onChange={(e) => setProviderAccountId(e.target.value)} placeholder="act_123456789" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Ad Account" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Currency</label>
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
                </div>
                {addError && <p className="text-sm text-red-600">{addError}</p>}
                <Button className="w-full" disabled={adding} onClick={addAccount}>
                  {adding ? 'Adding…' : 'Add account'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h3 className="font-medium flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Discover from platform</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  List every ad account the connected user can access and import them all.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Connection</label>
                  <Select value={connectionId} onValueChange={setConnectionId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select connection" /></SelectTrigger>
                    <SelectContent>
                      {(connections ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.platform.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" className="w-full" disabled={discovering} onClick={discover}>
                  {discovering ? 'Discovering…' : 'Discover ad accounts'}
                </Button>
                {discoverResult && <p className="text-sm text-muted-foreground">{discoverResult}</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}