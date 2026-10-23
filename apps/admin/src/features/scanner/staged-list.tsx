import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ChevronDown, ChevronUp, ExternalLink, Phone, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge, orderStatusTone } from '@/components/ui/dashboard'
import { SafeImage } from '@/components/safe-image'
import { whatsappLink } from '@/lib/phone-utils'
import { IconWhatsapp } from '@/assets/brand-icons'

/** Item preview line inside the expansion panel (from the staging payload —
 *  no extra fetch per expand). */
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

/** One staged row. All display data rides on the resolve response. */
export interface StagedRow {
  key: string
  orderId: string
  /** Scanned identifier (consignment id, order number, RTN id). */
  primary: string
  /** Second identifier shown next to primary (order no for dispatches). */
  secondary?: string
  customerName: string
  /** Customer snapshot phone — rendered as a `tel:` link + contact buttons. */
  phone?: string
  /** 'return' → the caller's orderHref routes to the RETURNS page. */
  destKind?: 'return' | 'order'
  /** Pre-fetched goods for the expansion panel (absent → no chevron). */
  expand?: StagedRowExpand
  /** Row needs operator attention (processable=false) — amber tints the row. */
  needsAttention?: boolean
  /** Why the row needs attention — shown ON the row, not only as a tooltip. */
  reason?: string
  /** Compact meta: "2 items · ৳1,250" (orders) or courier (dispatches). */
  meta?: string
  status: string
  /** Lowercase haystack for local search. */
  searchText: string
  /** Row thumbnail(s) — the first returning item's image. */
  thumbs?: { image?: string | null; name: string }[]
  /** Total number of lines behind the row (for the "+N" badge). */
  thumbTotal?: number
  /** Σ units on the row ("3 items"). */
  unitCount?: number
  /** Ready to process (green accent) — false means "needs attention". */
  ready?: boolean
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

/** Minimum hit area for every icon action (the owner-facing requirement). */
const HIT = 'h-10 w-10'

/**
 * Dense operational staged list — one order-list style row per scan.
 *
 * The collapsed row answers the operator's questions at a glance: WHO (name
 * + phone with real contact buttons), WHAT (thumbnail + unit count), WHICH
 * CODE, and IS IT READY (green check / amber chip with the reason). Nothing
 * essential sits in faint gray.
 *
 * The expansion grows to its natural height and the PAGE scrolls — there is
 * no internal scroll box, and no fixed-height window that could clip it.
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
  const listRef = useRef<HTMLDivElement>(null)
  const atTopRef = useRef(true)
  const prevLenRef = useRef(items.length)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return items
    return items.filter((r) => tokens.every((t) => r.searchText.includes(t)))
  }, [items, query])

  // New arrivals while the operator is scrolled away surface as a pill — the
  // list is in the PAGE flow now, so "at top" means the list's head is visible.
  useEffect(() => {
    const prev = prevLenRef.current
    prevLenRef.current = items.length
    if (items.length > prev && !atTopRef.current) {
      setNewCount((c) => c + (items.length - prev))
    } else if (atTopRef.current) {
      setNewCount(0)
    }
  }, [items.length])

  useEffect(() => {
    const onScroll = () => {
      const el = listRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      atTopRef.current = top >= -8
      if (atTopRef.current) setNewCount(0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const jumpToLatest = () => {
    const el = listRef.current
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 12
      window.scrollTo({ top, behavior: 'smooth' })
    }
    setNewCount(0)
    document.getElementById('scanner-input')?.focus()
  }

  const showSearch = items.length > 1

  // Expansion panel lifecycle: outside click + Escape close it. Capture phase
  // for Escape so the panel never races a Radix overlay above us (ESC-bubble
  // lesson).
  //
  // Dismiss runs on `click` — NEVER on `mousedown`/`pointerdown`. Collapsing
  // the panel is a LAYOUT change (it grows in flow), so collapsing between the
  // press and the release moves everything below it; the browser hit-tests the
  // release at the old coordinates and dispatches the `click` on a different
  // element. That is how the FIRST click on "Process returns" was swallowed:
  // it only folded the expanded row, and a second click (nothing left to
  // collapse) processed. Deferring the mousedown collapse with a timer does
  // not help — a real press is held far longer than a task. A `click`
  // listener runs after the pressed control's own handler, so it can never
  // steal the press.
  //
  // The action footer and the two explicit expand controls belong to the list,
  // not to "outside": using Process/Apply/Clear must never fold the details
  // the operator just opened, and the toggles own their own state.
  //
  // Membership is read from `composedPath()`, not `target.closest()`: this
  // listener can be registered DURING the very click that opened the panel
  // (React flushes the effect synchronously for discrete events), and the
  // pressed control may already have re-rendered — the chevron swaps
  // ChevronDown→ChevronUp, detaching the pressed <svg>. `closest()` on that
  // detached node sees no ancestors; the dispatch-time path still does.
  useEffect(() => {
    if (!expandedKey) return
    const isListOwned = (node: EventTarget | null) =>
      node instanceof Element &&
      (node.matches('[data-staged-panel]') ||
        node.matches('[data-staged-actions]') ||
        node.matches('button[data-staged-chevron]') ||
        node.matches('button[data-staged-thumb]'))
    const dismiss = (e: Event) => {
      if (e.composedPath().some(isListOwned)) return
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
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [expandedKey])

  const renderRow = (r: StagedRow) => {
    const openLabelFor = openLabel
      ? (row: StagedRow) => openLabel(row)
      : (row: StagedRow) => `Open order ${row.secondary ?? row.primary}`
    const isExpanded = expandedKey === r.key
    const hasExpand = !!r.expand
    const waUrl = r.phone ? whatsappLink(r.phone) : null
    const thumbs = r.thumbs ?? []
    const extraThumbs = Math.max(0, (r.thumbTotal ?? thumbs.length) - thumbs.length)
    const units = r.unitCount
    const ready = r.ready ?? !r.needsAttention

    const thumbInner = (
      <>
        {thumbs[0]?.image ? (
          <SafeImage src={thumbs[0].image} alt={thumbs[0].name} className="h-full w-full object-cover" thumbWidth={112} thumbHeight={112} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground">
            {thumbs[0]?.name?.slice(0, 2).toUpperCase() ?? '—'}
          </span>
        )}
        {extraThumbs > 0 && (
          <span className="absolute bottom-0 right-0 rounded-tl-md bg-foreground/85 px-1.5 py-0.5 text-[10px] font-bold text-background">
            +{extraThumbs}
          </span>
        )}
      </>
    )
    // The thumbnail area expands the row; the chevron keeps the explicit
    // "Expand …" affordance.
    const thumb = hasExpand ? (
      <button
        type="button"
        data-staged-thumb
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Hide details for' : 'Show details for'} ${r.primary}`}
        onClick={() => setExpandedKey(isExpanded ? null : r.key)}
        className="relative shrink-0 rounded-xl border border-border/70 bg-muted/40 overflow-hidden cursor-pointer hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40"
        style={{ width: 56, height: 56 }}
      >
        {thumbInner}
      </button>
    ) : (
      <div
        data-staged-thumb
        className="relative shrink-0 rounded-xl border border-border/70 bg-muted/40 overflow-hidden"
        style={{ width: 56, height: 56 }}
      >
        {thumbInner}
      </div>
    )

    const chevron = hasExpand ? (
      <button
        type="button"
        data-staged-chevron
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${r.primary}`}
        className={`${HIT} flex shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer`}
        onClick={() => setExpandedKey(isExpanded ? null : r.key)}
      >
        {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
      </button>
    ) : null

    return (
      <div
        key={r.key}
        role="listitem"
        data-staged-row={r.key}
        className={`border-b border-border/40 ${
          r.needsAttention ? 'bg-amber-500/10' : 'bg-card hover:bg-muted/40'
        } transition-colors duration-150`}
      >
        <div className="flex items-start gap-3 px-3 py-3">
          {thumb}

          {/* Customer block — the loudest thing on the row. */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-semibold leading-tight text-foreground truncate" title={r.customerName}>
                {r.customerName}
              </p>
              {ready ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircleIcon /> Ready
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  <AlertIcon /> Needs attention
                </span>
              )}
            </div>

            {/* Phone + real contact buttons, contents summary, codes. */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {r.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <a
                    href={`tel:${r.phone}`}
                    className="font-mono text-xs font-medium text-foreground hover:underline"
                    title={`Call ${r.customerName}`}
                  >
                    {r.phone}
                  </a>
                  <a
                    href={`tel:${r.phone}`}
                    aria-label={`Call ${r.customerName}`}
                    className={`${HIT} flex items-center justify-center rounded-xl border border-border/70 bg-card text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40`}
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`WhatsApp ${r.customerName}`}
                      className={`${HIT} flex items-center justify-center rounded-xl border border-[#25D366]/50 bg-[#25D366]/15 text-[#128C4B] dark:text-[#25D366] transition-colors hover:bg-[#25D366]/25 focus-visible:ring-2 focus-visible:ring-primary/40`}
                    >
                      <IconWhatsapp className="h-4 w-4" />
                    </a>
                  )}
                </span>
              )}

              {typeof units === 'number' && (
                <span className="text-xs font-medium text-muted-foreground">
                  · {units} item{units === 1 ? '' : 's'}
                </span>
              )}

              <span className="font-mono text-xs font-semibold text-muted-foreground truncate" title={r.primary}>
                {r.primary}
              </span>
              {r.secondary && (
                <span className="font-mono text-[11px] text-muted-foreground truncate" title={r.secondary}>
                  · {r.secondary}
                </span>
              )}
              {r.meta && (
                <span className="text-[11px] text-muted-foreground truncate" title={r.meta}>
                  · {r.meta}
                </span>
              )}
            </div>

            {/* The attention reason is READABLE on the row (never a tooltip only). */}
            {r.needsAttention && r.reason && (
              <p className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-200">
                {r.reason}
              </p>
            )}
          </div>

          {/* Right column: lifecycle chip (secondary) + separated actions. */}
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusBadge tone={orderStatusTone(r.status)} icon={null} className="shrink-0 !px-1.5 text-[10px]">
              <span className="max-w-[110px] truncate">{r.status}</span>
            </StatusBadge>
            <div className="flex items-center gap-2">
              <a
                href={orderHref(r)}
                target="_blank"
                rel="noreferrer"
                className={`${HIT} flex items-center justify-center rounded-xl border border-border/70 bg-card text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40`}
                title={openLabelFor(r)}
                aria-label={`${openLabelFor(r)} in a new tab`}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              {chevron}
              <button
                className={`${HIT} flex items-center justify-center rounded-xl border border-destructive/40 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-destructive/40 cursor-pointer`}
                title="Remove from staged list"
                aria-label={`Remove ${r.primary} from staged list`}
                onClick={() => onRemove(r.key)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Expansion — IN FLOW, natural height, no internal scroll box. */}
        {isExpanded && r.expand && (
          <div
            data-staged-panel
            role="region"
            tabIndex={0}
            aria-label={`${r.expand.heading ?? 'Row details'} — ${r.primary}`}
            className="border-t border-border/50 bg-muted/20 px-3 py-3"
          >
            {r.expand.heading && (
              <p className="mb-2 text-xs font-semibold text-foreground">{r.expand.heading}</p>
            )}
            <div className="flex flex-col gap-2">
              {(r.expand.items ?? []).map((it, i) => (
                <div
                  key={`${r.key}-item-${i}`}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-3"
                >
                  <SafeImage
                    src={it.image ?? undefined}
                    alt={it.name}
                    className="h-14 w-14 shrink-0 rounded-lg border border-border/60 object-cover"
                    thumbWidth={112}
                    thumbHeight={112}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{it.name}</p>
                    {it.sub && <p className="truncate text-xs text-muted-foreground">{it.sub}</p>}
                    {typeof it.quantity === 'number' && (
                      <p className="mt-0.5 text-xs font-semibold text-foreground">× {it.quantity}</p>
                    )}
                  </div>
                  {it.price && <div className="shrink-0 text-xs font-medium text-muted-foreground">{it.price}</div>}
                  {(it.onDamagedChange || it.onReceivedChange) && !it.infoOnly && (
                    <div className="flex shrink-0 flex-wrap items-end gap-3 border-l border-border/60 pl-3">
                      {it.quantityEditable && it.onReceivedChange ? (
                        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                          Received
                          <input
                            type="number"
                            min={0}
                            max={it.maxQuantity ?? it.receivedQuantity ?? 0}
                            value={it.receivedQuantity ?? 0}
                            aria-label={`Received quantity for ${it.name}`}
                            onChange={(e) => it.onReceivedChange?.(Number(e.target.value))}
                            className="h-10 w-20 rounded-lg border border-border/70 bg-card px-2 text-right text-sm font-medium tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          />
                        </label>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Received <span className="font-semibold text-foreground tabular-nums">{it.receivedQuantity ?? 0}</span>
                        </span>
                      )}
                      <div className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                        Damaged
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Remove one damaged unit for ${it.name}`}
                            className={`${HIT} flex items-center justify-center rounded-lg border border-border/70 bg-card text-base font-semibold text-foreground transition-colors hover:bg-muted cursor-pointer`}
                            onClick={() => it.onDamagedChange?.(Math.max(0, (it.damagedQuantity ?? 0) - 1))}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={it.receivedQuantity ?? 0}
                            value={it.damagedQuantity ?? 0}
                            aria-label={`Damaged quantity for ${it.name}`}
                            onChange={(e) => it.onDamagedChange?.(Number(e.target.value))}
                            className="h-10 w-16 rounded-lg border border-border/70 bg-card px-2 text-right text-sm font-medium tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                          />
                          <button
                            type="button"
                            aria-label={`Add one damaged unit for ${it.name}`}
                            className={`${HIT} flex items-center justify-center rounded-lg border border-border/70 bg-card text-base font-semibold text-foreground transition-colors hover:bg-muted cursor-pointer`}
                            onClick={() => it.onDamagedChange?.(Math.min(it.receivedQuantity ?? 0, (it.damagedQuantity ?? 0) + 1))}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Good{' '}
                        <span className="font-semibold text-foreground tabular-nums">
                          {Math.max(0, (it.receivedQuantity ?? 0) - (it.damagedQuantity ?? 0))}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {(r.expand.items ?? []).length === 0 && !r.expand.note && (
                <p className="px-1 py-2 text-center text-xs text-muted-foreground">No line items recorded.</p>
              )}
            </div>
            {r.expand.note && (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
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
            variant="outline"
            size="sm"
            className="tap-h press h-9 text-xs text-foreground"
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

      {/* The list lives in the PAGE flow — no internal scroll box. */}
      <div className="relative border-t border-border/50">
        {newCount > 0 && (
          <button
            onClick={jumpToLatest}
            className="absolute left-1/2 top-1.5 z-10 -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-card px-2.5 py-1 text-[11px] font-semibold text-primary shadow-md transition-colors hover:bg-primary-soft cursor-pointer"
          >
            {newCount} new scan{newCount === 1 ? '' : 's'} <ArrowDown className="h-3 w-3" />
          </button>
        )}
        <div ref={listRef} role="list" aria-label={`${title} rows`}>
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {items.length === 0 ? 'Nothing staged.' : 'No staged rows match this search.'}
            </p>
          )}
          {filtered.length > 0 && <div>{filtered.map((r) => renderRow(r))}</div>}
        </div>
      </div>

      {/* sticky bulk footer — the list's action area. Marked so an outside-
          click dismissal never treats it as "outside" (using an action must
          not fold the row). */}
      {footer && (
        <div data-staged-actions className="border-t border-border/50 bg-card/60 p-2.5">
          {footer}
        </div>
      )}

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

/** Green check glyph for the "Ready" chip. */
function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 10.5 8 14.5 16 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Amber warning glyph for the "Needs attention" chip. */
function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M10 3 18 17H2L10 3Z" strokeLinejoin="round" />
      <path d="M10 8v4M10 14.5v.5" strokeLinecap="round" />
    </svg>
  )
}
