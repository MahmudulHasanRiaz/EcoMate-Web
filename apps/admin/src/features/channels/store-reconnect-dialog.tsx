import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { storesApi, type StoreResponse } from './api'
import { STORES_KEYS } from './hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

function copyFor(kind: string) {
  if (kind === 'SHOPIFY') {
    return {
      keyLabel: 'Client ID',
      keyPlaceholder: 'Client ID from the Dev Dashboard app',
      secretLabel: 'Client Secret',
      secretPlaceholder: 'Client secret (also signs webhooks)',
      note: 'Use the NEW app credentials if the Shopify app was recreated. Webhook HMAC uses the client secret.',
    }
  }
  if (kind === 'CUSTOM') {
    return {
      keyLabel: 'Bridge key',
      keyPlaceholder: 'Bearer key from the bridge manifest',
      secretLabel: 'Webhook secret (optional)',
      secretPlaceholder: 'Shared HMAC secret',
      note: 'Credentials are encrypted at rest and write-only.',
    }
  }
  return {
    keyLabel: 'Consumer key',
    keyPlaceholder: '',
    secretLabel: 'Consumer secret',
    secretPlaceholder: '',
    note: 'Credentials are encrypted at rest and write-only.',
  }
}

function credentialsFor(kind: string, domain: string, key: string, secret: string) {
  if (kind === 'SHOPIFY') return { shop: domain, clientId: key, clientSecret: secret }
  if (kind === 'CUSTOM') {
    return { baseUrl: domain, bridgeKey: key, ...(secret ? { webhookSecret: secret } : {}) }
  }
  return { baseUrl: domain, consumerKey: key, consumerSecret: secret }
}

/**
 * Reconnect a DISCONNECTED store with fresh credentials (§8.10: same Store
 * row, identity/mappings/history retained; status returns to PENDING and
 * flips to CONNECTED on the next authenticated probe).
 */
export function StoreReconnectDialog({
  store,
  onClose,
}: {
  store: StoreResponse | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const copy = copyFor(store?.kind ?? '')

  const reconnectMut = useMutation({
    mutationFn: () =>
      storesApi.reconnect(
        store!.id,
        credentialsFor(store!.kind, (store as any).domainNormalised ?? '', key.trim(), secret),
      ),
    onSuccess: () => {
      toast.success('Reconnect started — run Test Connection to verify')
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.all })
      onClose()
      navigate({ to: '/op/channels/stores/$id', params: { id: store!.id } })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Reconnect failed'),
  })

  return (
    <Dialog open={store !== null} onOpenChange={(v) => { if (!v) { setKey(''); setSecret(''); onClose() } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reconnect {store?.name ?? 'store'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="re-key">{copy.keyLabel}</Label>
            <Input
              id="re-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={copy.keyPlaceholder}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="re-secret">{copy.secretLabel}</Label>
            <Input
              id="re-secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={copy.secretPlaceholder}
            />
          </div>
          <p className="text-xs text-muted-foreground">{copy.note}</p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => reconnectMut.mutate()}
            disabled={reconnectMut.isPending || !key.trim() || !secret}
          >
            {reconnectMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
