import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { storesApi, DEFAULT_SYNC_SCOPE, INITIAL_SYNC_POLICY, type SyncScope, type TestConnectionResponse } from './api'
import { STORES_KEYS } from './hooks'
import { CapabilityNotice } from './components/capability-notice'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

/** P9 canonical wizard steps (§11): the dialog never skips or reorders these. */
const WIZARD_STEPS = [
  'Select Platform',
  'Provider Auth',
  'Verify',
  'Sync Configuration',
  'Complete',
] as const

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}

/**
 * Connect wizard (§11): Select Platform → Provider Auth → Verify (Test
 * Connection panel: reachability, authentication, permissions, media
 * preflight, capability summary including stock fidelity and contact-check
 * exposure, duplicate-store warning) → Sync Configuration (scope checkboxes
 * + fixed `adopt_existing` policy per BR-05) → Complete (Save & Complete
 * persists scope + policy via PATCH, then navigates to the store detail).
 *
 * The middle auth step is per-provider; the dialog, steps and flow are
 * identical — only the auth fields/labels switch by platform:
 * - WooCommerce: store URL + consumer key/secret (Basic auth).
 * - Shopify: shop domain + Client ID + Client Secret (Client Credentials
 *   Grant — the app and the store must share a Dev Dashboard org; webhook
 *   HMAC uses the client secret).
 * - Custom: bridge endpoint URL + bridge key (bearer).
 * Connection, availability and sync states stay separate (no merging).
 */
export function StoreConnectDialog({ open, onOpenChange, onCreated }: Props) {
  const navigate = useNavigate()
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
  const [scope, setScope] = useState<SyncScope>({ ...DEFAULT_SYNC_SCOPE })
  const [completing, setCompleting] = useState(false)
  const [completed, setCompleted] = useState(false)

  const reset = () => {
    setName(''); setDomain(''); setConsumerKey(''); setConsumerSecret('')
    setProbe(null); setCreatedId(null)
    setScope({ ...DEFAULT_SYNC_SCOPE }); setCompleting(false); setCompleted(false)
  }

  /** Canonical step index: pre-create covers Select Platform + Provider Auth. */
  const stepIndex = completed ? 4 : probe?.authenticated ? 3 : createdId ? 2 : 1

  const credentials = () => {
    if (provider === 'SHOPIFY') {
      return {
        shop: domain.trim(),
        clientId: consumerKey,
        clientSecret: consumerSecret,
      }
    }
    if (provider === 'CUSTOM') {
      return {
        baseUrl: domain.trim(),
        bridgeKey: consumerKey,
        ...(consumerSecret ? { webhookSecret: consumerSecret } : {}),
      }
    }
    return { baseUrl: domain.trim(), consumerKey, consumerSecret }
  };

  const authCopy =
    provider === 'SHOPIFY'
      ? {
          domainLabel: 'Shop domain',
          domainPlaceholder: 'my-shop.myshopify.com',
          keyLabel: 'Client ID',
          keyPlaceholder: 'Client ID from the Dev Dashboard app',
          secretLabel: 'Client Secret',
          secretPlaceholder: 'Client secret (also signs webhooks)',
          note: 'Client Credentials Grant: the app and the store must share a Dev Dashboard org. Webhook HMAC uses the client secret. Stock on Shopify is monitor-only (BR-08) — EcoMate never writes stock there.',
        }
      : provider === 'CUSTOM'
        ? {
            domainLabel: 'Bridge endpoint URL',
            domainPlaceholder: 'https://store.example.com',
            keyLabel: 'Bridge key',
            keyPlaceholder: 'Bearer key from the bridge manifest',
            secretLabel: 'Webhook secret (optional)',
            secretPlaceholder: 'Shared HMAC secret',
            note: 'The bridge reports its capabilities via manifest (P10); status-only stock is the tested default path.',
          }
        : {
            domainLabel: 'Store URL',
            domainPlaceholder: 'https://shop.example.com',
            keyLabel: 'Consumer key',
            keyPlaceholder: '',
            secretLabel: 'Consumer secret',
            secretPlaceholder: '',
            note: 'Credentials are encrypted at rest and write-only — they are never returned by any read.',
          }

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
      // NOTE (P9): onCreated is intentionally NOT fired here — the wizard
      // completes at Sync Configuration → Save & Complete navigates then.
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

  /**
   * P9 Sync Configuration → Complete: persists the wizard scope + the fixed
   * `adopt_existing` policy (BR-05) via PATCH, then navigates to the store
   * detail. Additive — auth fields and the verify panel are untouched.
   */
  async function handleSaveAndComplete() {
    const id = createdId
    if (!id) { toast.error('Create the store first, then complete setup'); return }
    if (!probe?.authenticated) { toast.error('Verify the connection first — Save & Complete needs a passing probe'); return }
    setCompleting(true)
    try {
      await storesApi.update(id, { syncScope: scope, initialSyncPolicy: INITIAL_SYNC_POLICY })
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.all })
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.detail(id) })
      setCompleted(true)
      toast.success('Sync configuration saved — store setup complete')
      onCreated?.(id)
      onOpenChange(false)
      navigate({ to: '/op/channels/stores/$id', params: { id } })
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Saving sync configuration failed')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a store</DialogTitle>
        </DialogHeader>
        <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Connect steps">
          {WIZARD_STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <span
                className={
                  i === stepIndex
                    ? 'font-semibold text-foreground'
                    : i < stepIndex
                      ? 'text-muted-foreground line-through'
                      : 'text-muted-foreground'
                }
                aria-current={i === stepIndex ? 'step' : undefined}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
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
            <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dhaka flagship store" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-domain">{authCopy.domainLabel}</Label>
            <Input id="store-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={authCopy.domainPlaceholder} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="store-key">{authCopy.keyLabel}</Label>
              <Input id="store-key" type="password" value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} autoComplete="off" placeholder={authCopy.keyPlaceholder} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-secret">{authCopy.secretLabel}</Label>
              <Input id="store-secret" type="password" value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} autoComplete="off" placeholder={authCopy.secretPlaceholder} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {authCopy.note}
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

          {probe?.authenticated && createdId && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-medium">Sync configuration</div>
              <div className="space-y-2">
                {(
                  [
                    ['products', 'Products'],
                    ['orders', 'Orders'],
                    ['stock', 'Stock status'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={scope[key]}
                      onCheckedChange={(v) => setScope((s) => ({ ...s, [key]: v === true }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Initial sync policy: <span className="font-medium">{INITIAL_SYNC_POLICY}</span> (fixed, BR-05) —
                pre-existing store values stay the baseline on first contact.
              </div>
              <Button onClick={handleSaveAndComplete} disabled={completing}>
                {completing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save &amp; Complete
              </Button>
            </div>
          )}
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
 * always open, stepping back to the store list on close. `onCreated` fires
 * at Save & Complete (P9) — the dialog navigates to the store detail itself.
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
