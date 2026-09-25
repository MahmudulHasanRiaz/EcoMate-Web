import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { healthTone, storesApi } from './api'
import { useStoreDetail, useStoreHealth, STORES_KEYS } from './hooks'
import { CapabilityNotice } from './components/capability-notice'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQueryClient } from '@tanstack/react-query'

const TABS = ['Overview', 'Products', 'Orders', 'Synchronization', 'Settings', 'Activity'] as const

/**
 * Store detail shell (§11): Overview · Products · Orders · Synchronization ·
 * Settings · Activity. Product/order/sync surfaces land in P4/P6; their tabs
 * render explicit placeholders so nothing looks finished before it is.
 */
export function ChannelStoreDetail() {
  const { id } = useParams({ strict: false }) as { id: string }
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')
  const [rotateOpen, setRotateOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const { data: store, isLoading } = useStoreDetail(id)
  const { data: health } = useStoreHealth(id)

  async function handleProbe() {
    try {
      const result = await storesApi.testConnection(id)
      toast.success(result.authenticated ? 'Connection verified' : 'Probe recorded — not authenticated')
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.detail(id) })
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.health(id) })
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Probe failed')
    }
  }

  async function handleRotate() {
    if (!secret) { toast.error('Paste the new secret first'); return }
    try {
      await storesApi.rotateCredentials(id, { secret })
      toast.success('Credentials rotated (write-only — never echoed back)')
      setSecret(''); setRotateOpen(false)
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Rotation failed')
    }
  }

  return (
    <>
      <Header fixed>
        <h1 className="font-semibold">{store?.name ?? 'Store'}</h1>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {store && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{store.kind}</Badge>
              <Badge>{store.status}</Badge>
              <Badge variant={healthTone(store.healthState) as any}>{store.healthState}</Badge>
              <Button variant="outline" size="sm" onClick={handleProbe}>
                <RefreshCw className="mr-2 h-3 w-3" /> Probe health
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <Button key={t} variant={tab === t ? 'default' : 'ghost'} size="sm" onClick={() => setTab(t)}>
                  {t}
                </Button>
              ))}
            </div>
            {tab === 'Overview' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div>Domain: {store.domainNormalised ?? '—'}</div>
                    <div>Provider store id: {store.providerStoreId ?? '—'}</div>
                    <div>Plugin: {store.pluginVersion ?? 'not reported'}</div>
                    <div>Last health check: {store.lastHealthCheckAt ?? '—'}</div>
                    <div>Last error: {store.lastError ?? '—'}</div>
                    {health && <div>Probe: {health.reason ?? health.state} ({health.checkedAt})</div>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
                  <CardContent>
                    <CapabilityNotice capabilities={store.capabilities} />
                    {!store.capabilities && <p className="text-sm text-muted-foreground">Run Test Connection to discover capabilities.</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Rotate credentials</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {!rotateOpen
                      ? <Button variant="outline" size="sm" onClick={() => setRotateOpen(true)}>Rotate…</Button>
                      : (
                        <div className="space-y-2">
                          <Label htmlFor="rotate-secret">New secret (write-only)</Label>
                          <Input id="rotate-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
                          <Button size="sm" onClick={handleRotate}>Rotate</Button>
                        </div>
                      )}
                  </CardContent>
                </Card>
              </div>
            )}
            {tab !== 'Overview' && (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  {tab} for this store lands with {tab === 'Products' ? 'product sync (P4)' : tab === 'Orders' ? 'order ingestion (P6)' : tab === 'Synchronization' ? 'the sync engine (P4)' : tab === 'Activity' ? 'the operations centre (P11)' : 'distribution (P3)'}.
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
