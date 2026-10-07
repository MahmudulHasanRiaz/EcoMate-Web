'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, KeyRound, Loader2, RotateCcw, Search } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * GET /permissions/catalogue — the backend is the single source of truth for
 * what can be granted. A copy of the list baked into the frontend silently
 * drifts: keys added server-side stay ungrantable, keys removed here keep
 * being offered and are then stripped by `sanitizePermissions` (the preset
 * looks granted but grants nothing). So nothing is hardcoded below.
 */
export type CataloguePermission = { key: string; label: string }

export type CatalogueGroup = {
  key: string
  label: string
  group: string
  /** License feature gating the module, or null when the module is ungated. */
  feature: string | null
  permissions: CataloguePermission[]
}

export type PermissionCatalogue = {
  groups: CatalogueGroup[]
  total: number
}

async function fetchCatalogue(): Promise<PermissionCatalogue> {
  const { data } = await apiClient.get<PermissionCatalogue>('/permissions/catalogue')
  // Defensive: a malformed payload must not render as "grant nothing".
  return {
    groups: Array.isArray(data?.groups) ? data.groups : [],
    total: typeof data?.total === 'number' ? data.total : 0,
  }
}

const CATALOGUE_QUERY = {
  queryKey: ['permissions', 'catalogue'] as const,
  queryFn: fetchCatalogue,
  // The catalogue only changes with a backend deploy, which also reloads the
  // admin bundle. Refetching it on every dialog open is pure latency.
  staleTime: 5 * 60 * 1000,
}

type PermissionCheckboxMatrixProps = {
  selected: string[]
  onChange: (permissions: string[]) => void
}

export function PermissionCheckboxMatrix({ selected, onChange }: PermissionCheckboxMatrixProps) {
  const [search, setSearch] = useState('')
  const [openModules, setOpenModules] = useState<Set<string> | null>(null)

  const { data, isPending, isError, refetch } = useQuery(CATALOGUE_QUERY)

  const groups = useMemo(() => data?.groups ?? [], [data])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const matches = useMemo(
    () => (p: CataloguePermission) =>
      search.trim().length === 0 ||
      p.key.toLowerCase().includes(search.trim().toLowerCase()) ||
      p.label.toLowerCase().includes(search.trim().toLowerCase()),
    [search],
  )

  const filtered = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, permissions: g.permissions.filter(matches) }))
        .filter((g) => g.permissions.length > 0),
    [groups, matches],
  )

  /** Keys the backend actually recognises — the only ones we may ever emit. */
  const catalogueKeys = useMemo(
    () => new Set(groups.flatMap((g) => g.permissions.map((p) => p.key))),
    [groups],
  )

  const selectedCount = selected.filter((key) => catalogueKeys.has(key)).length

  // Flat render order of the currently visible permissions — the axis a
  // shift-click range is measured along. Rebuilt on every search/filter change.
  const flatKeys = useMemo(
    () => filtered.flatMap((g) => g.permissions.map((p) => p.key)),
    [filtered],
  )
  const lastIndexRef = useRef<number | null>(null)

  // A new search reorders the list, so a stale anchor would span the wrong
  // range. Reset it whenever the visible order changes.
  useEffect(() => {
    lastIndexRef.current = null
  }, [flatKeys])

  function emit(next: Set<string>) {
    onChange(Array.from(next))
  }

  function togglePermission(key: string) {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    emit(next)
    lastIndexRef.current = flatKeys.indexOf(key)
  }

  /**
   * Shift-click range: click one permission, shift-click another, and every
   * visible permission between the two is selected in those two clicks (or
   * deselected when the whole range is already on — same toggle semantics as
   * a single click). Wired to `onClickCapture` on the row so it runs before
   * the checkbox's own toggle and can swallow it via stopPropagation.
   */
  function selectRange(toKey: string) {
    const to = flatKeys.indexOf(toKey)
    if (to === -1) return
    const from = lastIndexRef.current ?? to
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    const slice = flatKeys.slice(lo, hi + 1)
    const allOn = slice.every((k) => selectedSet.has(k))
    const next = new Set(selected)
    for (const k of slice) {
      if (allOn) next.delete(k)
      else next.add(k)
    }
    emit(next)
    lastIndexRef.current = to
  }

  function handleRowClickCapture(e: React.MouseEvent, key: string) {
    if (!e.shiftKey) return
    e.preventDefault()
    e.stopPropagation()
    selectRange(key)
  }

  /** Tri-state per module: select all, deselect all, or fill the gaps. */
  function toggleModule(keys: string[]) {
    const allSelected = keys.every((k) => selectedSet.has(k))
    const next = new Set(selected)
    for (const key of keys) {
      if (allSelected) next.delete(key)
      else next.add(key)
    }
    emit(next)
    if (keys.length > 0) lastIndexRef.current = flatKeys.indexOf(keys[keys.length - 1])
  }

  // A search always reveals its matches; otherwise respect the manual toggle
  // and fall back to expanded for the short list, collapsed for the full 67.
  const isOpen = (key: string, isSearching: boolean) =>
    isSearching ? true : openModules ? openModules.has(key) : groups.length <= 10

  function setModuleOpen(key: string, open: boolean) {
    setOpenModules((prev) => {
      const next = new Set(prev ?? groups.map((g) => g.key))
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }

  if (isPending) {
    return (
      <div className='flex items-center justify-center gap-2 rounded-lg border py-10 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' />
        Loading permissions…
      </div>
    )
  }

  // An empty matrix reads as "this role has no permissions" — an admin would
  // happily save that. Fail loudly instead and let them retry.
  if (isError) {
    return (
      <div className='flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-10 text-center'>
        <AlertTriangle className='size-5 text-destructive' />
        <p className='text-sm font-medium'>Could not load the permission catalogue.</p>
        <p className='max-w-sm text-xs text-muted-foreground'>
          Saving now would strip every permission, so the list is unavailable until this succeeds.
        </p>
        <Button type='button' variant='outline' size='sm' onClick={() => refetch()}>
          <RotateCcw className='size-3.5' /> Retry
        </Button>
      </div>
    )
  }

  const isSearching = search.trim().length > 0

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-[200px] flex-1'>
          <Search className='absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            aria-label='Search permissions'
            placeholder='Search permissions…'
            className='pl-8'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className='text-xs font-medium tabular-nums text-muted-foreground'>
          [{selectedCount}/{data?.total ?? 0} selected]
        </span>
        <span className='text-[11px] text-muted-foreground'>Tip: Shift+click selects a range</span>
      </div>

      {filtered.length === 0 ? (
        <p className='rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground'>
          No permissions match “{search.trim()}”.
        </p>
      ) : (
        <div className='max-h-[380px] space-y-2 overflow-y-auto rounded-lg border p-2'>
          {filtered.map((module) => {
            const keys = module.permissions.map((p) => p.key)
            const allSelected = keys.every((k) => selectedSet.has(k))
            const someSelected = keys.some((k) => selectedSet.has(k))
            const open = isOpen(module.key, isSearching)

            return (
              <Collapsible
                key={module.key}
                open={open}
                onOpenChange={(o) => setModuleOpen(module.key, o)}
                className='rounded-lg border bg-card'
              >
                <div className='flex items-center gap-2 px-3 py-2'>
                  <Checkbox
                    id={`select-all-${module.key}`}
                    aria-label={`Select all ${module.label} permissions`}
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={() => toggleModule(keys)}
                  />
                  <Label
                    htmlFor={`select-all-${module.key}`}
                    className='cursor-pointer text-sm font-semibold'
                  >
                    {module.label}
                  </Label>
                  {module.feature && (
                    <Badge
                      variant='info'
                      className='gap-1 font-mono text-[10px]'
                      title='This module also requires a licence feature'
                    >
                      <KeyRound className='size-2.5' />
                      {module.feature}
                    </Badge>
                  )}
                  <span className='ml-auto text-xs tabular-nums text-muted-foreground'>
                    {keys.filter((k) => selectedSet.has(k)).length}/{keys.length}
                  </span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-xs text-muted-foreground'
                    onClick={() => toggleModule(keys)}
                  >
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </Button>
                  <CollapsibleTrigger asChild>
                    <Button type='button' variant='ghost' size='icon' className='size-7 shrink-0'>
                      <ChevronDown
                        className={cn('size-4 transition-transform', !open && '-rotate-90')}
                      />
                      <span className='sr-only'>Toggle {module.label}</span>
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className='grid gap-2 border-t px-3 py-3 sm:grid-cols-2'>
                    {module.permissions.map((perm) => (
                      <div
                        key={perm.key}
                        className='flex items-start gap-2'
                        onClickCapture={(e) => handleRowClickCapture(e, perm.key)}
                      >
                        <Checkbox
                          id={perm.key}
                          className='mt-0.5'
                          checked={selectedSet.has(perm.key)}
                          onCheckedChange={() => togglePermission(perm.key)}
                        />
                        <Label htmlFor={perm.key} className='cursor-pointer leading-snug'>
                          <span className='block text-sm'>{perm.label}</span>
                          <span className='block font-mono text-[10px] text-muted-foreground'>
                            {perm.key}
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      )}
    </div>
  )
}