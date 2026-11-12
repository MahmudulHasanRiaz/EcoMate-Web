import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useAuthStore } from '@/stores/auth-store'
import { rememberCacheVersion } from '@/lib/cache-version'
import {
  PURGE_LAYER_LABELS,
  PURGE_LAYER_ORDER,
  purgeAllCache,
  type PurgeAllResult,
  type PurgeLayerStatus,
} from '../api'

/**
 * "Purge all cache" — the manual escape hatch for stale devices
 * (P0 stale-bundle round, 2026-11-12; owner-approved design).
 *
 * Desktop corner, small sticky button; superadmin-only; confirmation
 * before purging (it is heavy — the site is slower for a bit while
 * caches rebuild — and it affects the live storefront). Mobile
 * visibility is not important: hidden below the md breakpoint.
 *
 * Honest boundary, stated in the confirmation and the result: a server
 * button cannot clear the cache on a specific phone or browser
 * directly. The purge clears the server/CDN layers and bumps the cache
 * version, so every device loads fresh on its next visit.
 *
 * After a successful purge this tab remembers the new version itself
 * (so the periodic version check does not reload it while the result
 * is on screen) and offers an explicit "Reload this page now" button.
 */

const LAYER_STATUS_META: Record<
  PurgeLayerStatus,
  { label: string; className: string }
> = {
  purged: {
    label: 'Purged',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  },
  not_configured: {
    label: 'Not configured',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  },
  skipped: {
    label: 'Skipped',
    className: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  },
}

export function PurgeAllCacheButton() {
  const role = useAuthStore((s) => s.auth.user?.role)
  // The role gate lives outside the mutation: non-superadmin users never
  // mount any query machinery (this also keeps the layout usable in
  // contexts without a QueryClientProvider, e.g. layout tests).
  if (role !== 'superadmin') return null
  return <PurgeAllCacheButtonInner />
}

function PurgeAllCacheButtonInner() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<PurgeAllResult | null>(null)

  const purgeMut = useMutation({
    mutationFn: purgeAllCache,
    onSuccess: (data) => {
      setConfirmOpen(false)
      setResult(data)
      // This tab already knows the new version — do not let the periodic
      // version check reload it out from under the result dialog.
      rememberCacheVersion(data.version)
    },
    onError: () => {
      setConfirmOpen(false)
      toast.error('Could not purge the cache. Please try again.')
    },
  })

  const failedLayers = result
    ? PURGE_LAYER_ORDER.filter((k) => result.layers[k].status === 'failed')
    : []
  const notConfiguredLayers = result
    ? PURGE_LAYER_ORDER.filter((k) => result.layers[k].status === 'not_configured')
    : []

  return (
    <>
      <div className='fixed bottom-4 right-4 z-50 hidden md:block'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          aria-label='Purge all cache'
          title='Purge all cache'
          onClick={() => setConfirmOpen(true)}
          className='shadow-md'
        >
          <RefreshCw className='h-4 w-4' />
          Purge all cache
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title='Purge all cache?'
        desc={
          <div className='space-y-2'>
            <p>
              This purges every cache for this website — the admin panel and
              the customer storefront. The site will be slower for a bit
              while the caches rebuild.
            </p>
            <p>
              This cannot clear the cache on any specific phone or browser
              directly. Instead it bumps the cache version, so every device
              loads fresh on its next visit.
            </p>
          </div>
        }
        confirmText='Purge all cache'
        destructive
        isLoading={purgeMut.isPending}
        handleConfirm={() => purgeMut.mutate()}
      />

      <Dialog open={result !== null} onOpenChange={(open) => { if (!open) setResult(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {failedLayers.length > 0
                ? 'Cache purge finished with problems'
                : 'Cache purged'}
            </DialogTitle>
            <DialogDescription>
              {failedLayers.length > 0
                ? 'Some layers could not be purged. The layers below show what actually happened.'
                : 'Every layer below shows what actually happened.'}
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className='space-y-3'>
              {PURGE_LAYER_ORDER.map((key) => {
                const layer = result.layers[key]
                const meta = LAYER_STATUS_META[layer.status]
                return (
                  <div key={key} className='space-y-1'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='text-sm font-medium'>
                        {PURGE_LAYER_LABELS[key]}
                      </span>
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </div>
                    <p className='text-sm text-muted-foreground'>{layer.detail}</p>
                  </div>
                )
              })}
              {notConfiguredLayers.length > 0 && (
                <p className='text-sm text-muted-foreground'>
                  A layer marked “Not configured” needs an owner-side step
                  before it can be purged — see its note above.
                </p>
              )}
              <p className='text-sm text-muted-foreground'>
                Devices that still show old pages are running a cached copy
                from before this purge — they will load fresh on their next
                visit. If a phone still shows the old version, close its
                admin tabs completely and reopen them.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setResult(null)}>
              Close
            </Button>
            <Button onClick={() => window.location.reload()}>
              Reload this page now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
