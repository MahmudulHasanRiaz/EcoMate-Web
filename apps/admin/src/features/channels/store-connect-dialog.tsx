import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { storesApi, type TestConnectionResponse } from './api'
import { STORES_KEYS } from './hooks'
import { CapabilityNotice } from './components/capability-notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

const PROVIDERS = [
  { slug: 'WOOCOMMERCE', label: 'WooCommerce' },
  { slug: 'SHOPIFY', label: 'Shopify' },
  { slug: 'CUSTOM', label: 'Custom (Bridge v1)' },
] as const

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}

/**
 * Connect wizard (§11): provider → credentials → Test Connection panel
 * (reachability, authentication, permissions, media preflight, capability
 * summary including stock fidelity and contact-check exposure,
 * duplicate-store warning) → initial sync policy (`adopt_existing`
 * default per BR-05) → scope.
 */
export function StoreConnectDialog({ open, onOpenChange, onCreated }: Props) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState<string>('WOOCOMMERCE')
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [consumerKey, setConsumerKey] = useState('')
  const [consumerSecret, setConsumerSecret] = useState('')
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<TestConnectionResponse | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setName(''); setDomain(''); setConsumerKey(''); setConsumerSecret('')
    setProbe(null); setCreatedId(null)
  }

  const credentials = () => ({ consumerKey, consumerSecret });

  async function handleCreate() {
    if (!name.trim()) { toast.error('Store name is required'); return }
    setSaving(true)
    try {
      const store = await storesApi.create({
        kind: provider as 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM',
        name: name.trim(),
        domain: domain.trim() || undefined,
        credentials: consumerKey ? credentials() : undefined,
      })
      setCreatedId(store.id)
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.all })
      toast.success('Store registered — run Test Connection to verify')
      onCreated?.(store.id)
    } catch (e: any) {
      // §8.10: 409 carries the reconnect-to-existing payload.
      const data = e?.response?.data
      if (e?.response?.status === 409 && data?.storeId) {
        toast.error(`Already registered as "${data.storeName}" — reconnect to the existing store instead.`, { duration: 8000 })
      } else {
        toast.error(data?.message ?? 'Connect failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleProbe() {
    const id = createdId
    if (!id) { toast.error('Create the store first, then test the connection'); return }
    setProbing(true)
    try {
      const result = await storesApi.testConnection(id, consumerKey ? credentials() : undefined)
      setProbe(result)
      if (result.authenticated) toast.success('Connection verified')
      else toast.warning('Reachable but not authenticated — check credentials')
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Test connection failed')
    } finally {
      setProbing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a store</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <div className="flex gap-2">
              {PROVIDERS.map((p) => (
                <Button
                  key={p.slug}
                  type="button"
                  variant={provider === p.slug ? 'default' : 'outline'}
                  onClick={() => setProvider(p.slug)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-name">Store name</Label>
            <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dhaka flagship WooCommerce" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-domain">Store URL or domain</Label>
            <Input id="store-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://shop.example.com" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="store-key">API key</Label>
              <Input id="store-key" type="password" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-secret">API secret</Label>
              <Input id="store-secret" type="password" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Credentials are encrypted at rest and write-only — they are never returned by any read.
          </p>

          {probe && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant={probe.reachable ? 'default' : 'destructive'}>reachable: {String(probe.reachable)}</Badge>
                <Badge variant={probe.authenticated ? 'default' : 'destructive'}>auth: {String(probe.authenticated)}</Badge>
                <Badge variant={probe.permissionsOk ? 'default' : 'secondary'}>permissions: {String(probe.permissionsOk)}</Badge>
                {probe.mediaReachable !== undefined && (
                  <Badge variant={probe.mediaReachable ? 'default' : 'secondary'}>media: {String(probe.mediaReachable)}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Stock fidelity: <span className="font-medium">{probe.capabilities.stockStatusFidelity}</span>
                {' · '}contact-check exposure: <span className="font-medium">{String(probe.capabilities.contactCheckExposure)}</span>
              </div>
              <CapabilityNotice capabilities={probe.capabilities} />
            </div>
          )}

          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            Initial sync policy: <span className="font-medium">adopt_existing</span> (default, BR-05) —
            products already on the store keep their values as the baseline; EcoMate never
            overwrites them on first contact.
          </div>
        </div>
        <DialogFooter>
          {!createdId ? (
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create store
            </Button>
          ) : (
            <Button onClick={handleProbe} disabled={probing}>
              {probing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test connection
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Full-page connect wizard (`/op/channels/stores/new`): the same dialog,
 * always open, stepping back to the store list on close.
 */
export function StoreConnectPage() {
  const navigate = useNavigate()
  return (
    <StoreConnectDialog
      open
      onOpenChange={(v) => { if (!v) navigate({ to: '/op/channels/stores' }) }}
      onCreated={(id) => navigate({ to: '/op/channels/stores/$id', params: { id } })}
    />
  )
}
