import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'
import { Plus, Plug, Loader2 } from 'lucide-react'
import { healthTone } from './api'
import { STORES_KEYS, useStores } from './hooks'
import { storesApi } from './api'
import { StoreConnectDialog } from './store-connect-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function ChannelsStores() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const { data: stores, isLoading } = useStores()

  const disconnectMut = useMutation({
    mutationFn: (id: string) => storesApi.disconnect(id),
    onSuccess: () => {
      // §8.10: disconnect retains identity, mappings and history.
      toast.success('Store disconnected — identity, mappings and history retained')
      setDisconnectId(null)
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.all })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Disconnect failed'),
  })

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5" />
          <h1 className="font-semibold">Stores</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Connect WooCommerce, Shopify or custom-bridge stores. The native website is not listed here — it is never a sync target (BR-20).
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Connect store
          </Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Last sync</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7}><Loader2 className="h-4 w-4 animate-spin" /></TableCell></TableRow>
                )}
                {(stores ?? []).filter(s => s.kind !== 'NATIVE').map((store) => (
                  <TableRow key={store.id}>
                    <TableCell>
                      <Link to="/op/channels/stores/$id" params={{ id: store.id }} className="font-medium underline-offset-4 hover:underline">
                        {store.name}
                      </Link>
                    </TableCell>
                    <TableCell>{store.kind}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{store.domainNormalised ?? '—'}</TableCell>
                    <TableCell><Badge>{store.status}</Badge></TableCell>
                    <TableCell><Badge variant={healthTone(store.healthState) as any}>{store.healthState}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{store.lastSyncAt ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setDisconnectId(store.id)}>Disconnect</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && (stores ?? []).filter(s => s.kind !== 'NATIVE').length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No external stores yet — connect the first one.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
      <StoreConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={disconnectId !== null}
        onOpenChange={(v) => { if (!v) setDisconnectId(null) }}
        title="Disconnect store?"
        desc="Sync stops and webhooks are rejected. Identity, credentials, mappings, orders and history are retained for reconnect."
        confirmText="Disconnect"
        handleConfirm={() => disconnectId && disconnectMut.mutate(disconnectId)}
        isLoading={disconnectMut.isPending}
      />
    </>
  )
}
