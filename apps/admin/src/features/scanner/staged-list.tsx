import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ChevronDown, ChevronUp, ExternalLink, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge, orderStatusTone } from '@/components/ui/dashboard'
import { CustomerContactActions } from '@/components/customer-contact-actions'
import { SafeImage } from '@/components/safe-image'

/** Item preview line inside the expansion panel (from the staging payload —
 * no extra fetch per expand). */
export interface ExpandItem {
  name: string
  sub?: string
  image?: string | null
  quantity?: number
  price?: string
  /** Confirmed received units (staged returns). */
  receivedQuantity?: number
  /** Units of receivedQuantity marked damaged (never restocked). */
  damagedQuantity?: number
  /** Upper bound for receivedQuantity (order/return line quantity). */
  maxQuantity?: number
  /** Unconfirmed courier splits allow staff to confirm the received qty. */
  quantityEditable?: boolean
  /** Exchange legs are info-only — no stock controls. */
  infoOnly?: boolean
  onReceivedChange?: (quantity: number) => void
  onDamagedChange?: (quantity: number) => void
}

export interface StagedRowExpand {
  heading?: string
  items?: ExpandItem[]
  note?: string
}

/** One dense staged row. All display data rides on the resolve response. */
export interface StagedRow {
  key: string
  orderId: string
  /** Scanned identifier, mono + semibold (consignment id or order number). */
  primary: string
  /** Second identifier shown muted next to primary (order no for dispatches). */
  secondary?: string
  customerName: string
  /** Customer snapshot phone — rendered as a `tel:` link (≥ sm only). */
  phone?: string
  /** 'return' → the caller's orderHref routes to the RETURNS page. */
  destKind?: 'return' | 'order'
  /** Pre-fetched goods for the chevron expansion panel (absent → no chevron). */
  expand?: StagedRowExpand
  /** Row needs operator attention (processable=false) — amber tints the row. */
  needsAttention?: boolean
  /** Why the row needs attention — exposed as the row title tooltip. */
  reason?: string
  /** Compact meta: "2 items · ৳1,250" (orders) or courier (dispatches). */
  meta?: string
  status: string
  /** Lowercase haystack for local search. */
  searchText: string
}

export function fmtBDT(n: number): string {
  const v = Number(n) || 0
  return `৳${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function orderMeta(itemCount: number, total: number): string {
  return `${itemCount} item${itemCount === 1 ? '' : 's'} · ${fmtBDT(total)}`
}

/** Row customer label: real name wins, else snapshot phone, else Guest. */
export function displayCustomer(name: string | undefined, phone: string | undefined): string {
  if (name && name !== 'Guest') return name
  if (phone && phone.trim()) return phone.trim()
  return 'Guest'
}

const ROW_H = 56
/** Windowing engages past this many rows — shorter lists render as plain
 * flow (cheaper, zero overlay risk); large batches get virtualization. */
const VIRTUALIZE_AFTER = 40

/**
 * Dense operational staged list: one compact two-line row per scan, bounded internal
 * scroll, windowed rendering for 1000+ rows, local search, newest-first
 * with a non-disruptive "new scans" pill, sticky bulk footer.
 */
export function StagedList({
  title,
  items,
  orderHref,
  onRemove,
  onClear,
  footer,
  clearConfirm,
  openLabel,
}: {
  title: string
  items: StagedRow[]
  orderHref: (row: StagedRow) => string
  onRemove: (key: string) => void
  onClear: () => void
  footer?: ReactNode
  /** Render-prop for the clear confirmation message given the count. */
  clearConfirm?: (count: number) => string
  /** External-link label; return staging passes "Open return …". */
  openLabel?: (row: StagedRow) => string
}) {
  const [query, setQuery] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [newCount, setNewCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atTopRef = useRef(true)
  const prevLenRef = useRef(items.length)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return items
    return items.filter((r) => tokens.every((t) => r.searchText.includes(t)))
  }, [items, query])

  // Ascending numbers with time: newest row (top) carries the highest number.
  const numbers = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((r, i) => map.set(r.key, items.length - i))
    return map
  }, [items])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })
  const virtualize = filtered.length > VIRTUALIZE_AFTER

  // New arrivals while scrolled away surface as a pill — never a jump.
  useEffect(() => {
    const prev = prevLenRef.current
    prevLenRef.current = items.length
    if (items.length > prev && !atTopRef.current) {
      setNewCount((c) => c + (items.length - prev))
    } else if (atTopRef.current) {
      setNewCount(0)
    }
  }, [items.length])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atTop = el.scrollTop <= 24
    atTopRef.current = atTop
    if (atTop) setNewCount(0)
  }

  const jumpToLatest = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setNewCount(0)
    inputFocusSearchReset()
  }

  const inputFocusSearchReset = () => {
    // Keep keyboard flow: return focus to the scan input, not the search box.
    document.getElementById('scanner-input')?.focus()
  }

  const showSearch = items.length > 1
  const vItems = virtualizer.getVirtualItems()

  // Expansion panel lifecycle: outside click + Escape close it. Capture phase
  // so the panel never races a Radix overlay above us (ESC-bubble lesson).
  useEffect(() => {
    if (!expandedKey) return
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('[data-staged-panel]') || t?.closest('button[data-staged-chevron]')) return
      setExpandedKey(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // An open modal owns Escape — never swallow it (the panel stays until
      // the dialog closes; the next Escape then targets the panel).
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      e.stopImmediatePropagation()
      setExpandedKey(null)
    }
    document.addEventListener('mousedown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [expandedKey])

  const renderRow = (r: StagedRow, num: number, style?: CSSProperties) => {
    const openLabelFor = openLabel
      ? (row: StagedRow) => openLabel(row)
      : (row: StagedRow) => `Open order ${row.secondary ?? row.primary}`
    const isExpanded = expandedKey === r.key
    const chevron = r.expand ? (
      <button
        type="button"
        data-staged-chevron
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${r.primary}`}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
        onClick={() => setExpandedKey(isExpanded ? null : r.key)}
      >
        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
    ) : null
    return (
    <div
      key={r.key}
      role="listitem"
      data-staged-row={r.key}
      title={r.reason ?? undefined}
      className={`relative flex items-center gap-2 border-b border-border/40 ${
        r.needsAttention ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'bg-card hover:bg-muted/50'
      } px-2.5 transition-colors duration-150`}
      style={{ height: ROW_H, ...style }}
    >
      <span className="w-7 shrink-0 text-right text-[10px] font-bold text-muted-foreground tabular-nums" aria-hidden>
        {String(num).padStart(2, '0')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs font-semibold truncate max-w-[46%]" title={r.primary}>
            {r.primary}
          </span>
          {r.secondary && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground truncate" title={r.secondary}>
              · {r.secondary}
            </span>
          )}
          <StatusBadge tone={orderStatusTone(r.status)} icon={null} className="shrink-0 !px-1.5 text-[10px]">
            <span className="max-w-[110px] truncate">{r.status}</span>
          </StatusBadge>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate" title={r.customerName}>{r.customerName}</span>
          {r.phone && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <a
                href={`tel:${r.phone}`}
                className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                title={`Call ${r.customerName}`}
              >
                {r.phone}
              </a>
              <CustomerContactActions phone={r.phone} iconClassName="!p-0" />
            </span>
          )}
          {r.meta && (
            <span className="min-w-0 shrink truncate tabular-nums sm:shrink-0" title={r.meta}>
              {r.meta}
            </span>
          )}
        </div>
      </div>
      <span className="flex shrink-0 items-center">
        <a
          href={orderHref(r)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={openLabelFor(r)}
          aria-label={`${openLabelFor(r)} in a new tab`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-soft hover:text-destructive cursor-pointer"
          title="Remove from staged list"
          aria-label={`Remove ${r.primary} from staged list`}
          onClick={() => onRemove(r.key)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {chevron}
      </span>
      {/* Floating expansion panel — absolutely positioned below the row so it
          never changes the fixed virtualized geometry. */}
      {isExpanded && r.expand && (
        <div
          data-staged-panel
          role="region"
          tabIndex={0}
          aria-label={`${r.expand.heading ?? 'Row details'} — ${r.primary}`}
          className="absolute inset-x-0 top-full z-30 max-h-80 overflow-y-auto rounded-b-xl border border-border/70 bg-card shadow-lg"
        >
          {r.expand.heading && (
            <p className="border-b border-border/50 bg-muted/30 px-3 py-2 text-xs font-semibold">{r.expand.heading}</p>
          )}
          <div className="p-2 space-y-1">
            {(r.expand.items ?? []).map((it, i) => (
              <div key={`${r.key}-item-${i}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/40">
                <SafeImage src={it.image ?? undefined} alt={it.name} className="h-9 w-9 rounded border object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{it.name}</p>
                  {it.sub && <p className="truncate text-[11px] text-muted-foreground">{it.sub}</p>}
                </div>
                <div className="shrink-0 text-right text-[11px]">
                  {typeof it.quantity === 'number' && <span className="font-medium">× {it.quantity}</span>}
                  {it.price && <div className="text-muted-foreground">{it.price}</div>}
                </div>
                {(it.onDamagedChange || it.onReceivedChange) && !it.infoOnly && (
                  <div className="flex shrink-0 flex-col items-end gap-1 border-l border-border/50 pl-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Received</span>
                      {it.quantityEditable && it.onReceivedChange ? (
                        <input
                          type="number"
                          min={0}
                          max={it.maxQuantity ?? it.receivedQuantity ?? 0}
                          value={it.receivedQuantity ?? 0}
                          aria-label={`Received quantity for ${it.name}`}
                          onChange={(e) => it.onReceivedChange?.(Number(e.target.value))}
                          className="h-6 w-14 rounded border border-border/70 bg-card px-1 text-right text-[11px] tabular-nums outline-none focus-visible:border-primary"
                        />
                      ) : (
                        <span className="font-medium tabular-nums">{it.receivedQuantity ?? 0}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Damaged</span>
                      <input
                        type="number"
                        min={0}
                        max={it.receivedQuantity ?? 0}
                        value={it.damagedQuantity ?? 0}
                        aria-label={`Damaged quantity for ${it.name}`}
                        onChange={(e) => it.onDamagedChange?.(Number(e.target.value))}
                        className="h-6 w-14 rounded border border-border/70 bg-card px-1 text-right text-[11px] tabular-nums outline-none focus-visible:border-primary"
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      Good {Math.max(0, (it.receivedQuantity ?? 0) - (it.damagedQuantity ?? 0))}
                    </span>
                  </div>
                )}
              </div>
            ))}
            {(r.expand.items ?? []).length === 0 && !r.expand.note && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">No line items recorded.</p>
            )}
          </div>
          {r.expand.note && (
            <p className="border-t border-border/50 bg-amber-500/5 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              {r.expand.note}
            </p>
          )}
        </div>
      )}
    </div>
  )
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 overflow-hidden" aria-label={title}>
      {/* header: count + search + clear — no KPI card */}
      <div className="flex flex-col gap-1.5 p-2.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tabular-nums">
            {title} <span className="text-muted-foreground font-normal">· {items.length}</span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="tap-h press text-xs text-muted-foreground h-7"
            onClick={() => (items.length > 1 ? setConfirmingClear(true) : onClear())}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        </div>
        {showSearch && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2 transition-colors focus-within:border-primary">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
            <label htmlFor={`staged-search-${title}`} className="sr-only">Search {title}</label>
            <input
              id={`staged-search-${title}`}
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order, customer, dispatch, courier…"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Clear staged search"
                onClick={() => { setQuery(''); searchRef.current?.focus() }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* bounded scroll region */}
      <div className="relative border-t border-border/50">
        {newCount > 0 && (
          <button
            onClick={jumpToLatest}
            className="absolute left-1/2 top-1.5 z-10 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-card px-2.5 py-1 text-[11px] font-semibold text-primary shadow-md transition-colors hover:bg-primary-soft cursor-pointer"
          >
            {newCount} new scan{newCount === 1 ? '' : 's'} <ArrowDown className="h-3 w-3" />
          </button>
        )}
        <div ref={scrollRef} onScroll={onScroll} className="max-h-80 overflow-y-auto" role="list" aria-label={`${title} rows`}>
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {items.length === 0 ? 'Nothing staged.' : 'No staged rows match this search.'}
            </p>
          )}
          {filtered.length > 0 && !virtualize && (
            <div>
              {filtered.map((r, i) => renderRow(r, numbers.get(r.key) ?? i + 1))}
            </div>
          )}
          {filtered.length > 0 && virtualize && (
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {vItems.map((v) => {
                const r = filtered[v.index]
                return renderRow(r, numbers.get(r.key) ?? v.index + 1, {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  transform: `translateY(${v.start}px)`,
                })
              })}
            </div>
          )}
        </div>
      </div>

      {/* sticky bulk footer — always visible below the bounded list */}
      {footer && <div className="border-t border-border/50 bg-card/60 p-2.5">{footer}</div>}

      <Dialog open={confirmingClear} onOpenChange={setConfirmingClear}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Clear staged list?</DialogTitle>
            <DialogDescription className="text-xs">
              {clearConfirm ? clearConfirm(items.length) : `${items.length} staged rows will be removed. Scans already applied are unaffected.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmingClear(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setConfirmingClear(false); onClear() }}
            >
              Clear {items.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
