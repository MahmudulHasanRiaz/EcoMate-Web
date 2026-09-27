import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Columns3,
  Copy,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Source Sheet viewer — the 100 % inspectable representation of what the
 * courier actually sent.
 *
 * Contract (§9 ①): raw values only, every original column, original order,
 * original row numbers. No normalization, no rounding, no column drops — the
 * canonical/business layer lives in Reconciliation, never here.
 *
 * The display layer MAY format dates visually (§3) — the exact source string
 * is always preserved in the cell title, the inspector and the copy actions.
 *
 * Grid architecture (§3/§16): manual virtualization, zero extra dependencies —
 * fixed row heights + spacer rows for the row axis, column windowing (full
 * cells inside the visible range, bare cells outside) for the column axis,
 * `table-fixed` + `<colgroup>` for stable widths, opaque sticky pins for the
 * row number / class / first source column so nothing bleeds underneath.
 *
 * Used by BOTH the import preview and the imported invoice's "Invoice sheet"
 * tab so the two are the same experience.
 */

export interface SheetFinding {
  ruleId: string
  severity: 'red' | 'yellow'
  blocking: boolean
  message: string
}

export interface SheetRow {
  rowNumber: number
  rowClass: string
  rowKind?: string
  identifier?: string | null
  matchMethod?: string | null
  reviewState?: 'green' | 'yellow' | 'red'
  raw: Record<string, string>
  findings?: SheetFinding[]
  adjusted?: boolean
}

export interface SourceSheetProps {
  rows: SheetRow[]
  /** Original source headers, in source order. Never truncated. */
  headers: string[]
  /** Active column mappings — rendered as a secondary `→ target` hint. */
  mappings?: { sourceHeader: string; targetField: string }[]
  /** Row numbers to scroll to + outline (finding → affected data). */
  highlightRowNumbers?: number[]
  /** Clears the parent's finding highlight. */
  onClearHighlight?: () => void
  /** Opens the parent's finding card for a cell issue (§5 action). */
  onViewFinding?: (ruleId: string, rowNumber: number) => void
  /** Total rows in the document when the visible set is capped. */
  totalRows?: number
  truncatedNote?: string
  heightClass?: string
  emptyMessage?: string
}

/**
 * Which source column a rule talks about. Used for CELL-level indicators so a
 * 25-column row shows the problem on the one cell that has it — never the whole
 * sheet in red. Rules without a resolvable column stay row-level only.
 */
const RULE_FIELD_HINTS: Record<string, RegExp> = {
  NO_MATCH: /(consignment|tracking|order|merchant|awb|ref|id)/i,
  MISSING_IDENTIFIER: /(consignment|tracking|order|merchant|awb|ref|id)/i,
  DUPLICATE_SETTLEMENT: /(consignment|tracking|order|merchant|awb)/i,
  OVER_SETTLEMENT: /(payout|collected|net|settle)/i,
  OVER_COLLECTION: /(collected|cod|collectable)/i,
  NEGATIVE_PAYOUT_VALID: /(payout|net)/i,
  NEGATIVE_PAYOUT_UNEXPECTED: /(payout|net)/i,
  ARITHMETIC_MISMATCH_HARD: /(payout|collected|fee|charge|discount|adjust|net)/i,
  ARITHMETIC_MISMATCH_SOFT: /(payout|collected|fee|charge|discount|adjust|net)/i,
  RESIDUAL_LARGE: /(payout|collected|charge|net)/i,
  RESIDUAL_UNEXPLAINED: /(payout|collected|charge|net)/i,
  UNUSUAL_ADJUSTMENT: /(adjust|compensation|discount|charge)/i,
  UNKNOWN_ROW_KIND_WITH_AMOUNT: /(amount|charge|fee|cod|payout)/i,
  PROVIDER_DATA_INCOMPLETE: /(collected|payout|charge|fee)/i,
  EXPECTED_COD_DIVERGENCE: /(collectable|cod|collect|amount)/i,
}

/** Columns the reconciliation logic reads — subtly marked, never re-coloured. */
const CRITICAL_COLUMN =
  /(consignment|tracking|order|payout|collected|collectable|cod|fee|charge|adjustment|compensation|discount|payment.?status|delivery.?status|invoice)/i

const ID_COLUMN = /(^|_| )id$|consignment|tracking|awb|reference|(^|_)ref|invoice.?no|merchant/i

const NUMERIC_HEADER =
  /amount|fee|charge|payout|cod|total|price|cost|discount|compensation|net|collect|qty|quantity/i

const CLASS_FILTERS = ['ALL', 'DATA', 'SUMMARY', 'FOOTER', 'UNKNOWN'] as const
type ClassFilter = (typeof CLASS_FILTERS)[number]
type StatusFilter = 'all' | 'issues' | 'warnings' | 'matched' | 'unmatched'
type SortDir = 'asc' | 'desc'
type Density = 'comfy' | 'dense'

const DEFAULT_WIDTH = 168
const MIN_WIDTH = 84
const MAX_WIDTH = 460

/** Sticky geometry — must stay in sync with the colgroup + left offsets. */
const ROWNUM_W = 56
const CLASS_W = 88
const PINNED_W = ROWNUM_W + CLASS_W // 144px before the first source column

const ROW_H: Record<Density, number> = { comfy: 34, dense: 26 }
const OVERSCAN = 8
const COL_SPARE = DEFAULT_WIDTH * 3 // column window slack for fast scrolling

const isEmpty = (v: unknown) => v === undefined || v === null || String(v).trim() === ''
const looksNumeric = (v: string) => /^-?[\d,]+(\.\d+)?%?$/.test(v.trim())

/* ── Date display: visual formatting only, raw always preserved elsewhere. ── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
const DMY_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * Visual-only date format ("28 Sep 2026, 13:45"). Returns null when the value
 * is not a date or its day/month order is ambiguous — ambiguity renders raw
 * (never guesses a courier's locale).
 */
function formatCellVisual(v: string): string | null {
  const s = v.trim()
  const iso = ISO_DATE.exec(s)
  if (iso) {
    const [, y, m, d, hh, mm] = iso
    const day = Number(d)
    const mon = Number(m)
    if (day < 1 || day > 31 || mon < 1 || mon > 12) return null
    const base = `${day} ${MONTHS[mon - 1]} ${y}`
    return hh && mm ? `${base}, ${hh}:${mm}` : base
  }
  const dmy = DMY_DATE.exec(s)
  if (dmy) {
    const a = Number(dmy[1])
    const b = Number(dmy[2])
    let day: number
    let mon: number
    if (a > 12 && b <= 12) {
      day = a
      mon = b // DD/MM/YYYY
    } else if (b > 12 && a <= 12) {
      mon = a
      day = b // MM/DD/YYYY
    } else if (a <= 12 && b <= 12) {
      return null // ambiguous — render the raw source string
    } else {
      return null
    }
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null
    const base = `${day} ${MONTHS[mon - 1]} ${dmy[3]}`
    return dmy[4] && dmy[5]
      ? `${base}, ${String(dmy[4]).padStart(2, '0')}:${dmy[5]}`
      : base
  }
  return null
}

function cellIssue(
  row: SheetRow,
  header: string,
): { ruleId: string; severity: 'red' | 'yellow'; blocking: boolean; message: string } | null {
  for (const f of row.findings ?? []) {
    const re = RULE_FIELD_HINTS[f.ruleId]
    if (re && re.test(header)) return { ruleId: f.ruleId, ...f }
  }
  return null
}

/** Sort comparator: numbers numerically, dates chronologically, else naturally. */
function compareCells(a: string, b: string): number {
  const na = looksNumeric(a) ? parseFloat(a.replace(/,/g, '')) : null
  const nb = looksNumeric(b) ? parseFloat(b.replace(/,/g, '')) : null
  if (na !== null && nb !== null) return na - nb
  // ISO strings compare chronologically as text; visually-formatted dates do too
  // for same-locale exports, so a plain localeCompare keeps both orders sane.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function SourceSheet({
  rows,
  headers,
  mappings,
  highlightRowNumbers,
  onClearHighlight,
  onViewFinding,
  totalRows,
  truncatedNote,
  heightClass = 'max-h-[52vh]',
  emptyMessage = 'No rows match the current filter.',
}: SourceSheetProps) {
  const [search, setSearch] = useState('')
  const [klass, setKlass] = useState<ClassFilter>('ALL')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [order, setOrder] = useState<string[]>(headers)
  const [sort, setSort] = useState<{ header: string; dir: SortDir } | null>(null)
  const [density, setDensity] = useState<Density>('comfy')
  const [fullscreen, setFullscreen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [dragHeader, setDragHeader] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [inspected, setInspected] = useState<{ row: SheetRow; header: string; value: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [issuePop, setIssuePop] = useState<{
    row: SheetRow
    header: string
    issue: NonNullable<ReturnType<typeof cellIssue>>
    left: number
    top: number
  } | null>(null)

  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())
  const resizing = useRef<{ header: string; startX: number; startW: number } | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pendingHighlightRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Virtualization state (row axis + column axis).
  const [scrollY, setScrollY] = useState(0)
  const [scrollX, setScrollX] = useState(0)
  const [box, setBox] = useState({ h: 480, w: 1200 })

  // Original source order is the default; a reset restores it exactly.
  useEffect(() => {
    setOrder(headers)
    setHidden(new Set())
    setWidths({})
    setSort(null)
  }, [headers])

  // Track the scroller box (row window height + column window width).
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setBox({ h: r.height, w: r.width })
    })
    ro.observe(el)
    setBox({ h: el.clientHeight || 480, w: el.clientWidth || 1200 })
    return () => ro.disconnect()
  }, [fullscreen])

  // rAF-throttled scroll → virtual window.
  const onScroll = () => {
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollerRef.current
      if (!el) return
      setScrollY(el.scrollTop)
      setScrollX(el.scrollLeft)
    })
  }
  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  // ESC: popover → inspector → fullscreen, outermost last. Capture phase so
  // the parent Radix Dialog never sees a key we consume (fullscreen must not
  // close the whole wizard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (issuePop) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setIssuePop(null)
      } else if (inspected) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setInspected(null)
      } else if (fullscreen) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [issuePop, inspected, fullscreen])

  const mappedTarget = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of mappings ?? []) map.set(m.sourceHeader, m.targetField)
    return map
  }, [mappings])

  const visibleHeaders = useMemo(() => order.filter((h) => !hidden.has(h)), [order, hidden])

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (klass !== 'ALL' && r.rowClass !== klass) return false
      if (status === 'issues' && r.reviewState !== 'red') return false
      if (status === 'warnings' && r.reviewState !== 'yellow') return false
      if (status === 'matched' && (r.matchMethod ?? 'NONE') === 'NONE') return false
      if (status === 'unmatched' && (r.matchMethod ?? 'NONE') !== 'NONE') return false
      if (!q) return true
      return Object.values(r.raw).some((v) => String(v ?? '').toLowerCase().includes(q))
    })
  }, [rows, klass, status, search])

  // Highlighted rows always stay visible regardless of the search/filter state.
  const filtered = useMemo(() => {
    if (!highlightRowNumbers || highlightRowNumbers.length === 0) return matched
    const highlighted = new Set(highlightRowNumbers)
    const missing = rows.filter(
      (r) => highlighted.has(r.rowNumber) && !matched.some((m) => m.rowNumber === r.rowNumber),
    )
    return missing.length > 0 ? [...matched, ...missing] : matched
  }, [matched, rows, highlightRowNumbers])

  const view = useMemo(() => {
    if (!sort) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((ra, rb) => {
      const a = String(ra.raw[sort.header] ?? '')
      const b = String(rb.raw[sort.header] ?? '')
      return dir * compareCells(a, b)
    })
  }, [filtered, sort])

  // Finding → affected rows: jump the row axis, then center the first hit.
  useEffect(() => {
    if (!highlightRowNumbers || highlightRowNumbers.length === 0) {
      pendingHighlightRef.current = null
      return
    }
    const first = highlightRowNumbers[0]
    const idx = view.findIndex((r) => r.rowNumber === first)
    if (idx < 0) return
    pendingHighlightRef.current = first
    const el = scrollerRef.current
    if (el) {
      const target = Math.max(0, idx * ROW_H[density] - box.h / 2)
      el.scrollTop = target
      setScrollY(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRowNumbers])

  // Runs after the re-render the jump above triggers — the row exists now.
  useEffect(() => {
    const first = pendingHighlightRef.current
    if (first === null) return
    const el = rowRefs.current.get(first)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      pendingHighlightRef.current = null
    }
  })

  // Column alignment: right-align numeric columns (money/qty), mono for ids.
  const align = useMemo(() => {
    const map: Record<string, 'left' | 'right'> = {}
    for (const h of headers) {
      if (NUMERIC_HEADER.test(h)) {
        map[h] = 'right'
        continue
      }
      let numeric = 0
      let seen = 0
      for (const r of rows.slice(0, 50)) {
        const v = r.raw[h]
        if (isEmpty(v)) continue
        seen++
        if (looksNumeric(String(v))) numeric++
      }
      map[h] = seen > 0 && numeric / seen > 0.8 ? 'right' : 'left'
    }
    return map
  }, [headers, rows])

  const colWidth = (h: string) => widths[h] ?? DEFAULT_WIDTH
  const totalWidth = PINNED_W + visibleHeaders.reduce((s, h) => s + colWidth(h), 0)

  // Column window: full cells only where the viewport can see them (§16).
  const colWindow = useMemo(() => {
    const inWindow = new Set<number>([0]) // first source column is always rendered
    let x = PINNED_W
    const left = scrollX - COL_SPARE
    const right = scrollX + box.w + COL_SPARE
    visibleHeaders.forEach((h, i) => {
      const w = colWidth(h)
      if (x + w > left && x < right) inWindow.add(i)
      x += w
    })
    return inWindow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleHeaders, widths, scrollX, box.w])

  const rowH = ROW_H[density]
  const startIdx = Math.max(0, Math.floor(scrollY / rowH) - OVERSCAN)
  const endIdx = Math.min(view.length, Math.ceil((scrollY + box.h) / rowH) + OVERSCAN)
  const windowRows = view.slice(startIdx, endIdx)
  const topPad = startIdx * rowH
  const bottomPad = Math.max(0, (view.length - endIdx) * rowH)
  const totalCols = 2 + visibleHeaders.length

  const startResize = (header: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizing.current = {
      header,
      startX: e.clientX,
      startW: widths[header] ?? DEFAULT_WIDTH,
    }
    const onMove = (ev: MouseEvent) => {
      const cur = resizing.current
      if (!cur) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, cur.startW + (ev.clientX - cur.startX)))
      setWidths((w) => ({ ...w, [cur.header]: next }))
    }
    const onUp = () => {
      resizing.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const reorder = (from: string, to: string) => {
    if (!from || from === to) return
    setOrder((prev) => {
      const next = [...prev]
      const fi = next.indexOf(from)
      if (fi < 0) return prev
      next.splice(fi, 1)
      const ti = next.indexOf(to)
      next.splice(ti < 0 ? next.length : ti, 0, from)
      return next
    })
  }

  const toggleSort = (h: string) => {
    setSort((s) =>
      !s || s.header !== h ? { header: h, dir: 'asc' } : s.dir === 'asc' ? { header: h, dir: 'desc' } : null,
    )
  }

  const resetView = () => {
    setOrder(headers)
    setHidden(new Set())
    setWidths({})
    setSearch('')
    setKlass('ALL')
    setStatus('all')
    setSort(null)
  }

  const inspect = (row: SheetRow, header: string, preCopy = false) => {
    const value = String(row.raw[header] ?? '')
    setInspected({ row, header, value })
    if (preCopy) {
      navigator.clipboard
        .writeText(value)
        .then(() => setCopied(true))
        .catch(() => setCopied(false))
    } else {
      setCopied(false)
    }
  }

  const copyValue = async () => {
    if (!inspected) return
    try {
      await navigator.clipboard.writeText(inspected.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable — the value stays selectable on screen */
    }
  }

  const copyRow = async () => {
    if (!inspected) return
    const tsv = visibleHeaders.map((h) => String(inspected.row.raw[h] ?? '')).join('\t')
    try {
      await navigator.clipboard.writeText(tsv)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  const openIssue = (row: SheetRow, header: string, issue: NonNullable<ReturnType<typeof cellIssue>>) => {
    const rect = (document.activeElement as HTMLElement | null)?.getBoundingClientRect()
    const left = Math.min((rect?.left ?? 320), window.innerWidth - 340)
    const top = Math.min((rect?.bottom ?? 200) + 8, window.innerHeight - 190)
    setIssuePop({ row, header, issue, left: Math.max(8, left), top: Math.max(8, top) })
  }

  const criticalCount = headers.filter((h) => CRITICAL_COLUMN.test(h)).length
  const blockingCount = filtered.filter((r) => r.reviewState === 'red').length
  const warningCount = filtered.filter((r) => r.reviewState === 'yellow').length

  const cellTitle = (raw: string, issue: ReturnType<typeof cellIssue>) =>
    issue ? `${raw}\n${issue.ruleId} — ${issue.message}` : raw

  const rootClass = fullscreen
    ? 'fixed inset-0 z-[60] flex flex-col gap-2 bg-background p-4'
    : 'space-y-2'

  return (
    <div className={rootClass}>
      {/* ── Control bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search every column…"
            className="h-8 w-56 pl-7 pr-7 text-xs"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center rounded-md border p-0.5">
          {CLASS_FILTERS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setKlass(c)}
              className={`rounded-sm px-2 py-1 text-[11px] font-medium transition-colors duration-150 cursor-pointer ${
                klass === c
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c === 'ALL' ? 'All rows' : c.charAt(0) + c.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="issues">Issues only</SelectItem>
            <SelectItem value="warnings">Warnings only</SelectItem>
            <SelectItem value="matched">Matched only</SelectItem>
            <SelectItem value="unmatched">Unmatched only</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => setColumnsOpen((v) => !v)}
          >
            <Columns3 className="size-3.5" />
            Columns
            {hidden.size > 0 ? <span className="text-muted-foreground">· {hidden.size} hidden</span> : null}
          </Button>
          {columnsOpen ? (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setColumnsOpen(false)}
                aria-hidden
              />
              <div className="absolute left-0 top-9 z-40 max-h-72 w-64 overflow-auto rounded-md border bg-popover p-2 shadow-md">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Visible columns — drag to reorder
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-sm px-1 text-[11px] text-primary transition-colors hover:underline cursor-pointer"
                    onClick={() => {
                      setHidden(new Set())
                      setOrder(headers)
                      setWidths({})
                    }}
                  >
                    <RotateCcw className="size-3" /> Reset
                  </button>
                </div>
                {order.map((h) => (
                  <label
                    key={h}
                    draggable
                    onDragStart={(e) => {
                      setDragHeader(h)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (dragHeader && dragHeader !== h) e.preventDefault()
                      setDropTarget(h)
                    }}
                    onDrop={() => {
                      reorder(dragHeader ?? '', h)
                      setDragHeader(null)
                      setDropTarget(null)
                    }}
                    onDragEnd={() => {
                      setDragHeader(null)
                      setDropTarget(null)
                    }}
                    className={`flex cursor-grab items-center gap-2 rounded-sm px-1 py-1 text-xs transition-colors hover:bg-muted ${
                      dropTarget === h && dragHeader && dragHeader !== h ? 'ring-1 ring-primary/60' : ''
                    } ${dragHeader === h ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={!hidden.has(h)}
                      onChange={() =>
                        setHidden((prev) => {
                          const next = new Set(prev)
                          if (next.has(h)) next.delete(h)
                          else next.add(h)
                          return next
                        })
                      }
                    />
                    <span className="truncate" title={h}>
                      {h}
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center rounded-md border p-0.5">
          {(['comfy', 'dense'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={`rounded-sm px-2 py-1 text-[11px] font-medium transition-colors duration-150 cursor-pointer ${
                density === d
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {d === 'comfy' ? 'Comfy' : 'Dense'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {view.length.toLocaleString()}
            {totalRows && totalRows !== rows.length ? ` / ${totalRows.toLocaleString()}` : ''} rows
          </span>
          <span className="text-border">·</span>
          <span className="tabular-nums">{visibleHeaders.length} columns</span>
          <button
            type="button"
            onClick={resetView}
            className="rounded-sm px-1 text-primary transition-colors hover:underline cursor-pointer"
          >
            Reset view
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setFullscreen((v) => !v)}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {highlightRowNumbers && highlightRowNumbers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span>
            {highlightRowNumbers.length} affected row(s) from the selected finding — outlined below.
          </span>
          <span className="font-mono tabular-nums">
            {highlightRowNumbers.slice(0, 12).join(', ')}
            {highlightRowNumbers.length > 12 ? '…' : ''}
          </span>
          {onClearHighlight ? (
            <button
              type="button"
              onClick={onClearHighlight}
              className="ml-auto rounded-sm px-1 font-medium text-primary transition-colors hover:underline cursor-pointer"
            >
              Clear highlight
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ── Grid (row + column virtualized) ── */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className={`${fullscreen ? 'min-h-0 flex-1' : heightClass} overflow-auto rounded-md border bg-background`}
      >
        <table
          className="table-fixed border-separate border-spacing-0 text-xs"
          style={{ width: totalWidth }}
        >
          <colgroup>
            <col style={{ width: ROWNUM_W }} />
            <col style={{ width: CLASS_W }} />
            {visibleHeaders.map((h) => (
              <col key={h} style={{ width: colWidth(h) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-40 border-b bg-muted px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">
                #
              </th>
              <th className="sticky left-14 z-40 border-b bg-muted px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">
                Class
              </th>
              {visibleHeaders.map((h, i) => {
                const critical = CRITICAL_COLUMN.test(h)
                const mapped = mappedTarget.get(h)
                const inWindow = colWindow.has(i)
                const isDrop = dropTarget === h && dragHeader && dragHeader !== h
                if (!inWindow) {
                  return <th key={h} className="border-b border-l bg-muted px-0 py-0" />
                }
                return (
                  <th
                    key={h}
                    draggable
                    onDragStart={(e) => {
                      setDragHeader(h)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (dragHeader && dragHeader !== h) e.preventDefault()
                      setDropTarget(h)
                    }}
                    onDrop={() => {
                      reorder(dragHeader ?? '', h)
                      setDragHeader(null)
                      setDropTarget(null)
                    }}
                    onDragEnd={() => {
                      setDragHeader(null)
                      setDropTarget(null)
                    }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[aria-label^="Resize"]')) return
                      toggleSort(h)
                    }}
                    className={`group relative cursor-pointer border-b border-l bg-muted px-2 py-1.5 text-left align-bottom font-medium ${
                      i === 0 ? 'sticky left-36 z-40' : ''
                    } ${dragHeader === h ? 'opacity-50' : ''} ${
                      isDrop ? 'ring-2 ring-inset ring-primary/60' : ''
                    }`}
                    title={mapped ? `${h} → ${mapped}` : h}
                  >
                    <div className="flex items-start gap-1.5 pr-3">
                      <span
                        className={`block truncate leading-tight ${
                          critical ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {h}
                      </span>
                      {sort?.header === h ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="mt-0.5 size-3 shrink-0 text-foreground" />
                        ) : (
                          <ArrowDown className="mt-0.5 size-3 shrink-0 text-foreground" />
                        )
                      ) : critical ? (
                        <span
                          className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/70"
                          title="Read by reconciliation"
                        />
                      ) : null}
                    </div>
                    {mapped ? (
                      <div className="mt-0.5 truncate text-[10px] font-normal text-primary/80">
                        → {mapped}
                      </div>
                    ) : null}
                    <span
                      onMouseDown={(e) => startResize(h, e)}
                      className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize rounded-sm transition-colors hover:bg-primary/40"
                      aria-label={`Resize ${h}`}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-4 py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              <>
                {topPad > 0 ? (
                  <tr key="pad-top" aria-hidden>
                    <td colSpan={totalCols} style={{ height: topPad }} className="p-0" />
                  </tr>
                ) : null}
                {windowRows.map((r) => {
                  const highlighted = highlightRowNumbers?.includes(r.rowNumber) ?? false
                  return (
                    <tr
                      key={r.rowNumber}
                      style={{ height: rowH }}
                      ref={(el) => {
                        if (el) rowRefs.current.set(r.rowNumber, el)
                        else rowRefs.current.delete(r.rowNumber)
                      }}
                      className={`group transition-colors duration-150 hover:bg-muted/50 ${
                        highlighted ? 'outline outline-1 -outline-offset-1 outline-amber-400' : ''
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-10 border-b px-2 py-0 bg-background group-hover:bg-muted ${
                          r.reviewState === 'red'
                            ? 'border-l-2 border-l-red-500'
                            : r.reviewState === 'yellow'
                              ? 'border-l-2 border-l-amber-400'
                              : 'border-l-2 border-l-transparent'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <span className="tabular-nums text-muted-foreground">{r.rowNumber}</span>
                          {r.reviewState && r.reviewState !== 'green' ? (
                            <span
                              className={`size-1.5 rounded-full ${
                                r.reviewState === 'red' ? 'bg-red-500' : 'bg-amber-500'
                              }`}
                              title={r.reviewState === 'red' ? 'Blocking issue on this row' : 'Warning on this row'}
                            />
                          ) : null}
                          {r.adjusted ? (
                            <span
                              className="size-1.5 rounded-full bg-violet-500"
                              title="Adjusted — raw value untouched, effective value differs"
                            />
                          ) : null}
                        </span>
                      </td>
                      <td className="sticky left-14 z-10 border-b px-2 py-0 bg-background group-hover:bg-muted">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {r.rowClass}
                        </span>
                      </td>
                      {visibleHeaders.map((h, i) => {
                        if (!colWindow.has(i)) {
                          return <td key={h} className="border-b border-l p-0" />
                        }
                        const rawValue = r.raw[h]
                        const empty = isEmpty(rawValue)
                        const raw = String(rawValue ?? '')
                        const issue = cellIssue(r, h)
                        const right = align[h] === 'right'
                        const mono = ID_COLUMN.test(h)
                        const visual = formatCellVisual(raw)
                        const shown = empty ? '—' : (visual ?? raw)
                        return (
                          <td
                            key={h}
                            onClick={() => inspect(r, h)}
                            onDoubleClick={() => inspect(r, h, true)}
                            className={`cursor-pointer border-b border-l px-2 py-0 transition-colors duration-150 hover:bg-accent/60 ${
                              i === 0 ? 'sticky left-36 z-10 bg-background group-hover:bg-muted' : ''
                            } ${
                              issue
                                ? issue.severity === 'red'
                                  ? 'bg-red-50 dark:bg-red-950'
                                  : 'bg-amber-50 dark:bg-amber-950'
                                : ''
                            }`}
                            title={cellTitle(raw, issue)}
                          >
                            <span
                              className={`flex items-center gap-1 ${right ? 'justify-end text-right' : 'justify-start'}`}
                            >
                              {issue ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    inspect(r, h)
                                    openIssue(r, h, issue)
                                  }}
                                  className={`inline-block size-1.5 shrink-0 rounded-full cursor-pointer ${
                                    issue.severity === 'red' ? 'bg-red-500' : 'bg-amber-500'
                                  }`}
                                  aria-label={`Issue ${issue.ruleId}`}
                                />
                              ) : null}
                              <span
                                className={`block truncate ${empty ? 'text-muted-foreground/60' : ''} ${
                                  mono && !right ? 'font-mono' : ''
                                } ${right ? 'tabular-nums' : ''} ${visual && !right ? 'tabular-nums' : ''}`}
                              >
                                {shown}
                              </span>
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {bottomPad > 0 ? (
                  <tr key="pad-bottom" aria-hidden>
                    <td colSpan={totalCols} style={{ height: bottomPad }} className="p-0" />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex flex-wrap items-center gap-3">
          <span>
            <span className="mr-1 inline-block size-1.5 rounded-full bg-primary/70 align-middle" />
            {criticalCount} reconciliation-critical column(s)
          </span>
          <span className="tabular-nums">
            {blockingCount} blocking · {warningCount} warning row(s)
          </span>
          <span>Click a cell for its full raw value — double-click copies it.</span>
        </span>
        {truncatedNote ? <span>{truncatedNote}</span> : null}
      </div>

      {/* ── Issue popover (§5): name, explanation, field, value, action ── */}
      {issuePop ? (
        <>
          <div
            className="fixed inset-0 z-[69]"
            onClick={() => setIssuePop(null)}
            aria-hidden
          />
          <div
            className="fixed z-[70] w-80 rounded-md border bg-popover shadow-lg"
            style={{ left: issuePop.left, top: issuePop.top }}
          >
            <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded-sm px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
                      issuePop.issue.severity === 'red'
                        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
                        : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                    }`}
                  >
                    {issuePop.issue.blocking ? 'Blocking' : 'Warning'}
                  </span>
                  <span className="font-mono text-[11px] font-medium">{issuePop.issue.ruleId}</span>
                </div>
                <p className="text-xs leading-snug text-muted-foreground">
                  {issuePop.issue.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIssuePop(null)}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                aria-label="Close issue"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <dl className="space-y-1 px-3 py-2 text-[11px]">
              <div className="flex gap-2">
                <dt className="w-10 shrink-0 text-muted-foreground">Field</dt>
                <dd className="min-w-0 truncate font-medium" title={issuePop.header}>
                  {issuePop.header}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-10 shrink-0 text-muted-foreground">Row</dt>
                <dd className="font-mono tabular-nums">#{issuePop.row.rowNumber}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-10 shrink-0 text-muted-foreground">Value</dt>
                <dd className="min-w-0 truncate font-mono" title={String(issuePop.row.raw[issuePop.header] ?? '')}>
                  {String(issuePop.row.raw[issuePop.header] ?? '') || '∅'}
                </dd>
              </div>
            </dl>
            <div className="flex items-center gap-1.5 border-t px-2 py-1.5">
              {onViewFinding ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => {
                    onViewFinding(issuePop.issue.ruleId, issuePop.row.rowNumber)
                    setIssuePop(null)
                  }}
                >
                  View affected rows
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => {
                  navigator.clipboard
                    .writeText(String(issuePop.row.raw[issuePop.header] ?? ''))
                    .catch(() => undefined)
                }}
              >
                <Copy className="size-3" /> Copy value
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Full value inspector ── */}
      {inspected ? (
        <div className="fixed bottom-4 right-4 z-[65] w-[min(28rem,calc(100vw-2rem))] rounded-md border bg-popover shadow-lg">
          <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium" title={inspected.header}>
                {inspected.header}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Row #{inspected.row.rowNumber} · {inspected.row.rowClass}
                {cellIssue(inspected.row, inspected.header)
                  ? ` · ${cellIssue(inspected.row, inspected.header)!.ruleId}`
                  : ' · raw source value'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={copyValue}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={copyRow}
                title="Copy the whole row (tab-separated)"
              >
                Copy row
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setInspected(null)}
                aria-label="Close inspector"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-xs leading-relaxed">
            {inspected.value === '' ? '∅ (empty in source file)' : inspected.value}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
