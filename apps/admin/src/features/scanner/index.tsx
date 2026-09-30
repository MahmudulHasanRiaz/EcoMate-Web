import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Html5Qrcode } from 'html5-qrcode'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CheckCircle2, XCircle, AlertTriangle, Info, Camera, CameraOff, ScanLine,
  Truck, Package, Printer, RotateCcw, ExternalLink, Trash2, Play,
} from 'lucide-react'
import {
  scannerApi, ScanPurposeDescriptor, ScanResolveOutcome, ScanResult, ScanDispatchPreview, ScanOrderPreview,
} from '@/features/orders/api'

const PURPOSE_ICONS: Record<string, any> = {
  DISPATCH_HANDED_OVER: Truck,
  DISPATCH_RETURN: RotateCcw,
  ORDER_STATUS: Package,
  STICKER_PRINT: Printer,
}

const RESULT_META: Record<string, { icon: any; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Success' },
  duplicate: { icon: Info, color: 'text-sky-500', label: 'Duplicate' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', label: 'Partial' },
  error: { icon: XCircle, color: 'text-red-500', label: 'Failed' },
}

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Scan failed. Please try again.'
}

interface QueueItem {
  key: string
  identifier: string
  label: string
  sub: string
  allowedStatuses?: { id: string; name: string }[]
}

interface HistoryItem extends ScanResult {
  rid: number
  at: string
}

export default function ScannerPage() {
  const [mode, setMode] = useState<string>('DISPATCH_HANDED_OVER')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [targetStatusId, setTargetStatusId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const ridRef = useRef(0)
  const modeRef = useRef(mode)
  modeRef.current = mode

  const { data: purposes } = useQuery({
    queryKey: ['scanner-purposes'],
    queryFn: () => scannerApi.purposes(),
  })

  const record = useCallback((res: ScanResult) => {
    setHistory((h) => [{ ...res, rid: ++ridRef.current, at: new Date().toISOString() }, ...h].slice(0, 200))
  }, [])

  // ── Batch execute: apply the mode's action to the whole queue ──────────
  const applyBatch = useCallback(async () => {
    if (queue.length === 0 || busy) return
    setBusy(true)
    try {
      const isOrderStatus = modeRef.current === 'ORDER_STATUS'

      // Sticker print batch → the existing bulk print page (chunked, one print).
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
        setTargetStatusId(null)
        setBusy(false)
        inputRef.current?.focus()
        return
      }

      const res = await scannerApi.scan({
        purpose: modeRef.current,
        identifier: queue[0]?.identifier ?? '',
        ...(isOrderStatus
          ? { orderIds: queue.map((q) => q.key), targetStatusId: targetStatusId ?? undefined }
          : { dispatchIds: queue.map((q) => q.key) }),
      })
      record(res)
      if (res.status === 'error') {
        toast.error(res.message)
      } else if (res.status === 'warning') {
        toast.warning(res.message)
      } else {
        toast.success(res.message)
      }
      // Per-order batch results each get their own history entry.
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
      setQueue([])
      setTargetStatusId(null)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }, [busy, queue, targetStatusId, record])

  // ── Scan: resolve → enqueue (never replaces the queue) ──────────────────
  const handleScan = useCallback(async (raw: string) => {
    const identifier = raw.trim()
    if (!identifier || busy) return
    setInput('')
    setBusy(true)
    try {
      const outcome = await scannerApi.resolve(identifier, modeRef.current)
      if (outcome.status === 'not_found') {
        record({ status: 'error', identifier, title: 'Not found', message: outcome.message ?? 'Nothing matched this identifier.' })
        toast.error(outcome.message ?? 'Nothing matched this identifier.')
        return
      }
      if (outcome.status === 'selection_required') {
        // Ambiguous identifier — the pending selection list handles it.
        setQueue((q) => {
          const existing = new Set(q.map((i) => i.key))
          const additions: QueueItem[] = outcome.dispatches
            .filter((d: ScanDispatchPreview) => !existing.has(d.id))
            .map((d: ScanDispatchPreview) => ({
              key: d.id,
              identifier: d.consignmentId,
              label: d.consignmentId,
              sub: `${d.courier} — ${d.status} — Order ${d.orderDisplayId}`,
            }))
          return [...q, ...additions]
        })
        return
      }

      // resolved — enqueue the order/dispatch (duplicates are reported, not re-added)
      if (modeRef.current === 'ORDER_STATUS') {
        const o = outcome.order
        if (!o) {
          record({ status: 'error', identifier, title: 'Not found', message: 'No order found for this identifier.' })
          return
        }
        setQueue((q) => {
          if (q.some((i) => i.key === o.id)) {
            record({ status: 'duplicate', identifier, title: `${o.displayId} — already queued`, message: 'This order is already in the batch queue.', oldState: o.status })
            return q
          }
          return [...q, { key: o.id, identifier: o.displayId, label: o.displayId, sub: o.status, allowedStatuses: o.allowedStatuses }]
        })
        return
      }

      if (modeRef.current === 'STICKER_PRINT') {
        const o = outcome.order
        if (!o) {
          record({ status: 'error', identifier, title: 'Not found', message: 'No order found for this identifier.' })
          return
        }
        setQueue((q) => {
          if (q.some((i) => i.key === o.id)) {
            record({ status: 'duplicate', identifier, title: `${o.displayId} — already queued`, message: 'This order is already in the batch queue.' })
            return q
          }
          return [...q, { key: o.id, identifier: o.displayId, label: o.displayId, sub: o.status }]
        })
        return
      }

      // Dispatch purposes
      const d = outcome.dispatches[0]
      if (!d) {
        record({ status: 'error', identifier, title: 'Not found', message: 'No dispatch found for this identifier.' })
        return
      }
      setQueue((q) => {
        if (q.some((i) => i.key === d.id)) {
          record({ status: 'duplicate', identifier, title: `${d.consignmentId} — already queued`, message: 'This dispatch is already in the batch queue.' })
          return q
        }
        return [...q, { key: d.id, identifier: d.consignmentId, label: d.consignmentId, sub: `${d.courier} — ${d.status} — Order ${d.orderDisplayId}` }]
      })
    } catch (e) {
      toast.error(errMsg(e))
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
      setCameraError('Camera is currently in use or not responding.')
      setCameraActive(false)
    })
    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop().then(() => { scannerRef.current = null }).catch(() => {})
      }
    }
  }, [cameraActive, handleScan])

  useEffect(() => {
    if (!cameraActive) inputRef.current?.focus()
  }, [cameraActive, history])

  // Common target statuses across the whole queue (intersection) — the batch
  // can only apply a transition that EVERY queued order currently allows.
  const commonStatuses = useMemo(() => {
    if (mode !== 'ORDER_STATUS' || queue.length === 0) return []
    const sets = queue.map((q) => new Set((q.allowedStatuses ?? []).map((s) => s.id)))
    const first = sets[0]
    const common = (queue[0].allowedStatuses ?? []).filter((s) => sets.every((set) => set.has(s.id)))
    void first
    return common
  }, [mode, queue])

  const counts = {
    success: history.filter((h) => h.status === 'success').length,
    failed: history.filter((h) => h.status === 'error').length,
    duplicate: history.filter((h) => h.status === 'duplicate').length,
    pending: queue.length,
  }

  const isOrderStatus = mode === 'ORDER_STATUS'
  const isSticker = mode === 'STICKER_PRINT'
  const canApply = queue.length > 0 && !busy && (isOrderStatus ? !!targetStatusId : true)

  return (
    <>
      <Header fixed>
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <ScanLine className="h-5 w-5" /> Scanner
        </h1>
        <div className="ms-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className="flex-1 flex-col gap-4">
        {/* ── Mode selection ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(purposes ?? []).map((p: ScanPurposeDescriptor) => {
            const Icon = PURPOSE_ICONS[p.purpose] ?? ScanLine
            const active = mode === p.purpose
            return (
              <button
                key={p.purpose}
                onClick={() => { setMode(p.purpose); setTargetStatusId(null); inputRef.current?.focus() }}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  active ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent'
                }`}
                title={p.description}
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <span>
                  <span className={`block text-xs font-semibold ${active ? 'text-primary' : ''}`}>{p.label}</span>
                  <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">{p.description}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Scan input (hardware scanner / camera / manual typing) ── */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleScan(input) } }}
                placeholder="Scan barcode / type identifier, then Enter…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <Button
                size="sm"
                variant={cameraActive ? 'default' : 'outline'}
                className="h-8 shrink-0"
                onClick={() => { setCameraActive((v) => !v); setCameraError(null) }}
                title="Toggle camera scanner"
              >
                {cameraActive ? <CameraOff className="h-3.5 w-3.5 mr-1" /> : <Camera className="h-3.5 w-3.5 mr-1" />}
                <span className="hidden sm:inline">{cameraActive ? 'Stop' : 'Camera'}</span>
              </Button>
            </div>
            {cameraActive && (
              <div className="mt-3">
                <div id="scanner-viewport" className="w-full max-w-sm mx-auto rounded-lg overflow-hidden border border-border min-h-[180px] bg-black/5" />
                {cameraError && <p className="text-xs text-destructive text-center mt-2">{cameraError}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Counters ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2">
          {([
            ['Success', counts.success, 'text-emerald-500'],
            ['Failed', counts.failed, 'text-red-500'],
            ['Duplicate', counts.duplicate, 'text-sky-500'],
            ['Pending', counts.pending, 'text-amber-500'],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="rounded-lg border border-border bg-card px-3 py-2 text-center">
              <div className={`text-lg font-bold ${color}`}>{value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Batch queue ────────────────────────────────────────────── */}
        {queue.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Batch queue — {queue.length} item{queue.length === 1 ? '' : 's'}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => { setQueue([]); setTargetStatusId(null) }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5">
                {queue.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
                    <span className="text-xs font-medium truncate">{item.label}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{item.sub}</span>
                    <button
                      className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
                      title="Remove from queue"
                      onClick={() => setQueue((q) => q.filter((i) => i.key !== item.key))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Target status picker — intersection across the queue */}
              {isOrderStatus && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] text-muted-foreground">Apply status:</span>
                  {commonStatuses.length === 0 && (
                    <span className="text-[11px] text-amber-600">No common target status across the queued orders.</span>
                  )}
                  {commonStatuses.map((s) => (
                    <Button
                      key={s.id}
                      size="sm"
                      variant={targetStatusId === s.id ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => setTargetStatusId(s.id)}
                    >
                      → {s.name}
                    </Button>
                  ))}
                </div>
              )}

              <div className="flex justify-end">
                <Button size="sm" disabled={!canApply} onClick={() => void applyBatch()}>
                  <Play className="h-3.5 w-3.5 mr-1" />
                  {busy
                    ? 'Applying…'
                    : isOrderStatus
                      ? `Apply to ${queue.length} order${queue.length === 1 ? '' : 's'}`
                      : isSticker
                        ? `Print ${queue.length} sticker${queue.length === 1 ? '' : 's'}`
                        : `Apply to ${queue.length} dispatch${queue.length === 1 ? '' : 'es'}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Live result list ───────────────────────────────────────── */}
        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scan history <span className="text-muted-foreground font-normal">({history.length})</span></CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {history.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No scans yet. Scan serially — every identifier joins the batch queue; apply one action to all of them.
              </p>
            )}
            {history.map((h) => {
              const meta = RESULT_META[h.status] ?? RESULT_META.error
              const Icon = meta.icon
              return (
                <div key={h.rid} className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{h.title}</span>
                      <Badge variant="secondary" className="text-[10px] h-4">{meta.label}</Badge>
                      {h.courier && <Badge variant="outline" className="text-[10px] h-4">{h.courier}</Badge>}
                      {h.oldState && h.newState && (
                        <span className="text-[10px] text-muted-foreground">{h.oldState} → {h.newState}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{h.message}</p>
                    {h.details?.rtnDisplayId && (
                      <p className="text-xs text-muted-foreground mt-0.5">RTN: {h.details.rtnDisplayId}</p>
                    )}
                    {h.details?.printUrl && (
                      <a
                        href={h.details.printUrl}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                      >
                        <ExternalLink className="h-3 w-3" /> Open sticker print
                      </a>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(h.at).toLocaleTimeString()}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
