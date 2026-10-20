import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Html5Qrcode } from 'html5-qrcode'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  CheckCircle2, XCircle, AlertTriangle, Info, Camera, CameraOff, ScanLine,
  Truck, Package, Printer, RotateCcw, Play, Trash2,
  Activity, X, Loader2, ChevronDown, CircleHelp, ArrowRight, Hourglass,
} from 'lucide-react'
import { StatusBadge, riseStyle } from '@/components/ui/dashboard'
import {
  StagedList, displayCustomer, orderMeta, fmtBDT,
  type StagedRow, type StagedRowExpand, type ExpandItem,
} from '@/features/scanner/staged-list'
import { extractOrderScanCode } from '@/lib/order-display'
import {
  scannerApi, ScanPurposeDescriptor, ScanResult, ScanDispatchPreview, ScanLinkedCandidate,
  ScanItemPreview, ScanOrderPreview,
} from '@/features/orders/api'

/** Operator-facing task names. Backend purpose ids stay technical. */
const TASK_NAMES: Record<string, string> = {
  DISPATCH_HANDED_OVER: 'Hand over dispatch',
  DISPATCH_RETURN: 'Process return',
  ORDER_STATUS: 'Update order status',
  STICKER_PRINT: 'Print sticker',
  RETURN_RECEIVE: 'Receive return / exchange',
}

const TASK_ICONS: Record<string, any> = {
  DISPATCH_HANDED_OVER: Truck,
  DISPATCH_RETURN: RotateCcw,
  ORDER_STATUS: Package,
  STICKER_PRINT: Printer,
  RETURN_RECEIVE: RotateCcw,
}

/** Workspace title + accepted identifiers per task (mirrors the resolver). */
const TASK_HELP: Record<string, { title: string; accept: string; empty: string }> = {
  DISPATCH_HANDED_OVER: {
    title: 'Hand over dispatch',
    accept: 'Scan a courier dispatch ID, tracking code, or order QR/barcode.',
    empty: 'Scan a courier ID or order QR/barcode to begin.',
  },
  DISPATCH_RETURN: {
    title: 'Process return',
    accept: 'Scan a returned courier dispatch ID, tracking code, or order QR/barcode.',
    empty: 'Scan a returned courier ID or order QR/barcode to begin.',
  },
  ORDER_STATUS: {
    title: 'Update order status',
    accept: 'Scan one or more order QR codes / barcodes (ORD-…).',
    empty: 'Scan an order QR code or barcode to begin.',
  },
  STICKER_PRINT: {
    title: 'Print sticker',
    accept: 'Scan an order QR code / barcode (ORD-…).',
    empty: 'Scan an order QR code or barcode to begin.',
  },
  RETURN_RECEIVE: {
    title: 'Receive return / exchange',
    accept: 'Scan an order QR code / barcode (ORD-…) — the linked return or exchange is resolved, never the order itself.',
    empty: 'Scan an order QR code or barcode to receive its linked return.',
  },
}

type FeedTone = 'success' | 'info' | 'warning' | 'danger'

const RESULT_META: Record<string, { icon: any; tone: FeedTone; label: string }> = {
  success: { icon: CheckCircle2, tone: 'success', label: 'Success' },
  duplicate: { icon: Info, tone: 'info', label: 'Already done' },
  warning: { icon: AlertTriangle, tone: 'warning', label: 'Needs action' },
  error: { icon: XCircle, tone: 'danger', label: 'Failed' },
}

type FeedFilter = 'all' | 'success' | 'error' | 'action'

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Scan failed. Please try again.'
}

function relTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const s = Math.floor(diff / 1000)
  if (s < 10) return 'Just now'
  if (s < 60) return `${s} sec ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  return new Date(iso).toLocaleTimeString()
}

interface StagedOrder {
  key: string
  identifier: string
  label: string
  sub: string
  allowedStatuses: { id: string; name: string }[]
  customerName: string
  customerPhone: string
  itemCount: number
  orderTotal: number
  /** Order line previews from the resolve payload — expansion, zero requests. */
  items?: ScanItemPreview[]
}

/**
 * One staged return/exchange leg (RETURN_RECEIVE). A scan NEVER executes
 * RETURN_RECEIVE — it stages; the batch runs only via Process returns, so
 * validation, persistence and re-validation all happen on this list.
 */
interface StagedReturn {
  key: string
  /** Scanned identifier — the process payload reuses it per row. */
  identifier: string
  kind: 'return' | 'exchange'
  legId: string
  displayId: string
  orderDisplayId: string
  status: string
  /** Stage-time validation result. false → attention row, never scanned. */
  processable: boolean
  reason: string | null
  customerName: string
  customerPhone: string
  /** Returned-goods previews (returns) or exchange-order previews. */
  items: ScanItemPreview[]
}

const RETURN_STAGING_KEY = 'ecomate:scanner:return-staged'
const RETURN_STAGING_CAP = 200

/** JSON-guarded restore: malformed or foreign payloads become an empty batch,
 *  never a crash; unknown fields are dropped. */
const sanitizeStagedReturns = (raw: unknown): StagedReturn[] => {
  if (!Array.isArray(raw)) return []
  const rows: StagedReturn[] = []
  for (const r of raw as any[]) {
    if (!r || typeof r.key !== 'string' || typeof r.displayId !== 'string') continue
    if (r.kind !== 'return' && r.kind !== 'exchange') continue
    rows.push({
      key: r.key,
      identifier: typeof r.identifier === 'string' ? r.identifier : '',
      kind: r.kind,
      legId: typeof r.legId === 'string' ? r.legId : r.key,
      displayId: r.displayId,
      orderDisplayId: typeof r.orderDisplayId === 'string' ? r.orderDisplayId : '',
      status: typeof r.status === 'string' ? r.status : '',
      processable: r.processable !== false,
      reason: typeof r.reason === 'string' ? r.reason : null,
      customerName: typeof r.customerName === 'string' ? r.customerName : '',
      customerPhone: typeof r.customerPhone === 'string' ? r.customerPhone : '',
      items: Array.isArray(r.items) ? r.items.slice(0, 50) : [],
    })
  }
  return rows.slice(0, RETURN_STAGING_CAP)
}

/** ScanPreview → expansion item mapping (price formatted, variant+sku sub). */
function toExpandItem(it: ScanItemPreview): ExpandItem {
  return {
    name: it.name,
    sub: [it.variantLabel, it.sku ?? null].filter(Boolean).join(' · ') || undefined,
    image: it.image ?? null,
    quantity: it.quantity,
    price: typeof it.price === 'number' ? fmtBDT(it.price) : undefined,
  }
}

const itemExpand = (heading: string, items?: ScanItemPreview[]): StagedRowExpand | undefined =>
  items && items.length > 0 ? { heading, items: items.map(toExpandItem) } : undefined

/** Fallback label where a dispatch identifier would display but the courier
 *  webhook hasn't filled the consignment id yet (dispatch-table language). */
export const PENDING_WEBHOOK_LABEL = 'Pending webhook'

interface QueuedDispatch {
  key: string
  /**
   * Null until the courier webhook fills the consignment id. Display sites
   * must fall back to PENDING_WEBHOOK_LABEL; scan matching stays key-based
   * (`key === dispatch.id`), so null rows still dedupe — never match-exempt.
   */
  identifier: string | null
  /** Display label — same nullability, same fallback rule. */
  label: string | null
  sub: string
  /** 'order' for sticker rows, 'dispatch' for handover/return rows. */
  rowKind: 'order' | 'dispatch'
  orderId: string
  orderDisplayId: string
  customerName: string
  customerPhone: string
  itemCount: number
  orderTotal: number
  courier: string
  dispatchStatus: string
  /** Order line previews for the expansion panel (dispatch or sticker rows). */
  items?: ScanItemPreview[]
}

/** Dense-row projection — newest-first so the latest scan is on top. */
function orderStagedRow(s: StagedOrder): StagedRow {
  const who = displayCustomer(s.customerName, s.customerPhone)
  const hay = `${s.label} ${s.customerName} ${s.customerPhone} ${who} ${s.sub}`.toLowerCase()
  return {
    key: s.key,
    orderId: s.key,
    primary: s.label,
    customerName: who,
    meta: orderMeta(s.itemCount, s.orderTotal),
    status: s.sub,
    searchText: hay,
    expand: itemExpand('Order items', s.items),
  }
}

function queueStagedRow(q: QueuedDispatch): StagedRow {
  const isDispatch = q.rowKind === 'dispatch'
  const who = displayCustomer(q.customerName, q.customerPhone)
  const label = q.label ?? PENDING_WEBHOOK_LABEL
  const hay = `${label} ${q.orderDisplayId} ${q.customerName} ${q.customerPhone} ${who} ${q.courier} ${q.dispatchStatus} ${q.sub}`.toLowerCase()
  return {
    key: q.key,
    orderId: q.orderId,
    primary: label,
    secondary: isDispatch && q.orderDisplayId && q.orderDisplayId !== label ? q.orderDisplayId : undefined,
    customerName: who,
    meta: isDispatch ? q.courier : orderMeta(q.itemCount, q.orderTotal),
    status: isDispatch ? q.dispatchStatus : q.sub,
    searchText: hay,
    expand: itemExpand('Order items', q.items),
  }
}

/** Staged return row: RETURN items in the expansion (never order items),
 *  coverage-free dense context, amber tint + reason for attention rows. */
function returnStagedRow(r: StagedReturn): StagedRow {
  const who = displayCustomer(r.customerName, r.customerPhone)
  const hay = `${r.displayId} ${r.orderDisplayId} ${r.customerName} ${r.customerPhone} ${who} ${r.status} ${r.reason ?? ''}`.toLowerCase()
  const items = r.items.length > 0 ? r.items.map(toExpandItem) : undefined
  return {
    key: r.key,
    orderId: r.legId,
    primary: r.displayId,
    secondary: r.orderDisplayId || undefined,
    customerName: who,
    phone: r.customerPhone || undefined,
    destKind: r.kind === 'return' ? 'return' : 'order',
    needsAttention: !r.processable,
    reason: r.reason ?? undefined,
    status: r.status,
    searchText: hay,
    expand: items || r.reason
      ? {
          heading: r.kind === 'return' ? 'Returned items' : 'Exchange items',
          items,
          note: r.reason ?? undefined,
        }
      : undefined,
  }
}

interface PendingSelection {
  identifier: string
  message: string
  dispatches: ScanDispatchPreview[]
  /** Linked return/exchange legs (RETURN_RECEIVE picker). */
  linked?: ScanLinkedCandidate[]
  /** Order preview from the same resolve payload — keeps customer context on
   *  picker-staged rows (phone/contact actions, exactly like single-leg). */
  order?: ScanOrderPreview | null
}

interface FeedItem extends ScanResult {
  rid: number
  at: string
}

const FEED_CAP = 200
const FEED_RENDER_CAP = 100

export default function ScannerPage() {
  const [mode, setMode] = useState<string>('DISPATCH_HANDED_OVER')
  const [input, setInput] = useState('')
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [batchMode, setBatchMode] = useState(false)
  const [queue, setQueue] = useState<QueuedDispatch[]>([])
  const [staged, setStaged] = useState<StagedOrder[]>([])
  /** Staged return/exchange legs (RETURN_RECEIVE) — persisted, survives mode
   *  switches and refreshes; cleared only by Clear/processing/removal. */
  const [returnStaged, setReturnStaged] = useState<StagedReturn[]>(() => {
    try {
      const raw = localStorage.getItem(RETURN_STAGING_KEY)
      return raw ? sanitizeStagedReturns(JSON.parse(raw)) : []
    } catch {
      return []
    }
  })
  const returnStagedRef = useRef(returnStaged)
  returnStagedRef.current = returnStaged
  const [selection, setSelection] = useState<PendingSelection | null>(null)
  const [targetStatusId, setTargetStatusId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [confirmApply, setConfirmApply] = useState<null | { kind: 'staged' | 'queue' }>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const ridRef = useRef(0)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const batchRef = useRef(batchMode)
  batchRef.current = batchMode

  const { data: purposes } = useQuery({
    queryKey: ['scanner-purposes'],
    queryFn: () => scannerApi.purposes(),
  })

  // Relative timestamps stay fresh without touching scan state.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  // Staged returns persist across refreshes and task switches (capped).
  useEffect(() => {
    try {
      localStorage.setItem(RETURN_STAGING_KEY, JSON.stringify(returnStaged.slice(0, RETURN_STAGING_CAP)))
    } catch {
      /* storage unavailable/full — batch stays session-only */
    }
  }, [returnStaged])

  const record = useCallback((res: ScanResult) => {
    setFeed((h) => [{ ...res, rid: ++ridRef.current, at: new Date().toISOString() }, ...h].slice(0, FEED_CAP))
  }, [])

  /** Stage one linked return/exchange leg. Validation happens on STAGE so a
   *  RESTOCKED/blocked leg is visible before the batch ever runs; duplicates
   *  keep a single row and log "Already staged". */
  const stageReturnLeg = useCallback((identifier: string, leg: ScanLinkedCandidate, o?: ScanOrderPreview | null) => {
    // Dedupe + feed writes stay OUTSIDE the state updater: React (StrictMode
    // dev) double-invokes updaters, which would double-log the feed event.
    if (returnStagedRef.current.some((i) => i.key === leg.id)) {
      record({ status: 'duplicate', identifier, title: `${leg.displayId} — Already staged`, message: 'This return or exchange is already staged in the batch list.' })
      return
    }
    const processable = leg.processable !== false
    const row: StagedReturn = {
      key: leg.id,
      identifier,
      kind: leg.kind,
      legId: leg.id,
      displayId: leg.displayId,
      orderDisplayId: leg.orderDisplayId ?? o?.displayId ?? '',
      status: leg.status,
      processable,
      reason: leg.reason ?? null,
      customerName: o?.customerName ?? '',
      customerPhone: o?.customerPhone ?? '',
      items: leg.items ?? [],
    }
    record({
      status: processable ? 'success' : 'warning',
      identifier,
      title: `${leg.displayId} — ${processable ? 'Staged' : 'Needs attention'}`,
      message: processable
        ? 'Staged for batch receiving. Process the batch when ready.'
        : leg.reason ?? 'This leg cannot be received in its current state.',
    })
    // Re-check inside the updater for concurrency safety (idempotent either way).
    setReturnStaged((rs) =>
      rs.some((i) => i.key === leg.id) ? rs : [row, ...rs].slice(0, RETURN_STAGING_CAP),
    )
  }, [record])

  const selectMode = useCallback((purpose: string) => {
    setMode(purpose)
    setTargetStatusId(null)
    setStaged([])
    setQueue([])
    setSelection(null)
    inputRef.current?.focus()
  }, [])

  /** Execute a scan purpose and record the confirmed backend result. */
  const runExecute = useCallback(async (payload: {
    identifier: string
    dispatchId?: string
    dispatchIds?: string[]
    orderId?: string
    orderIds?: string[]
    targetStatusId?: string
    returnId?: string
    exchangeId?: string
  }, context?: { customerName?: string; customerPhone?: string; orderDisplayId?: string }) => {
    const res = await scannerApi.scan({ purpose: modeRef.current, ...payload })
    if (context && (context.customerName || context.customerPhone || context.orderDisplayId)) {
      const who = displayCustomer(context.customerName, context.customerPhone)
      res.details = {
        ...(res.details ?? {}),
        customerLine: context.orderDisplayId && context.orderDisplayId !== res.identifier
          ? `${who} · ${context.orderDisplayId}`
          : who,
      }
    }
    record(res)
    // Success lives in the feed — only problems toast, so rapid scanning
    // never buries the operator in dismissals.
    if (res.status === 'error') toast.error(res.message)
    else if (res.status === 'warning') toast.warning(res.message)
    const results = (res as any).details?.results
    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.ok === false) {
          record({
            status: 'error',
            identifier: r.displayId ?? '',
            title: `${r.displayId ?? r.orderId ?? 'Item'} — failed`,
            message: r.message ?? 'Rejected by the state machine.',
            oldState: r.oldStatus,
          })
        }
      }
    }
    return res
  }, [record])

  // ── Scan: resolve → execute immediately (or stage when the task needs
  //    a follow-up choice: dispatch selection, target status) ─────────────
  const handleScan = useCallback(async (raw: string) => {
    const identifier = extractOrderScanCode(raw)
    if (!identifier || busy) return
    setInput('')
    setBusy(true)
    try {
      const outcome = await scannerApi.resolve(identifier, modeRef.current)
      const purpose = modeRef.current

      if (outcome.status === 'not_found') {
        record({ status: 'error', identifier, title: 'Not found', message: outcome.message ?? 'Nothing matched this identifier. Check the code and try again.' })
        toast.error(outcome.message ?? 'Nothing matched this identifier.')
        return
      }

      if (outcome.status === 'selection_required') {
        // Ambiguous — never guess. The inline panel resolves it. For
        // RETURN_RECEIVE the picker lists linked return/exchange legs, never
        // dispatches (the order itself is never a candidate).
        if (purpose === 'RETURN_RECEIVE') {
          const linked = outcome.linked ?? []
          setSelection({ identifier, message: outcome.message ?? 'Multiple returns/exchanges are linked to this order. Select one to continue.', dispatches: [], linked, order: outcome.order ?? null })
          record({ status: 'warning', identifier, title: `${identifier} — Select return or exchange`, message: 'Select which linked return or exchange to receive below.' })
          return
        }
        setSelection({ identifier, message: outcome.message ?? 'Multiple dispatches found. Select the dispatch to continue.', dispatches: outcome.dispatches, order: outcome.order ?? null })
        record({ status: 'warning', identifier, title: `${identifier} — Multiple dispatches found`, message: 'Select which dispatch to process below.' })
        return
      }

      if (purpose === 'RETURN_RECEIVE') {
        // A scan NEVER executes RETURN_RECEIVE — it stages. Exactly one
        // linked leg → stage it; several → the picker (above); none →
        // not_found already returned with the backend "No active…" message.
        const linked = outcome.linked ?? []
        if (linked.length === 1) {
          stageReturnLeg(identifier, linked[0], outcome.order)
          return
        }
        record({ status: 'error', identifier, title: 'Not found', message: outcome.message ?? 'No active return/exchange for this order.' })
        return
      }

      if (purpose === 'ORDER_STATUS') {
        const o = outcome.order
        if (!o) {
          record({ status: 'error', identifier, title: 'Not found', message: 'No order found for this identifier.' })
          return
        }
        setStaged((s) => {
          if (s.some((i) => i.key === o.id)) {
            record({ status: 'duplicate', identifier, title: `${o.displayId} — Already staged`, message: 'This order is already staged for the status update.', oldState: o.status })
            return s
          }
          return [{ key: o.id, identifier: o.displayId, label: o.displayId, sub: o.status, allowedStatuses: o.allowedStatuses, customerName: o.customerName ?? '', customerPhone: o.customerPhone ?? '', itemCount: o.itemCount ?? 0, orderTotal: o.orderTotal ?? 0, items: o.items }, ...s]
        })
        return
      }

      if (purpose === 'STICKER_PRINT') {
        const o = outcome.order
        if (!o) {
          record({ status: 'error', identifier, title: 'Not found', message: 'No order found for this identifier.' })
          return
        }
        if (batchRef.current) {
          setQueue((q) => {
            if (q.some((i) => i.key === o.id)) {
              record({ status: 'duplicate', identifier, title: `${o.displayId} — Already staged`, message: 'This order is already staged for printing.' })
              return q
            }
            return [{ key: o.id, identifier: o.displayId, label: o.displayId, sub: o.status, rowKind: 'order' as const, orderId: o.id, orderDisplayId: o.displayId, customerName: o.customerName ?? '', customerPhone: o.customerPhone ?? '', itemCount: o.itemCount ?? 0, orderTotal: o.orderTotal ?? 0, courier: '', dispatchStatus: '', items: o.items }, ...q]
          })
          return
        }
        await runExecute({ identifier: o.displayId }, { customerName: o.customerName, customerPhone: o.customerPhone, orderDisplayId: o.displayId })
        return
      }

      // Dispatch purposes (handover / return).
      const d = outcome.dispatches[0]
      if (!d) {
        record({ status: 'error', identifier, title: 'Not found', message: 'No dispatch found for this identifier.' })
        return
      }
      if (batchRef.current) {
        setQueue((q) => {
          if (q.some((i) => i.key === d.id)) {
            record({ status: 'duplicate', identifier, title: `${d.consignmentId ?? PENDING_WEBHOOK_LABEL} — Already staged`, message: 'This dispatch is already staged in the batch.' })
            return q
          }
          return [{ key: d.id, identifier: d.consignmentId, label: d.consignmentId, sub: `${d.courier} — ${d.status} — Order ${d.orderDisplayId}`, rowKind: 'dispatch' as const, orderId: d.orderId, orderDisplayId: d.orderDisplayId, customerName: d.customerName ?? '', customerPhone: d.customerPhone ?? '', itemCount: d.itemCount ?? 0, orderTotal: d.orderTotal ?? 0, courier: d.courier, dispatchStatus: d.status, items: d.items }, ...q]
        })
        return
      }
      await runExecute({ identifier: d.consignmentId ?? d.orderDisplayId, dispatchId: d.id }, { customerName: d.customerName, customerPhone: d.customerPhone, orderDisplayId: d.orderDisplayId })
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }, [busy, record, runExecute, stageReturnLeg])

  /** Resolve an ambiguous scan by picking one dispatch inline. */
  const resolveSelection = useCallback(async (d: ScanDispatchPreview) => {
    if (busy) return
    setBusy(true)
    try {
      if (batchRef.current && modeRef.current !== 'ORDER_STATUS' && modeRef.current !== 'STICKER_PRINT') {
        setQueue((q) => q.some((i) => i.key === d.id)
          ? q
          : [{ key: d.id, identifier: d.consignmentId, label: d.consignmentId, sub: `${d.courier} — ${d.status} — Order ${d.orderDisplayId}`, rowKind: 'dispatch' as const, orderId: d.orderId, orderDisplayId: d.orderDisplayId, customerName: d.customerName ?? '', customerPhone: d.customerPhone ?? '', itemCount: d.itemCount ?? 0, orderTotal: d.orderTotal ?? 0, courier: d.courier, dispatchStatus: d.status, items: d.items }, ...q])
      } else {
        await runExecute({ identifier: d.consignmentId ?? d.orderDisplayId, dispatchId: d.id }, { customerName: d.customerName, customerPhone: d.customerPhone, orderDisplayId: d.orderDisplayId })
      }
      setSelection(null)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }, [busy, runExecute])

  /** Return picker resolution: STAGE the picked leg — never executes. The
   *  picker collapses and the operator keeps scanning. */
  const resolveLinked = useCallback((identifier: string, c: ScanLinkedCandidate) => {
    stageReturnLeg(identifier, c, selection?.order ?? null)
    setSelection(null)
    inputRef.current?.focus()
  }, [stageReturnLeg, selection?.order])

  /** Batch apply: one action across the whole staged queue. */
  const applyQueue = useCallback(async () => {
    if (queue.length === 0 || busy) return
    setBusy(true)
    try {
      if (modeRef.current === 'STICKER_PRINT') {
        const ids = queue.map((q) => q.key).join(',')
        window.open(`/admin/op/print/bulk?type=sticker&ids=${encodeURIComponent(ids)}`, '_blank')
        record({
          status: 'success',
          identifier: queue[0]?.identifier ?? '',
          title: `${queue.length} sticker${queue.length === 1 ? '' : 's'} — print ready`,
          message: 'Bulk sticker print opened.',
          details: { printUrl: `/admin/op/print/bulk?type=sticker&ids=${encodeURIComponent(ids)}` },
        })
        setQueue([])
        return
      }
      await runExecute({ identifier: queue[0]?.identifier ?? queue[0]?.orderDisplayId ?? '', dispatchIds: queue.map((q) => q.key) })
      setQueue([])
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }, [busy, queue, record, runExecute])

  /** Order-status apply: one staged order executes singly, several as a batch. */
  const applyStaged = useCallback(async () => {
    if (staged.length === 0 || busy || !targetStatusId) return
    setBusy(true)
    try {
      if (staged.length === 1) {
        await runExecute({ identifier: staged[0].identifier, orderId: staged[0].key, targetStatusId })
      } else {
        await runExecute({ identifier: staged[0].identifier, orderIds: staged.map((s) => s.key), targetStatusId })
      }
      setStaged([])
      setTargetStatusId(null)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }, [busy, staged, targetStatusId, runExecute])

  /**
   * Process the staged RETURN_RECEIVE batch row by row: sequential scans
   * re-validate at PROCESS time against the CURRENT list state (stale rows
   * skipped), settled rows (success/duplicate) leave the list, failed rows
   * stay with the live error reason, attention rows never scan (they were
   * already flagged unprocessable at stage time).
   */
  const processReturns = useCallback(async () => {
    if (busy || returnStagedRef.current.length === 0) return
    setBusy(true)
    try {
      const pending = returnStagedRef.current.filter((r) => r.processable).map((r) => r.key)
      for (const key of pending) {
        const cur = returnStagedRef.current.find((i) => i.key === key)
        if (!cur || !cur.processable) continue
        try {
          const res = await scannerApi.scan({
            purpose: 'RETURN_RECEIVE',
            identifier: cur.identifier,
            ...(cur.kind === 'return' ? { returnId: cur.legId } : { exchangeId: cur.legId }),
          })
          record(res)
          if (res.status === 'success' || res.status === 'duplicate') {
            setReturnStaged((rs) => rs.filter((r) => r.key !== cur.key))
          } else {
            setReturnStaged((rs) => rs.map((r) => r.key === cur.key ? { ...r, processable: false, reason: res.message } : r))
          }
        } catch (e) {
          const msg = errMsg(e)
          record({ status: 'error', identifier: cur.identifier, title: `${cur.displayId} — Failed`, message: msg })
          setReturnStaged((rs) => rs.map((r) => r.key === cur.key ? { ...r, processable: false, reason: msg } : r))
        }
      }
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }, [busy, record])

  // Camera lifecycle — mirrors the packing workspace pattern.
  useEffect(() => {
    if (!cameraActive) {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().then(() => { scannerRef.current = null }).catch(() => {})
      }
      return
    }
    const element = document.getElementById('scanner-viewport')
    if (!element) return
    const html5QrCode = new Html5Qrcode('scanner-viewport')
    scannerRef.current = html5QrCode
    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w: number, h: number) => ({ width: Math.min(w, h) * 0.75, height: Math.min(w, h) * 0.75 }) },
      (decoded) => { void handleScan(decoded) },
      () => {},
    ).catch((err) => {
      console.error('Failed to start html5-qrcode', err)
      setCameraError('Camera is currently in use or not responding. You can keep scanning manually below.')
      setCameraActive(false)
    })
    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop().then(() => { scannerRef.current = null }).catch(() => {})
      }
    }
  }, [cameraActive, handleScan])

  // Input stays ready: focus on load, after camera closes, after every result.
  useEffect(() => {
    if (!cameraActive) inputRef.current?.focus()
  }, [cameraActive, feed])

  // Ops shortcuts: 1–4 switch task (never while typing or picking options).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const list = purposes ?? []
      const idx = ['1', '2', '3', '4'].indexOf(e.key)
      if (idx >= 0 && list[idx]) {
        e.preventDefault()
        selectMode(list[idx].purpose)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [purposes, selectMode])

  // Common target statuses across staged orders (intersection) — a batch can
  // only apply a transition that EVERY staged order currently allows.
  const commonStatuses = useMemo(() => {
    if (mode !== 'ORDER_STATUS' || staged.length === 0) return []
    const sets = staged.map((s) => new Set(s.allowedStatuses.map((a) => a.id)))
    return (staged[0].allowedStatuses ?? []).filter((a) => sets.every((set) => set.has(a.id)))
  }, [mode, staged])

  const successCount = feed.filter((h) => h.status === 'success' || h.status === 'duplicate').length
  const failedCount = feed.filter((h) => h.status === 'error').length
  const actionCount = feed.filter((h) => h.status === 'warning').length + (selection ? 1 : 0)

  const visibleFeed = useMemo(() => {
    const list = feedFilter === 'all'
      ? feed
      : feedFilter === 'success'
        ? feed.filter((h) => h.status === 'success' || h.status === 'duplicate')
        : feedFilter === 'error'
          ? feed.filter((h) => h.status === 'error')
          : feed.filter((h) => h.status === 'warning')
    return list.slice(0, FEED_RENDER_CAP)
  }, [feed, feedFilter])

  const help = TASK_HELP[mode] ?? TASK_HELP.DISPATCH_HANDED_OVER
  const isOrderStatus = mode === 'ORDER_STATUS'
  const isSticker = mode === 'STICKER_PRINT'
  const isReturnReceive = mode === 'RETURN_RECEIVE'
  const isDispatchPurpose = !isOrderStatus && !isSticker && !isReturnReceive
  const showBatchToggle = isDispatchPurpose || isSticker
  const TaskIcon = TASK_ICONS[mode] ?? ScanLine
  const canApplyQueue = queue.length > 0 && !busy
  const canApplyStaged = staged.length > 0 && !busy && !!targetStatusId
  const readyReturns = returnStaged.filter((r) => r.processable).length
  const attentionReturns = returnStaged.length - readyReturns
  const canProcessReturns = readyReturns > 0 && !busy

  const stagedRows = useMemo(() => staged.map(orderStagedRow), [staged])
  const queueRows = useMemo(() => queue.map(queueStagedRow), [queue])
  const returnRows = useMemo(() => returnStaged.map(returnStagedRow), [returnStaged])
  const targetStatusName = commonStatuses.find((s) => s.id === targetStatusId)?.name ?? ''
  const orderHref = useCallback((r: StagedRow) => `/admin/op/orders/${r.orderId}`, [])
  const removeStaged = useCallback((key: string) => setStaged((s) => s.filter((i) => i.key !== key)), [])
  const removeQueued = useCallback((key: string) => setQueue((q) => q.filter((i) => i.key !== key)), [])

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25 shrink-0">
            <ScanLine className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight leading-tight">Scanner</h1>
            <p className="hidden sm:block text-[11px] text-muted-foreground leading-tight truncate">Scan dispatches and orders to perform operational actions.</p>
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className="flex-1 flex-col">
        <div className="w-full flex flex-col gap-3">
          {/* ── Scan task (compact configuration, not a dashboard grid) ── */}
          <section aria-label="Scan task" className="animate-rise">
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <label htmlFor="scan-task" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Scan task
                </label>
                <div className="relative">
                  <select
                    id="scan-task"
                    value={mode}
                    onChange={(e) => selectMode(e.target.value)}
                    className="h-10 w-full appearance-none rounded-xl border border-border bg-card pl-3 pr-9 text-sm font-semibold outline-none transition-colors duration-200 cursor-pointer hover:border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {(purposes ?? []).map((p: ScanPurposeDescriptor, i: number) => (
                      <option key={p.purpose} value={p.purpose}>
                        {i + 1} · {TASK_NAMES[p.purpose] ?? p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </div>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="tap-h press shrink-0" title="How scanning works">
                    <CircleHelp className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">How it works</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="text-sm">How scanning works</DialogTitle>
                    <DialogDescription className="text-xs">Pick a task, scan, read the result, scan the next one.</DialogDescription>
                  </DialogHeader>
                  <ol className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                    <li><span className="font-semibold text-foreground">1.</span> Choose the scan task above.</li>
                    <li><span className="font-semibold text-foreground">2.</span> Scan a barcode or type the code, then Enter.</li>
                    <li><span className="font-semibold text-foreground">3.</span> The action runs at once — the result appears below.</li>
                    <li><span className="font-semibold text-foreground">4.</span> The input stays ready for the next scan.</li>
                  </ol>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 text-xs">
                    <p className="mb-1.5 font-semibold">Keyboard shortcuts</p>
                    <div className="flex flex-col gap-1 text-muted-foreground">
                      <p><kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold">Enter</kbd> submit a typed code</p>
                      <p><kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold">Esc</kbd> clear the scan input</p>
                      <p><kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold">1–4</kbd> switch scan task</p>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </section>

          {/* ── Primary scan workspace ─────────────────────────────────── */}
          <section aria-label="Scan workspace" className="animate-rise" style={riseStyle(1)}>
            <Card className="chart-card rounded-2xl overflow-hidden">
              <div className="h-0.5 bg-primary" aria-hidden />
              <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
                    <TaskIcon className="h-4 w-4 text-primary" aria-hidden />
                    {help.title}
                  </h2>
                  {showBatchToggle && (
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground cursor-pointer" title="Stage scans and apply one action to all of them at once. Off = every scan runs at once.">
                      <Switch checked={batchMode} onCheckedChange={(v) => { setBatchMode(v); setQueue([]) }} aria-label="Batch mode" />
                      Batch
                    </label>
                  )}
                </div>

                <div
                  className={`flex items-center gap-2 rounded-xl border bg-muted/20 px-3 transition-colors duration-200 focus-within:border-primary focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/25 ${
                    busy ? 'border-border/60' : 'border-border'
                  }`}
                >
                  <span className="shrink-0 text-muted-foreground" aria-hidden>
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5" />}
                  </span>
                  <label htmlFor="scanner-input" className="sr-only">Scan or enter identifier</label>
                  <input
                    id="scanner-input"
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleScan(input) }
                      else if (e.key === 'Escape' && input) { e.preventDefault(); setInput('') }
                    }}
                    placeholder="Scan or enter identifier…"
                    className="h-13 min-w-0 flex-1 bg-transparent py-3.5 font-mono text-[15px] tracking-tight outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground"
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-describedby="scanner-help"
                  />
                  {input && (
                    <button
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                      title="Clear input (Esc)"
                      aria-label="Clear scan input"
                      onClick={() => { setInput(''); inputRef.current?.focus() }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="tap-h press shrink-0 text-muted-foreground"
                    onClick={() => { setCameraActive((v) => !v); setCameraError(null) }}
                    title={cameraActive ? 'Close camera' : 'Open camera scanner'}
                    aria-pressed={cameraActive}
                    aria-label={cameraActive ? 'Close camera scanner' : 'Open camera scanner'}
                  >
                    {cameraActive ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <p id="scanner-help" className="text-xs text-muted-foreground">{help.accept}</p>
                  <kbd className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Enter ↵</kbd>
                </div>

                {cameraActive && (
                  <div className="rounded-xl border border-border bg-black/[0.03] p-2 dark:bg-white/[0.03]">
                    <div className="flex items-center justify-between px-1 pb-2">
                      <p className="text-[11px] font-semibold text-muted-foreground">Camera scanner</p>
                      <Button variant="ghost" size="sm" className="tap-h press text-xs" onClick={() => setCameraActive(false)}>
                        <X className="h-3.5 w-3.5 mr-1" /> Close
                      </Button>
                    </div>
                    <div id="scanner-viewport" className="w-full max-w-sm mx-auto rounded-xl overflow-hidden border border-border min-h-[180px] bg-black/5" />
                    {cameraError && <p className="text-xs text-destructive text-center mt-2" role="alert">{cameraError}</p>}
                  </div>
                )}

                {/* ── Inline dispatch resolution (never leave the page) ── */}
                {selection && (
                  <div className="rounded-xl border border-warning/40 bg-warning-soft/40 p-2.5 flex flex-col gap-2" role="group" aria-label="Select dispatch">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">
                        {selection.linked?.length
                          ? `${selection.linked.length} linked returns/exchanges found for `
                          : `${selection.dispatches.length} dispatches found for `}
                        <span className="font-mono">{selection.identifier}</span>
                      </p>
                      <button
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                        aria-label="Dismiss dispatch selection"
                        onClick={() => { setSelection(null); inputRef.current?.focus() }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {selection.linked?.length ? (
                      <>
                        <p className="text-[11px] text-muted-foreground -mt-1">Select the return or exchange to receive — the scanner stays ready.</p>
                        <div className="flex flex-col gap-1.5">
                          {selection.linked.map((c) => (
                            <div key={c.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.kind === 'return' ? 'Return' : 'Exchange'}</p>
                                <p className="font-mono text-sm font-semibold truncate">{c.displayId}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{c.status}</p>
                              </div>
                              <Button
                                size="sm"
                                className="tap-h press shrink-0"
                                disabled={busy}
                                aria-label={`Select ${c.displayId}`}
                                onClick={() => void resolveLinked(selection.identifier, c)}
                              >
                                Select <ArrowRight className="h-3.5 w-3.5 ml-1" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                    <>
                    <p className="text-[11px] text-muted-foreground -mt-1">Select the dispatch to {batchMode && isDispatchPurpose ? 'stage' : 'process'} — the scanner stays ready.</p>
                    <div className="flex flex-col gap-1.5">
                      {selection.dispatches.map((d) => (
                        <div key={d.id} className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{d.courier}</p>
                            <p className="font-mono text-sm font-semibold truncate">{d.consignmentId ?? PENDING_WEBHOOK_LABEL}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{d.status} · Order {d.orderDisplayId}</p>
                          </div>
                          <Button
                            size="sm"
                            className="tap-h press shrink-0"
                            disabled={busy}
                            aria-label={`Select ${d.consignmentId ?? PENDING_WEBHOOK_LABEL} (${d.courier})`}
                            onClick={() => void resolveSelection(d)}
                          >
                            Select <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    </>
                    )}
                  </div>
                )}

                {/* ── Dense staged list (one compact row per scan) ────── */}
                {isOrderStatus && staged.length > 0 && (
                  <StagedList
                    title="Staged orders"
                    items={stagedRows}
                    orderHref={orderHref}
                    onRemove={removeStaged}
                    onClear={() => { setStaged([]); setTargetStatusId(null) }}
                    footer={
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold text-muted-foreground">Move to:</span>
                        {commonStatuses.length === 0 && (
                          <span className="text-[11px] text-warning">These orders share no common next status.</span>
                        )}
                        <div className="flex flex-wrap gap-1.5" aria-label="Target status">
                          {commonStatuses.map((s) => {
                            const selected = targetStatusId === s.id
                            return (
                              <Button
                                key={s.id}
                                size="sm"
                                variant={selected ? 'default' : 'outline'}
                                className="tap-h press rounded-full text-xs"
                                aria-pressed={selected}
                                onClick={() => setTargetStatusId(s.id)}
                              >
                                {selected ? <CheckCircle2 className="h-3 w-3 mr-1" /> : null}→ {s.name}
                              </Button>
                            )
                          })}
                        </div>
                        <Button
                          size="sm"
                          className="tap-h press w-full"
                          disabled={!canApplyStaged}
                          onClick={() => (staged.length > 1 ? setConfirmApply({ kind: 'staged' }) : void applyStaged())}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                          {busy ? 'Applying…' : `Apply to ${staged.length} order${staged.length === 1 ? '' : 's'}`}
                        </Button>
                        {!targetStatusId && (
                          <p className="text-[11px] text-muted-foreground text-center">Pick a target status to continue.</p>
                        )}
                      </div>
                    }
                  />
                )}

                {/* ── Batch staging (explicit secondary workflow) ──────── */}
                {batchMode && (isDispatchPurpose || isSticker) && queue.length > 0 && (
                  <StagedList
                    title={isSticker ? 'Staged prints' : 'Staged dispatches'}
                    items={queueRows}
                    orderHref={orderHref}
                    onRemove={removeQueued}
                    onClear={() => setQueue([])}
                    footer={
                      <Button
                        size="sm"
                        className="tap-h press w-full"
                        disabled={!canApplyQueue}
                        onClick={() => {
                          if (isSticker || queue.length <= 1) { void applyQueue(); return }
                          setConfirmApply({ kind: 'queue' })
                        }}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        {busy
                          ? 'Applying…'
                          : isSticker
                            ? `Print ${queue.length} sticker${queue.length === 1 ? '' : 's'}`
                            : `Apply to ${queue.length} dispatch${queue.length === 1 ? '' : 'es'}`}
                      </Button>
                    }
                  />
                )}

                {/* ── Staged returns: stage-only batch, processed explicitly ── */}
                {isReturnReceive && returnStaged.length > 0 && (
                  <StagedList
                    title="Staged returns"
                    items={returnRows}
                    orderHref={(r) => (r.destKind === 'return' ? `/admin/op/returns/${r.orderId}` : `/admin/op/orders/${r.orderId}`)}
                    openLabel={(r) => (r.destKind === 'return' ? `Open return ${r.secondary ?? r.primary}` : `Open order ${r.secondary ?? r.primary}`)}
                    onRemove={(key) => setReturnStaged((rs) => rs.filter((r) => r.key !== key))}
                    onClear={() => setReturnStaged([])}
                    clearConfirm={(n) => `${n} staged return${n === 1 ? '' : 's'} will be removed. Unprocessed legs stay untouched — nothing is executed by clearing.`}
                    footer={
                      <Button
                        size="sm"
                        className="tap-h press w-full"
                        disabled={!canProcessReturns}
                        onClick={() => void processReturns()}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        {busy
                          ? 'Processing…'
                          : `Process returns (${readyReturns} ready${attentionReturns > 0 ? ` · ${attentionReturns} need attention` : ''})`}
                      </Button>
                    }
                  />
                )}

                {/* ── Bulk mutation confirmation (scope always explicit) ── */}
                <Dialog open={confirmApply !== null} onOpenChange={(open) => { if (!open) setConfirmApply(null) }}>
                  <DialogContent className="max-w-xs">
                    <DialogHeader>
                      <DialogTitle className="text-sm">
                        {confirmApply?.kind === 'staged'
                          ? `Move ${staged.length} order${staged.length === 1 ? '' : 's'} to ${targetStatusName}?`
                          : `Apply to ${queue.length} dispatch${queue.length === 1 ? '' : 'es'}?`}
                      </DialogTitle>
                      <DialogDescription className="text-xs">
                        {confirmApply?.kind === 'staged'
                          ? `${staged.length} order${staged.length === 1 ? '' : 's'} will be updated. Every transition is validated against the order state machine.`
                          : `${queue.length} dispatch${queue.length === 1 ? '' : 'es'} will be processed. Each keeps its own idempotency guard.`}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" size="sm" onClick={() => setConfirmApply(null)}>Cancel</Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => { const k = confirmApply?.kind; setConfirmApply(null); void (k === 'staged' ? applyStaged() : applyQueue()) }}
                      >
                        Confirm
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </section>

          {/* ── Compact operational summary (never competes with scanner) ─ */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground animate-rise" style={riseStyle(2)} aria-label="Session summary">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              <strong className="font-semibold text-foreground tabular-nums">{successCount}</strong> successful
            </span>
            <span className="inline-flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden />
              <strong className="font-semibold text-foreground tabular-nums">{failedCount}</strong> failed
            </span>
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
              <strong className="font-semibold text-foreground tabular-nums">{actionCount}</strong> need action
            </span>
            {batchMode && queue.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Hourglass className="h-3.5 w-3.5" aria-hidden />
                <strong className="font-semibold text-foreground tabular-nums">{queue.length}</strong> staged
              </span>
            )}
          </div>

          {/* ── Recent scans (the primary activity workspace) ──────────── */}
          <section aria-label="Recent scans" className="animate-rise" style={riseStyle(3)}>
            <Card className="chart-card rounded-2xl">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="chart-card-header-icon bg-accent-violet-soft text-accent-violet border border-accent-violet/25 shrink-0">
                      <Activity className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-sm truncate">Recent scans <span className="text-muted-foreground font-normal">({feed.length})</span></CardTitle>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="seg-control" role="tablist" aria-label="Filter recent scans">
                      {(['all', 'success', 'error', 'action'] as const).map((f) => (
                        <button
                          key={f}
                          role="tab"
                          aria-selected={feedFilter === f}
                          data-active={feedFilter === f}
                          className="seg-item !min-h-7 !px-2 !text-[11px]"
                          onClick={() => setFeedFilter(f)}
                        >
                          {f === 'all' ? 'All' : f === 'error' ? 'Failed' : f === 'action' ? 'Needs action' : 'Success'}
                        </button>
                      ))}
                    </div>
                    {feed.length > 0 && (
                      <Button variant="ghost" size="sm" className="tap-h press text-xs text-muted-foreground" onClick={() => setFeed([])}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {feed.length === 0 && (
                  <div className="empty-state !py-8">
                    <span className="empty-state-icon" aria-hidden>
                      <ScanLine className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Ready to scan</p>
                      <p className="text-xs mt-0.5">{help.empty}</p>
                    </div>
                  </div>
                )}
                {feed.length > 0 && visibleFeed.length === 0 && (
                  <div className="empty-state !py-8">
                    <p className="text-sm text-muted-foreground">
                      No {feedFilter === 'error' ? 'failed' : feedFilter === 'action' ? 'action-needed' : 'successful'} scans in this session.
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto pr-0.5" role="log" aria-live="polite" aria-label="Recent scans">
                  {visibleFeed.map((h) => {
                    const meta = RESULT_META[h.status] ?? RESULT_META.error
                    const Icon = meta.icon
                    return (
                      <div key={h.rid} className="flex items-start gap-2.5 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 transition-colors duration-200 hover:bg-muted/40">
                        <span className={`kpi-icon-badge kpi-accent-${meta.tone} shrink-0 mt-0.5`} aria-hidden>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] font-semibold leading-snug">{h.title}</span>
                            <StatusBadge tone={meta.tone} icon={null} className="text-[10px]">{meta.label}</StatusBadge>
                            {h.courier && <Badge variant="outline" className="text-[10px] font-mono">{h.courier}</Badge>}
                          </div>
                          {(h.oldState || h.newState) && (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
                              {h.oldState && <span className="max-w-[140px] truncate">{h.oldState}</span>}
                              {h.oldState && h.newState && <span aria-hidden>→</span>}
                              {h.newState && <span className="max-w-[140px] truncate font-medium text-foreground">{h.newState}</span>}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{h.message}</p>
                          {typeof h.details?.customerLine === 'string' && h.details.customerLine && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80" title={h.details.customerLine}>
                              {h.details.customerLine}
                            </p>
                          )}
                          {h.details?.rtnDisplayId && !h.message.includes(h.details.rtnDisplayId) && (
                            <p className="font-mono text-[11px] text-muted-foreground mt-0.5">RTN: {h.details.rtnDisplayId}</p>
                          )}
                          {h.details?.printUrl && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="tap-h press mt-1.5 text-xs"
                              onClick={() => window.open(h.details!.printUrl, '_blank')}
                            >
                              <Printer className="h-3.5 w-3.5 mr-1" /> Print sticker
                            </Button>
                          )}
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums" title={new Date(h.at).toLocaleString()}>
                          {relTime(h.at, now)}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {feed.length > FEED_RENDER_CAP && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    Showing latest {FEED_RENDER_CAP} of {feed.length} scans.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </Main>
    </>
  )
}
