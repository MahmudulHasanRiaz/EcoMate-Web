import { Link } from '@tanstack/react-router'
import { LayoutDashboard, Plug } from 'lucide-react'
import { healthTone } from './api'
import { useStores } from './hooks'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export { ChannelsStores } from './stores'
export { ChannelStoreDetail } from './store-detail'
export { StoreConnectDialog, StoreConnectPage } from './store-connect-dialog'
export { ProductAvailability } from './product-availability'
export { AvailabilityRules } from './availability-rules'
export { SyncCenter, SyncRunDetail } from './sync-center'
export { SyncOverrides } from './overrides'

/**
 * Sales Channels overview (§11): health grid, last sync, active runs,
 * sync-all. Runs and sync-all land with the sync engine (P4) — the grid
 * below is live store health; the run panels are explicit placeholders.
 */
export function ChannelsOverview() {
  const { data: stores } = useStores()
  const external = (stores ?? []).filter((s) => s.kind !== 'NATIVE')

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          <h1 className="font-semibold">Sales Channels</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="grid gap-4 md:grid-cols-3">
          {external.map((store) => (
            <Link key={store.id} to="/op/channels/stores/$id" params={{ id: store.id }}>
              <Card className="hover:border-primary">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plug className="h-4 w-4" /> {store.name}
                  </CardTitle>
                  <CardDescription>{store.kind} · last sync {store.lastSyncAt ?? '—'}</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Badge>{store.status}</Badge>
                  <Badge variant={healthTone(store.healthState) as any}>{store.healthState}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
          {external.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No external stores connected. <Link to="/op/channels/stores" className="underline">Connect the first store</Link>.
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="mt-4">
          <CardContent className="p-6 text-sm text-muted-foreground">
            Active runs and sync-all land with the sync engine (P4) and the operations centre (P11).
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
