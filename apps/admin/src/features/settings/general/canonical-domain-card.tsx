import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Globe, Loader2 } from 'lucide-react'

/**
 * Canonical domain — THE centralized source for the storefront's public
 * origin (sitemap.xml, robots.txt, canonical URLs, metadataBase).
 * Superadmin-only: a wrong value poisons what every crawler sees as
 * this store's origin, so the backend enforces the role and validates
 * the value (public https:// URL, no port, never example.com / an
 * internal host) — an invalid save fails with a precise 400, shown here.
 *
 * When unset, the storefront derives the domain from the deployment
 * (CLIENT_DOMAIN) or the request host, so live tenants keep working
 * with zero action — saving a value pins it and wins over the request
 * host (which also kills the x-forwarded-host spoofing risk).
 */
export function CanonicalDomainCard() {
  const { user } = useAuthStore((s) => s.auth)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [initialised, setInitialised] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Superadmin-only card: anyone else never sees the field (the backend
  // also rejects non-superadmin saves with 403).
  const isSuperadmin = user?.role === 'superadmin'

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then((r) => r.data as Record<string, string>),
    staleTime: 30_000,
    enabled: isSuperadmin,
  })

  const { data: storefrontCfg } = useQuery({
    queryKey: ['storefront-config'],
    queryFn: () => systemSettingsApi.getStorefrontConfig().then((r) => r.data),
    staleTime: 30_000,
    enabled: isSuperadmin,
  })

  const saved = settings ? (settings['canonical_domain'] ?? '') : ''
  const effective = storefrontCfg?.canonicalDomain ?? ''

  useEffect(() => {
    if (settings && !initialised) {
      setDraft(saved)
      setInitialised(true)
    }
  }, [settings, saved, initialised])

  const saveMut = useMutation({
    mutationFn: (value: string) => systemSettingsApi.set('canonical_domain', value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      queryClient.invalidateQueries({ queryKey: ['storefront-config'] })
      toast.success('Canonical domain saved — the storefront picks it up within about a minute.')
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Failed to save canonical domain'),
    onSettled: () => setIsSaving(false),
  })

  if (!isSuperadmin) return null

  const handleSave = (value: string) => {
    const trimmed = value.trim()
    // Keep the input in sync with what was actually saved (Clear empties
    // it; Save trims it) so the field never shows a stale value after
    // the refetch — the init effect only runs once.
    setDraft(trimmed)
    setIsSaving(true)
    saveMut.mutate(trimmed)
  }

  const isDirty = draft.trim() !== saved

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <Globe size={20} className='text-primary' />
            <div>
              <CardTitle>Canonical Domain</CardTitle>
              <CardDescription>
                The single public domain for this store — used for the sitemap, robots.txt,
                canonical URLs and page metadata.
              </CardDescription>
            </div>
          </div>
          {settingsLoading ? (
            <Loader2 className='animate-spin h-5 w-5 text-muted-foreground' />
          ) : (
            <Badge variant={saved ? 'default' : 'secondary'}>
              {saved ? 'Saved' : 'Not set'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-end gap-2'>
          <div className='flex-1 space-y-1.5'>
            <label htmlFor='canonical-domain' className='text-sm font-medium'>
              Canonical domain URL
            </label>
            <Input
              id='canonical-domain'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='https://demo.ecomate.bd'
              disabled={settingsLoading || isSaving}
              autoComplete='off'
              spellCheck={false}
            />
          </div>
          <Button
            onClick={() => handleSave(draft)}
            disabled={settingsLoading || isSaving || !isDirty}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant='outline'
            onClick={() => handleSave('')}
            disabled={settingsLoading || isSaving || !saved}
          >
            Clear
          </Button>
        </div>
        <p className='text-sm text-muted-foreground'>
          {saved
            ? effective
              ? `In effect: ${effective} (saved).`
              : 'Saved, waiting for the storefront to pick it up.'
            : effective
              ? `In effect: ${effective} (detected from the deployment — save a value to pin it).`
              : 'Not set — the storefront falls back to the request host.'}
        </p>
        <p className='text-xs text-muted-foreground'>
          Must be a public https:// URL with no port (e.g. https://demo.ecomate.bd). Changes
          apply to the storefront within about a minute; the sitemap refreshes within an
          hour, or immediately via Purge all cache.
        </p>
      </CardContent>
    </Card>
  )
}
