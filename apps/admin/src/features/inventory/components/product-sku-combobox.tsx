'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Html5Qrcode, type CameraDevice } from 'html5-qrcode'
import { pickDefaultCamera } from '@/features/camera/camera-controller'
import { useCameraSession } from '@/features/camera/use-camera-session'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SafeImage } from '@/components/safe-image'
import { cn, mediaUrl } from '@/lib/utils'
import { AlertCircle, Loader2, Package, ScanLine, Search, X } from 'lucide-react'

/**
 * One selectable stock unit, straight off `GET /inventory/product-lookup`.
 * `variantId` is null for a simple product and always set for a variable one.
 * `image` is the product's first image (may be null → Package fallback).
 */
export interface LookupRow {
  productId: string
  productName: string
  variantId: string | null
  variantName: string | null
  sku: string | null
  type: 'product' | 'variant'
  available: number
  image?: string | null
}

export interface LookupResponse {
  data: LookupRow[]
  meta: { total: number; perPage: number; hasMore?: boolean }
}

const LOOKUP_PER_PAGE = 25

/**
 * 300ms of client-side debounce. The lookup does one narrow indexed query
 * (name OR product SKU OR variant SKU) plus ONE grouped physical-stock
 * aggregate — but a warehouse typist averages ~200wpm, so without this every
 * keystroke would still be a round trip and a re-render of the whole list.
 */
const LOOKUP_DEBOUNCE_MS = 300

/**
 * Gap between keystrokes above which a keydown burst is treated as a NEW scan
 * rather than a continuation. Same 200ms threshold the packing station uses.
 */
const WEDGE_GAP_MS = 200


function errorMessage(err: unknown): string {
  const raw =
    (err as any)?.response?.data?.message ?? (err as Error)?.message ?? 'Unknown error'
  return Array.isArray(raw) ? raw.join('\n') : String(raw)
}

function rowKey(row: LookupRow): string {
  return `${row.productId}:${row.variantId ?? ''}`
}

interface ProductSkuComboboxProps {
  selected: LookupRow | null
  onSelect: (row: LookupRow | null) => void
  warehouseId?: string
  placeholder?: string
  label?: string
  className?: string
  /** Hide the availability badge (e.g. hydrated edit rows whose on-hand is unknown). */
  hideAvailability?: boolean
}

/**
 * Scan-to-select product picker for stock transfers, presented like the
 * order-create smart search: an h-11 search input with an in-flow rich
 * dropdown (thumbnail, SKU chip, availability) instead of a Popover+cmdk
 * combobox. The popover escaped the dialog on narrow screens (one side of the
 * modal rendered cut off); an absolute panel inside the dialog flow cannot.
 *
 * Server contract (unchanged): the list is variant-level from the API and a
 * variable product is only ever offered as its individual variants — never
 * as a selectable parent. No client-side filtering happens here at all.
 */
export function ProductSkuCombobox({
  selected,
  onSelect,
  warehouseId,
  placeholder = 'Type name or SKU, or scan a barcode...',
  label = 'Product',
  className,
  hideAvailability = false,
}: ProductSkuComboboxProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // ── Camera scan ────────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState('')
  // Decoded text is matched against `rows`, which arrives from the query one
  // render later than the camera callback — read it through a ref.
  const rowsRef = useRef<LookupRow[]>([])
  // Keeps the camera on for the case where the decoded code is not in the
  // current page of results yet; stops as soon as a row has been selected.
  const heldRef = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), LOOKUP_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input])

  // Typing opens the panel; clearing the input closes it. (Order-create parity:
  // the dropdown is driven by the search text, not by a separate trigger.)
  useEffect(() => {
    if (input.trim().length > 0) setOpen(true)
    else setOpen(false)
  }, [input])

  // Outside click closes the panel (order-create parity).
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const term = debounced

  const { data, isFetching, isError, error } = useQuery<LookupResponse>({
    // `placeholderData` keeps the previous page visible while the next one
    // loads instead of flashing "No product found." on every keystroke.
    placeholderData: (prev) => prev,
    queryKey: ['inventory-product-lookup', term, warehouseId ?? ''],
    queryFn: () =>
      apiClient
        .get<LookupResponse>('/inventory/product-lookup', {
          params: {
            q: term,
            perPage: LOOKUP_PER_PAGE,
            ...(warehouseId ? { warehouseId } : {}),
          },
        })
        .then((r) => r.data),
    enabled: term.length > 0,
    retry: false,
  })

  const rows = useMemo(() => data?.data ?? [], [data])
  // Backend sends `hasMore` when the row cap cut the list short; fall back to
  // a full page (older builds only sent total == rows.length, always false).
  const truncated = (data?.meta as any)?.hasMore ?? ((data?.meta?.total ?? 0) > rows.length || rows.length >= LOOKUP_PER_PAGE)

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const reset = useCallback(() => {
    setInput('')
    setDebounced('')
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    heldRef.current = false
    reset()
  }, [reset])

  /** Pick the row whose SKU is EXACTLY `code`; never a near-match. */
  const selectByCode = useCallback(
    (code: string) => {
      const hit = rowsRef.current.find(
        (r) => !!r.sku && r.sku.toLowerCase() === code.toLowerCase(),
      )
      if (hit) {
        onSelect(hit)
        close()
        return true
      }
      return false
    },
    [onSelect, close],
  )

  // ── Camera lifecycle ───────────────────────────────────────────────────────
  // ONE shared camera session for the whole admin. The decode handler is read
  // from a ref by the session, so a new callback identity never restarts the
  // camera (the old per-component lifecycle did exactly that).
  // When the decoded code is not on the current result page yet, the lookup
  // for that exact code is fired and `heldRef` keeps the camera on — the
  // auto-pick effect below selects the row as soon as it lands, so one scan
  // is enough (the backend's exact-SKU phase guarantees the hit is on page 1).
  const cameraSession = useCameraSession({
    active: scanning && !!cameraId,
    cameraId,
    onScan: (decodedText) => {
      const code = decodedText.trim()
      if (!code) return
      if (selectByCode(code)) return
      // Not in the current result page: show it, let the operator scan
      // again once the lookup for that exact code has landed.
      setInput(code)
      setDebounced(code)
      heldRef.current = true
    },
    fps: 15,
    qrboxHeightRatio: 0.7,
  })

  // The device list is only needed to pick a source — the session itself
  // never depends on it.
  useEffect(() => {
    if (!scanning) return
    let cancelled = false
    Html5Qrcode.getCameras()
      .then((devices: CameraDevice[]) => {
        if (cancelled) return
        const id = pickDefaultCamera(devices ?? [])
        if (!id) {
          setScanError('No cameras detected on this device.')
          return
        }
        setCameraId(id)
      })
      .catch(() => {
        if (!cancelled) setScanError('Camera permission denied or unavailable.')
      })
    return () => {
      cancelled = true
    }
  }, [scanning])

  // Release the camera as soon as a row is chosen from anywhere (list or scan).
  useEffect(() => {
    if (selected) setScanning(false)
  }, [selected])

  // A camera scan for a code that was not on the current page fires a lookup
  // for that exact code (`heldRef`). Auto-pick the row the moment it lands —
  // no second scan needed.
  useEffect(() => {
    if (!heldRef.current || rows.length === 0) return
    const code = debounced.trim()
    if (!code) return
    const hit = rows.find((r) => !!r.sku && r.sku.toLowerCase() === code.toLowerCase())
    if (hit) {
      onSelect(hit)
      setOpen(false)
      heldRef.current = false
      reset()
    }
  }, [rows, debounced, onSelect, reset])

  // Typing (or wedge-scanning) a full SKU into the picker input and pressing
  // Enter auto-selects the exact match. This is what makes a USB/keyboard-wedge
  // scanner work: the wedge types the code into the focused input and presses
  // Enter, and the operator typing a code by hand gets the same one-keystroke
  // commit instead of having to find the row with the mouse.
  const commitExactInput = useCallback(() => {
    const code = input.trim()
    if (!code) return false
    return selectByCode(code)
  }, [input, selectByCode])

  // ── USB / keyboard-wedge scanner (focus NOT in a text field) ───────────────
  // A wedge scanner types the code into whatever has focus and then presses
  // Enter. When focus is inside a text field the keystrokes already land in
  // the picker input (handled by `commitExactInput` on Enter), so this global
  // listener only covers the focus-elsewhere case — e.g. the modal body or the
  // trigger button has focus. Keying off the buffer gap (not the key count):
  // a fast wedge burst stays in one buffer while normal typing resets it.
  // Works BEFORE any product is chosen: scanning is how the product gets
  // chosen in the first place.
  const selectRef = useRef(selectByCode)
  selectRef.current = selectByCode

  useEffect(() => {
    let buffer = ''
    let lastKeyTime = Date.now()

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Keystrokes inside a text field belong to that field — the picker's own
      // input commits them via Enter (see `commitExactInput`). Swallow here so
      // a scan typed into the input is not double-handled.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        buffer = ''
        return
      }

      const now = Date.now()
      if (now - lastKeyTime > WEDGE_GAP_MS) buffer = ''
      lastKeyTime = now

      if (e.key === 'Enter') {
        const code = buffer.trim()
        buffer = ''
        if (code) selectRef.current(code)
      } else if (e.key.length === 1) {
        buffer += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const showPanel = open && term.length > 0

  const thumb = (row: LookupRow) =>
    row.image ? (
      <SafeImage
        src={mediaUrl(row.image)}
        alt=''
        className='h-11 w-11 rounded-lg border object-cover shrink-0'
        thumbWidth={48}
        thumbHeight={48}
      />
    ) : (
      <div className='h-11 w-11 rounded-lg border bg-muted flex items-center justify-center shrink-0'>
        <Package className='h-5 w-5 text-muted-foreground' />
      </div>
    )

  return (
    <div className={cn('space-y-2', className)} ref={wrapRef}>
      <Label>{label}</Label>

      {/* Selected stock unit — order-create cart-row styling. */}
      {selected && (
        <div className='flex items-center gap-3 rounded-xl border bg-muted/30 p-2.5 sm:p-3'>
          {thumb(selected)}
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-semibold text-foreground truncate'>
              {selected.productName}
              {selected.variantName && (
                <span className='font-normal text-muted-foreground'> — {selected.variantName}</span>
              )}
            </p>
            <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
              {selected.sku ? (
                <span className='text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                  {selected.sku}
                </span>
              ) : (
                <span className='text-[11px] italic text-muted-foreground'>no SKU</span>
              )}
              {!hideAvailability && (
                <Badge
                  variant='outline'
                  className={cn(
                    'text-[10px] h-4.5 font-normal',
                    selected.available > 0
                      ? 'border-emerald-500/30 text-emerald-600'
                      : 'border-destructive/30 text-destructive',
                  )}
                >
                  {selected.available} available
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant='ghost'
            size='icon'
            aria-label='Clear product'
            className='h-8 w-8 shrink-0 cursor-pointer'
            onClick={() => {
              onSelect(null)
              reset()
            }}
          >
            <X className='h-4 w-4' />
          </Button>
        </div>
      )}

      {/* Smart search bar — order-create parity (h-11, icon, spinner/clear). */}
      <div className='relative'>
        <div className='relative flex items-center gap-2'>
          <div className='relative flex-1'>
            <Search className='absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10' />
            <input
              type='text'
              role='combobox'
              aria-expanded={showPanel}
              aria-label={label}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => {
                if (rows.length > 0) setOpen(true)
              }}
              onKeyDown={(e) => {
                // Enter commits an EXACT SKU only — never the first row.
                // Typing a parent SKU like "SHIRT" and hitting Enter must not
                // silently grab SHIRT-S; it keeps filtering until the operator
                // picks a variant explicitly.
                if (e.key === 'Enter' && input.trim()) {
                  e.preventDefault()
                  commitExactInput()
                }
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder={placeholder}
              autoComplete='off'
              className='w-full h-11 pl-10 pr-10 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring shadow-2xs'
            />
            {isFetching ? (
              <Loader2 className='absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />
            ) : input ? (
              <button
                type='button'
                aria-label='Clear search'
                onClick={() => {
                  reset()
                  setOpen(false)
                }}
                className='absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer'
              >
                <X className='h-4 w-4' />
              </button>
            ) : null}
          </div>
          <Button
            variant='outline'
            size='icon'
            aria-label='Scan barcode'
            title='Scan barcode'
            className='h-11 w-11 shrink-0 rounded-xl cursor-pointer'
            onClick={() => setScanning((s) => !s)}
          >
            <ScanLine className={cn('h-4 w-4', scanning && 'text-primary')} />
          </Button>
        </div>

        {/* Rich dropdown — in-flow absolute panel (never escapes the dialog). */}
        {showPanel && (
          <div className='absolute z-30 mt-1.5 w-full bg-background border rounded-xl shadow-xl overflow-hidden'>
            <div className='px-3.5 py-2 bg-muted/40 border-b flex items-center justify-between text-xs text-muted-foreground'>
              {isError ? (
                <span className='text-destructive'>Lookup failed. {errorMessage(error)}</span>
              ) : (
                <>
                  <span>
                    {rows.length} match{rows.length === 1 ? '' : 'es'}
                    {isFetching ? ' — searching…' : ''}
                  </span>
                  <span className='text-[11px] hidden sm:inline'>Exact SKU + Enter selects</span>
                </>
              )}
            </div>
            {rows.length > 0 ? (
              <div className='max-h-72 sm:max-h-80 overflow-y-auto divide-y divide-border/50'>
                {rows.map((row) => (
                  <div
                    key={rowKey(row)}
                    role='option'
                    aria-selected={!!selected && rowKey(selected) === rowKey(row)}
                    data-sku={row.sku ?? ''}
                    data-variant-id={row.variantId ?? ''}
                    onClick={() => {
                      onSelect(row)
                      close()
                    }}
                    className='w-full p-2.5 sm:p-3 hover:bg-muted/60 transition-colors flex items-center gap-3 cursor-pointer'
                  >
                    {thumb(row)}
                    <div className='min-w-0 flex-1'>
                      <p className='text-sm font-semibold text-foreground line-clamp-2 leading-snug'>
                        {row.productName}
                        {row.variantName && (
                          <span className='font-normal text-muted-foreground'> — {row.variantName}</span>
                        )}
                      </p>
                      <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
                        {row.sku ? (
                          <span className='text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                            {row.sku}
                          </span>
                        ) : (
                          <span className='text-[11px] italic text-muted-foreground'>no SKU</span>
                        )}
                        {row.variantId && (
                          <Badge variant='outline' className='text-[10px] h-4.5 font-normal border-primary/30 text-primary'>
                            Variant
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className='text-right shrink-0'>
                      <div
                        className={cn(
                          'text-sm font-bold',
                          row.available > 0 ? 'text-emerald-600' : 'text-destructive',
                        )}
                      >
                        {row.available}
                      </div>
                      <div className='text-[10px] text-muted-foreground'>avail.</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !isFetching && (
                <div className='px-3.5 py-6 text-center text-sm text-muted-foreground'>
                  {term ? 'No products found.' : 'Type a name or SKU, or scan a barcode.'}
                </div>
              )
            )}
            {truncated && rows.length > 0 && (
              <div className='px-3.5 py-2 bg-muted/40 border-t text-[11px] text-muted-foreground'>
                Showing the first {rows.length} matches — keep typing to narrow it down.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Camera scanner — in-flow block under the search bar. */}
      {scanning && (
        <div className='rounded-xl border p-2'>
          {/* The shared session owns this container — React never remounts it,
              so the camera feed survives every re-render. */}
          <div
            ref={cameraSession.containerRef}
            id={cameraSession.containerId}
            className='relative min-h-24 w-full overflow-hidden rounded-md'
          />
          {isFetching && (
            <p className='mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground'>
              <Loader2 className='h-3 w-3 animate-spin' /> Looking up scanned code…
            </p>
          )}
          {(scanError ?? cameraSession.error) && (
            <p className='mt-1 text-center text-xs text-destructive'>{scanError ?? cameraSession.error}</p>
          )}
          <button
            type='button'
            className='mt-1 w-full text-center text-xs text-muted-foreground underline cursor-pointer'
            onClick={() => setScanning(false)}
          >
            Stop camera
          </button>
        </div>
      )}

      {selected?.variantId && (
        <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <Package className='h-3 w-3' />
          Variant selected — transfers apply to this variant&apos;s stock only.
        </p>
      )}
    </div>
  )
}