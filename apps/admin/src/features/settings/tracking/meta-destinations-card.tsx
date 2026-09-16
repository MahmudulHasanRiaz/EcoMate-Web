import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Radio, Trash2, Undo2 } from 'lucide-react'

/**
 * Step 3 — Meta destination editor (multiple Pixels + their CAPI credentials).
 *
 * Model rules enforced by the server (`validateMetaDestinations`) and mirrored here
 * so the UI fails fast with the same reasons:
 *  - `id` is an immutable identity and is NEVER reused. Removing a destination is a
 *    SOFT delete (`removedAt`), so historical dispatch rows keep resolving to the
 *    destination they were delivered to. A removed entry is kept in the array and
 *    can be restored; a new pixel must be added as a NEW destination.
 *  - a live destination needs a `pixelId`; an ENABLED destination needs a token.
 *  - at most 10 destinations.
 *
 * SECRETS: the API never returns access tokens. `accessToken` comes back empty with
 * `hasAccessToken: true`, and an empty token submitted on save means "keep the
 * stored credential" — so editing a label or pixel id never wipes a working token.
 */

export interface MetaDestinationDraft {
  id: string
  label: string
  pixelId: string
  accessToken: string
  hasAccessToken?: boolean
  enabled: boolean
  browserPixelEnabled: boolean
  testEventCode: string
  testMode: boolean
  createdAt?: string
  updatedAt?: string
  removedAt?: string | null
}

export const MAX_META_DESTINATIONS = 10

const DESTINATION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Slug-safe, immutable id for a newly added destination. */
function newDestinationId(existing: MetaDestinationDraft[]): string {
  const taken = new Set(existing.map((d) => d.id))
  // Deterministic fallback chain so a collision can never silently reuse an id
  // (which would repoint historical deliveries).
  for (let i = 0; i < 500; i++) {
    const candidate = `pixel-${Math.random().toString(36).slice(2, 8)}`
    if (!taken.has(candidate) && DESTINATION_ID_RE.test(candidate)) return candidate
  }
  return `pixel-${Date.now().toString(36)}`
}

/**
 * True when the stored array holds at least one destination entry (live,
 * disabled, or soft-removed). The server ignores the legacy single-pixel
 * fields whenever the array is non-empty, so the settings page uses this to
 * decide when the legacy card becomes fallback-only.
 */
export function hasConfiguredDestinations(raw: string | undefined | null): boolean {
  return parseDestinations(raw).length > 0
}

export function parseDestinations(raw: string | undefined | null): MetaDestinationDraft[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      // NOTE: no `!d.__proto__` guard here — every plain object inherits
      // Object.prototype (truthy), so that check dropped ALL entries and the
      // card never displayed stored destinations. The map below builds a fresh
      // literal with explicit fields, so a malicious `__proto__` key in the
      // stored JSON cannot pollute anything.
      .filter((d) => d && typeof d === 'object')
      .map((d: any) => ({
        id: String(d.id ?? ''),
        label: String(d.label ?? ''),
        pixelId: String(d.pixelId ?? ''),
        accessToken: String(d.accessToken ?? ''),
        hasAccessToken: !!d.hasAccessToken,
        enabled: d.enabled !== false,
        browserPixelEnabled: d.browserPixelEnabled !== false,
        testEventCode: String(d.testEventCode ?? ''),
        testMode: d.testMode === true,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        removedAt: d.removedAt ?? null,
      }))
      .filter((d) => DESTINATION_ID_RE.test(d.id))
  } catch {
    return []
  }
}

/** Client-side mirror of the server rules; the server is still authoritative. */
export function validateDrafts(drafts: MetaDestinationDraft[]): string[] {
  const errors: string[] = []
  if (drafts.length > MAX_META_DESTINATIONS) {
    errors.push(`At most ${MAX_META_DESTINATIONS} Meta destinations are allowed`)
  }
  const seen = new Set<string>()
  for (const d of drafts) {
    if (!DESTINATION_ID_RE.test(d.id)) {
      errors.push(`Destination id "${d.id}" is not a valid immutable id`)
    }
    if (seen.has(d.id)) {
      errors.push(`Duplicate destination id "${d.id}" — ids are never reused`)
    }
    seen.add(d.id)
    if (d.removedAt) continue
    if (!d.pixelId.trim()) errors.push(`"${d.label || d.id}": pixel id is required`)
    if (d.enabled && !d.accessToken.trim() && !d.hasAccessToken) {
      errors.push(`"${d.label || d.id}": access token is required when enabled`)
    }
  }
  return errors
}

interface Props {
  raw: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
}

export function MetaDestinationsCard({ raw, onChange, disabled }: Props) {
  const initial = useMemo(() => parseDestinations(raw), [raw])
  const [drafts, setDrafts] = useState<MetaDestinationDraft[]>(initial)
  const [errors, setErrors] = useState<string[]>([])

  // Re-seed when the server value changes (e.g. after a save refetch). Keyed on the
  // raw string so an in-progress edit is not clobbered by an unrelated re-render.
  const [seed, setSeed] = useState(raw)
  if (raw !== seed && !disabled) {
    // Only reseed when the drafts are in their pristine (unmodified) state.
    if (JSON.stringify(drafts) === JSON.stringify(parseDestinations(seed))) {
      const fresh = parseDestinations(raw)
      setSeed(raw)
      setDrafts(fresh)
      // Recompute: errors from the pre-save drafts must not linger once the
      // server value is adopted (e.g. a just-saved destination is valid, but a
      // stored token comes back masked as hasAccessToken — both validate clean).
      setErrors(validateDrafts(fresh))
    }
  }

  const update = (index: number, patch: Partial<MetaDestinationDraft>) => {
    setDrafts((prev) => {
      const next = prev.map((d, i) => (i === index ? { ...d, ...patch } : d))
      onChange(JSON.stringify(next))
      setErrors(validateDrafts(next))
      return next
    })
  }

  const addDestination = () => {
    if (drafts.length >= MAX_META_DESTINATIONS) return
    const now = new Date().toISOString()
    const next = [
      ...drafts,
      {
        id: newDestinationId(drafts),
        label: `Pixel ${drafts.filter((d) => !d.removedAt).length + 1}`,
        pixelId: '',
        accessToken: '',
        hasAccessToken: false,
        enabled: true,
        browserPixelEnabled: true,
        testEventCode: '',
        testMode: false,
        createdAt: now,
        updatedAt: now,
        removedAt: null,
      },
    ]
    setDrafts(next)
    onChange(JSON.stringify(next))
    setErrors(validateDrafts(next))
  }

  const removeDestination = (index: number) => {
    // SOFT delete — the id is kept so historical dispatch rows keep resolving.
    update(index, { removedAt: new Date().toISOString(), enabled: false })
  }

  const restoreDestination = (index: number) => {
    update(index, { removedAt: null, enabled: true })
  }

  return (
    <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
      <CardHeader className='pb-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2 mb-1'>
            <Radio className='h-5 w-5 text-primary' />
            <CardTitle className='text-xl'>Meta Destinations (Pixels)</CardTitle>
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={addDestination}
            disabled={disabled || drafts.length >= MAX_META_DESTINATIONS}
          >
            <Plus className='h-4 w-4 mr-1' /> Add Destination
          </Button>
        </div>
        <CardDescription>
          Each destination is one Meta Pixel/dataset with its own Conversions API access token.
          A single business event (for example one Purchase) is delivered to every enabled
          destination using the same canonical event ID, so each dataset deduplicates its own
          browser and server copy. Access tokens are stored server-side and are never sent to the
          storefront.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {drafts.length === 0 && (
          <p className='text-sm text-muted-foreground'>
            No destinations configured. Meta delivery falls back to the legacy single-pixel
            settings until a destination is added.
          </p>
        )}

        {drafts.map((d, index) => (
          <div
            key={d.id}
            className={`rounded-lg border p-4 space-y-3 ${d.removedAt ? 'opacity-60 border-dashed' : ''}`}
          >
            <div className='flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2'>
                <span className='font-mono text-xs text-muted-foreground'>{d.id}</span>
                {d.removedAt ? (
                  <Badge variant='secondary'>Removed</Badge>
                ) : d.enabled ? (
                  <Badge>Enabled</Badge>
                ) : (
                  <Badge variant='secondary'>Disabled</Badge>
                )}
              </div>
              {d.removedAt ? (
                <Button type='button' variant='ghost' size='sm' onClick={() => restoreDestination(index)} disabled={disabled}>
                  <Undo2 className='h-4 w-4 mr-1' /> Restore
                </Button>
              ) : (
                <Button type='button' variant='ghost' size='sm' onClick={() => removeDestination(index)} disabled={disabled}>
                  <Trash2 className='h-4 w-4 mr-1' /> Remove
                </Button>
              )}
            </div>

            {d.removedAt ? (
              <p className='text-xs text-muted-foreground'>
                Removed destinations keep their identity so historical delivery records stay
                readable. In-flight events for this destination are recorded as skipped.
                The id cannot be reused — add a new destination to re-enable this pixel.
              </p>
            ) : (
              <>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label>Label</Label>
                    <Input
                      value={d.label}
                      onChange={(e) => update(index, { label: e.target.value })}
                      placeholder='Main Pixel'
                      disabled={disabled}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Pixel ID</Label>
                    <Input
                      value={d.pixelId}
                      onChange={(e) => update(index, { pixelId: e.target.value.trim() })}
                      placeholder='123456789012345'
                      disabled={disabled}
                    />
                    <p className='text-xs text-muted-foreground'>
                      Changing this targets a different dataset — add a new destination instead.
                    </p>
                  </div>
                </div>

                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label>Access Token</Label>
                    <Input
                      type='password'
                      value={d.accessToken}
                      onChange={(e) => update(index, { accessToken: e.target.value })}
                      placeholder={d.hasAccessToken ? '•••••••• (stored)' : 'EAA...'}
                      disabled={disabled}
                    />
                    <p className='text-xs text-muted-foreground'>
                      {d.hasAccessToken
                        ? 'A token is stored. Leave blank to keep it.'
                        : 'Required when the destination is enabled.'}
                    </p>
                  </div>
                  <div className='space-y-2'>
                    <Label>Test Event Code</Label>
                    <Input
                      value={d.testEventCode}
                      onChange={(e) => update(index, { testEventCode: e.target.value.trim() })}
                      placeholder='TEST12345'
                      disabled={disabled}
                    />
                  </div>
                </div>

                <div className='grid gap-3 sm:grid-cols-3'>
                  <div className='flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2'>
                    <Label className='text-sm'>Enabled</Label>
                    <Switch
                      checked={d.enabled}
                      onCheckedChange={(v) => update(index, { enabled: v })}
                      disabled={disabled}
                    />
                  </div>
                  <div className='flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2'>
                    <Label className='text-sm'>Browser Pixel</Label>
                    <Switch
                      checked={d.browserPixelEnabled}
                      onCheckedChange={(v) => update(index, { browserPixelEnabled: v })}
                      disabled={disabled}
                    />
                  </div>
                  <div className='flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2'>
                    <Label className='text-sm'>Test Mode</Label>
                    <Switch
                      checked={d.testMode}
                      onCheckedChange={(v) => update(index, { testMode: v })}
                      disabled={disabled}
                    />
                  </div>
                </div>
                <p className='text-xs text-muted-foreground'>
                  The test event code is only sent when Test Mode is on, so a leftover code can
                  never reach production traffic.
                </p>
              </>
            )}
          </div>
        ))}

        {errors.length > 0 && (
          <div className='rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
            <ul className='list-disc pl-5 text-xs text-destructive space-y-1'>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
