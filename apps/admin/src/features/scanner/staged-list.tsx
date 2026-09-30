import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ExternalLink, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge, orderStatusTone } from '@/components/ui/dashboard'

/** One dense staged row. All display data rides on the resolve response. */
export interface StagedRow {
  key: string
  orderId: string
  /** Scanned identifier, mono + semibold (consignment id or order number). */
  primary: string
  /** Second identifier shown muted next to primary (order no for dispatches). */
  secondary?: string
  customerName: string
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

const ROW_H = 44
/** Windowing engages past this many rows — shorter lists render as plain
 * flow (cheaper, zero overlay risk); large batches get virtualization. */
const VIRTUALIZE_AFTER = 40

/**
 * Dense operational staged list: one 44px row per scan, bounded internal
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
}: {
  title: string
  items: StagedRow[]
  orderHref: (row: StagedRow) => string
  onRemove: (key: string) => void
  onClear: () => void
  footer?: ReactNode
  /** Render-prop for the clear confirmation message given the count. */
  clearConfirm?: (count: number) => string
}) {
  const [query, setQuery] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
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

  const renderRow = (r: StagedRow, num: number, style?: CSSProperties) => (
    <div
      key={r.key}
      role="listitem"
      className="flex items-center gap-2 border-b border-border/40 bg-card px-2.5 transition-colors duration-150 hover:bg-muted/50"
      style={{ height: ROW_H, ...style }}
    >
      <span className="w-7 shrink-0 text-right text-[10px] font-bold text-muted-foreground tabular-nums" aria-hidden>
        {String(num).padStart(2, '0')}
      </span>
      <span className="shrink-0 font-mono text-xs font-semibold truncate max-w-[38%]" title={r.primary}>
        {r.primary}
      </span>
      {r.secondary && (
        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground truncate min-[420px]:inline" title={r.secondary}>
          · {r.secondary}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={r.customerName}>
        {r.customerName}
      </span>
      {r.meta && (
        <span className="hidden shrink-0 text-[11px] text-muted-foreground tabular-nums md:inline" title={r.meta}>
          {r.meta}
        </span>
      )}
      <StatusBadge tone={orderStatusTone(r.status)} icon={null} className="hidden shrink-0 !px-1.5 text-[10px] sm:inline-flex">
        <span className="max-w-[110px] truncate">{r.status}</span>
      </StatusBadge>
      <span className="flex shrink-0 items-center">
        <a
          href={orderHref(r)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={`Open order ${r.secondary ?? r.primary}`}
          aria-label={`Open order ${r.secondary ?? r.primary} in a new tab`}
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
      </span>
    </div>
  )

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
