'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Html5Qrcode, type CameraDevice } from 'html5-qrcode'
import {
  createScanner,
  pickDefaultCamera,
  type ScannerController,
} from '@/features/packing/scanner-controller'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { AlertCircle, Check, ChevronsUpDown, Loader2, Package, ScanLine, X } from 'lucide-react'

/**
 * One selectable stock unit, straight off `GET /inventory/product-lookup`.
 * `variantId` is null for a simple product and always set for a variable one.
 */
export interface LookupRow {
  productId: string
  productName: string
  variantId: string | null
  variantName: string | null
  sku: string | null
  type: 'product' | 'variant'
  available: number
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

/** The scanner attaches its <video> to this id; html5-qrcode requires a real node. */
const SCANNER_ELEMENT_ID = 'product-sku-combobox-scanner'

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
}

/**
 * Scan-to-select product picker for stock transfers.
 *
 * Two things this replaces, both of which were broken in the transfers modal:
 *  1. A `<Command>` without `shouldFilter={false}` while every `CommandItem` had
 *     `value={p.id}` (a UUID). cmdk then re-filtered the already-server-filtered
 *     list against the UUID, so typing "sock" matched nothing and the picker was
 *     permanently "No product found."
 *  2. A bare `GET /products` search that returned a variable product's PARENT
 *     (blank SKU, null `Product.sku`) as a selectable row, leaving the user to
 *     hand-pick a variant afterwards.
 *
 * Here the list is variant-level from the API, filtering stays with the server
 * (`shouldFilter={false}`), and a variable product is only ever offered as its
 * individual variants — never as a selectable parent.
 */
export function ProductSkuCombobox({
  selected,
  onSelect,
  warehouseId,
  placeholder = 'Search or scan a product...',
  label = 'Product',
  className,
}: ProductSkuComboboxProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState('')

  // ── Camera scan ────────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const scannerRef = useRef<ScannerController | null>(null)
  const cameraIdRef = useRef('')
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
  // A bare Html5Qrcode throws if a start/stop overlaps ("already under
  // transition"), so every lifecycle call goes through createScanner, which
  // serialises them. Nothing here gates cleanup on `isScanning`.
  // When the decoded code is not on the current result page yet, the lookup
  // for that exact code is fired and `heldRef` keeps the camera on — the
  // auto-pick effect below selects the row as soon as it lands, so one scan
  // is enough (the backend's exact-SKU phase guarantees the hit is on page 1).
  useEffect(() => {
    if (!scanning) {
      void scannerRef.current?.dispose()
      scannerRef.current = null
      return
    }
    let cancelled = false

    const controller = createScanner(
      SCANNER_ELEMENT_ID,
      {
        fps: 15,
        qrbox: (width: number, height: number) => {
          const size = Math.min(width, height) * 0.7
          return { width: size, height: size }
        },
      },
      {
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
        onError: (err) => {
          console.error('Product scanner error', err)
          setScanError('Camera is currently in use or not responding.')
        },
      },
    )
    scannerRef.current = controller

    Html5Qrcode.getCameras()
      .then((devices: CameraDevice[]) => {
        if (cancelled) return
        const cameraId = pickDefaultCamera(devices ?? [])
        if (!cameraId) {
          setScanError('No cameras detected on this device.')
          return
        }
        cameraIdRef.current = cameraId
        void controller.start(cameraId)
      })
      .catch(() => {
        if (!cancelled) setScanError('Camera permission denied or unavailable.')
      })

    return () => {
      cancelled = true
      void controller.dispose()
      if (scannerRef.current === controller) scannerRef.current = null
    }
  }, [scanning, selectByCode])

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

  const selectedLabel = selected
    ? `${selected.productName}${selected.variantName ? ` — ${selected.variantName}` : ''}${
        selected.sku ? ` (${selected.sku})` : ''
      }`
    : null

  return (
    <div className={cn('space-y-2', className)}>
      <Label>{label}</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            heldRef.current = false
            reset()
          }
        }}
      >
        <div className="flex gap-2">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={label}
              className="w-full justify-between font-normal"
            >
              <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
                {selectedLabel ?? placeholder}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          {selectedLabel && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear product"
              onClick={() => {
                onSelect(null)
                reset()
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="Scan barcode"
            title="Scan barcode"
            onClick={() => setScanning((s) => !s)}
          >
            <ScanLine className={cn('h-4 w-4', scanning && 'text-primary')} />
          </Button>
        </div>

        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type name or SKU — Enter selects the exact SKU..."
              value={input}
              onValueChange={setInput}
              // Capture phase, before cmdk's own Enter handling: Enter commits
              // an EXACT SKU only. cmdk would otherwise auto-pick the first
              // (highlighted) row — typing a parent SKU like "SHIRT" and
              // hitting Enter would silently grab SHIRT-S, the exact footgun
              // this picker exists to prevent. Non-exact input keeps filtering
              // and must be picked explicitly (click), never by Enter.
              onKeyDownCapture={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                e.stopPropagation()
                commitExactInput()
              }}
            />
            <CommandList>
              {isError ? (
                <div className="flex items-start gap-2 p-4 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Lookup failed. {errorMessage(error)}</span>
                </div>
              ) : (
                <CommandEmpty>
                  {isFetching
                    ? 'Searching...'
                    : term
                      ? 'No products found.'
                      : 'Type a name or SKU, or scan a barcode.'}
                </CommandEmpty>
              )}
              <CommandGroup
                // A plain heading, NOT a CommandItem: a group heading has to
                // stay out of the keyboard selection ring so a VARIABLE
                // product can never be picked at parent level.
                heading="Products and variants"
              >
                {rows.map((row) => (
                  <CommandItem
                    key={rowKey(row)}
                    data-sku={row.sku ?? ''}
                    data-variant-id={row.variantId ?? ''}
                    // A plain <div role="option"> row, deliberately NOT a
                    // CommandItem: two roles on one node (cmdk's own "item"
                    // plus "option") make the row invisible to
                    // `getByRole('option')` and ambiguous for assistive tech.
                    role="option"
                    // NOT the row's own text: the list arrives pre-filtered from
                    // the server, so cmdk must not re-filter it (the UUID-value
                    // bug that made this picker permanently empty).
                    value={rowKey(row)}
                    onSelect={() => {
                      onSelect(row)
                      close()
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selected && rowKey(selected) === rowKey(row) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {row.productName}
                        {row.variantName && (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            — {row.variantName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {row.sku ? (
                          <span className="font-mono">{row.sku}</span>
                        ) : (
                          <span className="italic">no SKU</span>
                        )}
                        <span>· {row.available} available</span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              {truncated && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Showing the first {rows.length} matches — keep typing to narrow it down.
                </div>
              )}
            </CommandList>
          </Command>

          {scanning && (
            <div className="border-t p-2">
              <div id={SCANNER_ELEMENT_ID} className="min-h-24 w-full overflow-hidden rounded-md" />
              {isFetching && (
                <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Looking up scanned code…
                </p>
              )}
              {scanError && <p className="mt-1 text-center text-xs text-destructive">{scanError}</p>}
              <button
                type="button"
                className="mt-1 w-full text-center text-xs text-muted-foreground underline"
                onClick={() => setScanning(false)}
              >
                Stop camera
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {selected?.variantId && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Package className="h-3 w-3" />
          Variant selected — transfers apply to this variant&apos;s stock only.
        </p>
      )}
    </div>
  )
}