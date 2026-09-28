import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, BadgeDollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  useColumnMappings,
  useCourierSettlementMutations,
  useInvoice,
  useInvoiceActivity,
  useInvoiceAdjustments,
} from './hooks'
import { ExceptionBadge, InvoiceStateBadge, ReviewStateDot } from './state-badge'
import { SourceSheet, type SheetFinding, type SheetRow } from './source-sheet'
import { courierSettlementApi } from './api'
import type { ExceptionItem, InvoiceRow } from './api'

const bdt = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : `৳${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const TOTAL_KEYS = ['collected', 'charges', 'net', 'residual', 'cashReceived', 'cashDisbursed'] as const
const TOTAL_LABEL: Record<string, string> = {
  collected: 'Collected',
  charges: 'Charges',
  net: 'Net',
  residual: 'Residual',
  cashReceived: 'Cash received',
  cashDisbursed: 'Cash disbursed',
}

function TotalsGrid({ totals }: { totals: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TOTAL_KEYS.map((k) => (
        <div key={k} className="rounded-xl border border-border/50 bg-muted/20 p-3 transition-colors duration-200">
          <div className="text-xs text-muted-foreground">{TOTAL_LABEL[k]}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{bdt(totals[k])}</div>
        </div>
      ))}
    </div>
  )
}

/* ── Sheet: RAW source values only (§9 contract). Never an effective figure.
     Same viewer as the import preview — every original column, original order,
     original row numbers, 100 % inspectable. ── */
function SheetTab({
  rows,
  exceptions,
  invoiceId,
  courier,
  sourceHeaders,
  highlight,
  onClearHighlight,
}: {
  rows: InvoiceRow[]
  exceptions: ExceptionItem[]
  invoiceId: string
  courier: string
  sourceHeaders?: string[] | null
  highlight: number[]
  onClearHighlight: () => void
}) {
  const mappings = useColumnMappings(courier)

  // Original source schema. Prefer the frozen file-order array captured at
  // import (jsonb re-sorts rawJson keys — length-then-byte — so the union
  // fallback cannot reproduce the file's column order).
  const headers = useMemo(() => {
    if (sourceHeaders && sourceHeaders.length > 0) return sourceHeaders
    const keys: string[] = []
    for (const r of rows) {
      const raw = (r.rawJson ?? {}) as Record<string, unknown>
      for (const k of Object.keys(raw)) if (!keys.includes(k)) keys.push(k)
    }
    return keys
  }, [rows, sourceHeaders])

  // Invoice-level exceptions → per-row findings, so the cell that carries the
  // problem is the cell that gets the indicator.
  const findingsByRow = useMemo(() => {
    const map = new Map<string, SheetFinding[]>()
    const rowIdSet = new Set(rows.map((r) => r.id))
    for (const e of exceptions) {
      if (!e.rowId || !rowIdSet.has(e.rowId)) continue
      const list = map.get(e.rowId) ?? []
      list.push({
        ruleId: e.ruleId,
        severity: e.severity === 'red' ? 'red' : 'yellow',
        blocking: e.blocked,
        message: e.message ?? e.ruleId,
      })
      map.set(e.rowId, list)
    }
    return map
  }, [rows, exceptions])

  const sheetRows = useMemo<SheetRow[]>(
    () =>
      rows.map((r) => ({
        rowNumber: r.rowNumber,
        rowClass: r.rowClass,
        rowKind: r.rowKind,
        identifier: r.consignmentId ?? r.identifier,
        matchMethod: r.matchMethod,
        reviewState: r.reviewState,
        raw: Object.fromEntries(
          Object.entries((r.rawJson ?? {}) as Record<string, unknown>).map(([k, v]) => [
            k,
            v === undefined || v === null ? '' : String(v),
          ]),
        ),
        findings: findingsByRow.get(r.id),
        adjusted: r.hasAdjustment,
      })),
    [rows, findingsByRow],
  )

  const mappingList = (mappings.data?.data ?? [])
    .filter((m) => m.active !== false)
    .map((m) => ({
      sourceHeader: m.sourceHeader,
      targetField: m.fieldLabel ?? m.field,
    }))

  if (rows.length === 0) return <p className="py-8 text-center text-muted-foreground">No rows.</p>

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          Raw source values exactly as parsed from the file — every column, in source order.
          Adjustments show as a marker; effective figures live in Reconciliation.
        </p>
        <a
          href={courierSettlementApi.sourceFileUrl(invoiceId)}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary transition-colors hover:underline"
        >
          View original file
        </a>
      </div>
      <SourceSheet
        rows={sheetRows}
        headers={headers}
        mappings={mappingList}
        highlightRowNumbers={highlight}
        onClearHighlight={onClearHighlight}
        emptyMessage="No rows match the current search and filters."
      />
    </div>
  )
}

/* ── Reconciliation: EFFECTIVE figures + match explanation + row actions. ── */
function ReconciliationTab({ rows }: { rows: InvoiceRow[] }) {
  const { manualMatch, revalidateRow } = useCourierSettlementMutations()
  const [matchRow, setMatchRow] = useState<InvoiceRow | null>(null)
  const [orderId, setOrderId] = useState('')
  const [reason, setReason] = useState('')

  const doMatch = () => {
    if (!matchRow || !orderId.trim()) return
    manualMatch.mutate(
      { rowId: matchRow.id, orderId: orderId.trim(), reason: reason || undefined },
      {
        onSuccess: () => {
          setMatchRow(null)
          setOrderId('')
          setReason('')
        },
      },
    )
  }

  if (rows.length === 0) return <p className="py-8 text-center text-muted-foreground">No rows.</p>

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        Effective values (adjustments applied, superseded rows excluded) — the figures every
        financial surface uses.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border/50">
        <Table className="dash-table">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Consignment</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Match</TableHead>
              <TableHead className="text-right">Collected</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Residual</TableHead>
              <TableHead>Review</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{r.rowNumber}</TableCell>
                <TableCell className="font-mono text-xs">{r.consignmentId ?? '—'}</TableCell>
                <TableCell>{r.order?.displayId ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.matchMethod}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{bdt(r.effectiveCollected)}</TableCell>
                <TableCell className="text-right tabular-nums">{bdt(r.effectiveCharges)}</TableCell>
                <TableCell className="text-right tabular-nums">{bdt(r.effectiveNet)}</TableCell>
                <TableCell className="text-right tabular-nums">{bdt(r.effectiveResidual)}</TableCell>
                <TableCell>
                  <ReviewStateDot state={r.reviewState} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" size="sm" className="tap-h" onClick={() => setMatchRow(r)}>
                      Match
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="tap-h"
                      onClick={() => revalidateRow.mutate(r.id)}
                      disabled={revalidateRow.isPending}
                    >
                      Re-check
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!matchRow} onOpenChange={(v) => !v && setMatchRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual match</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Row #{matchRow?.rowNumber} ({matchRow?.consignmentId ?? 'no consignment id'}) → order.
              Matching is re-run after the change; a bad match can drop a stale link.
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium">Order ID or display ID</label>
              <Input
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="ORD-260901-0001"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Reason (audited)</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="tap-h" onClick={() => setMatchRow(null)}>
              Cancel
            </Button>
            <Button className="tap-h" onClick={doMatch} disabled={!orderId.trim() || manualMatch.isPending}>
              {manualMatch.isPending ? 'Matching…' : 'Match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ExceptionsTab({
  invoiceId,
  exceptions,
  rows,
  onViewRow,
}: {
  invoiceId: string
  exceptions: ExceptionItem[]
  rows?: InvoiceRow[]
  onViewRow?: (rowNumber: number) => void
}) {
  const { acknowledge } = useCourierSettlementMutations()
  const rowNumberById = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows ?? []) map.set(r.id, r.rowNumber)
    return map
  }, [rows])
  if (exceptions.length === 0)
    return <p className="py-8 text-center text-muted-foreground">No exceptions.</p>

  return (
    <div className="overflow-x-auto rounded-xl border border-border/50">
      <Table className="dash-table">
        <TableHeader>
          <TableRow>
            <TableHead>Severity</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exceptions.map((e) => (
            <TableRow key={e.id}>
              <TableCell>
                <ExceptionBadge severity={e.severity} status={e.status} />
              </TableCell>
              <TableCell className="font-mono text-xs">{e.ruleId}</TableCell>
              <TableCell>{e.message ?? '—'}</TableCell>
              <TableCell className="capitalize">{e.status}</TableCell>
              <TableCell className="text-right">
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {e.rowId !== undefined && e.rowId !== null && rowNumberById.has(e.rowId) && onViewRow ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="tap-h"
                      onClick={() => onViewRow(rowNumberById.get(e.rowId as string)!)}
                    >
                      Sheet row {rowNumberById.get(e.rowId as string)}
                    </Button>
                  ) : null}
                  {e.severity === 'yellow' && e.status === 'open' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="tap-h"
                      onClick={() =>
                        acknowledge.mutate({ invoiceId, exceptionId: e.id })
                      }
                      disabled={acknowledge.isPending}
                    >
                      Acknowledge
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {e.severity === 'red' ? 'Resolve the issue' : '—'}
                    </span>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AdjustmentsTab({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading } = useInvoiceAdjustments(invoiceId)
  const { reverseAdjustment } = useCourierSettlementMutations()
  const [pending, setPending] = useState<string | null>(null)

  if (isLoading) return <p className="py-8 text-center text-muted-foreground">Loading…</p>
  if (!data || data.length === 0)
    return <p className="py-8 text-center text-muted-foreground">No adjustments yet.</p>

  return (
    <div className="overflow-x-auto rounded-xl border border-border/50">
      <Table className="dash-table">
        <TableHeader>
          <TableRow>
            <TableHead>Class</TableHead>
            <TableHead>Field</TableHead>
            <TableHead>Original (raw)</TableHead>
            <TableHead>Adjusted (raw)</TableHead>
            <TableHead className="text-right">Difference</TableHead>
            <TableHead>Counterpart</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Journal</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Badge variant="outline">{a.adjustmentClass}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{a.field}</TableCell>
              <TableCell className="font-mono text-xs">{a.originalValue ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{a.adjustedValue ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {a.difference === null ? '—' : bdt(a.difference)}
              </TableCell>
              <TableCell className="capitalize">{a.counterpart ?? '—'}</TableCell>
              <TableCell className="max-w-[220px] truncate" title={a.reason ?? ''}>
                {a.reason ?? '—'}
              </TableCell>
              <TableCell className="font-mono text-xs">{a.journalEntryId ?? '—'}</TableCell>
                <TableCell className="text-right">
                  {a.reversedById ? (
                    <span className="text-xs text-muted-foreground">reversed</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="tap-h"
                      onClick={() => setPending(a.id)}
                    >
                      Reverse
                    </Button>
                  )}
                </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ReverseDialog
        adjustmentId={pending}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending) return
          reverseAdjustment.mutate(
            { adjustmentId: pending, reason },
            {
              onSuccess: () => setPending(null),
            },
          )
        }}
        busy={reverseAdjustment.isPending}
      />
    </div>
  )
}

function ReverseDialog({
  adjustmentId,
  onClose,
  onConfirm,
  busy,
}: {
  adjustmentId: string | null
  onClose: () => void
  onConfirm: (reason: string) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Dialog
      open={!!adjustmentId}
      onOpenChange={(v) => {
        if (!v) {
          setReason('')
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse adjustment</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Posts a compensating record. Reversal never deletes the original and never posts a
            journal the original did not have.
          </p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being reversed?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" className="tap-h" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="tap-h"
            disabled={!reason.trim() || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? 'Reversing…' : 'Reverse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ActivityTab({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading } = useInvoiceActivity(invoiceId)
  if (isLoading) return <p className="py-8 text-center text-muted-foreground">Loading…</p>
  if (!data || data.length === 0)
    return <p className="py-8 text-center text-muted-foreground">No activity yet.</p>

  return (
    <ol className="space-y-2">
      {data.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-border/50 bg-muted/20 p-3 transition-colors duration-200 hover:bg-muted/40">
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {new Date(a.timestamp).toLocaleString()}
          </span>
          <Badge variant="outline" className="shrink-0">{a.action}</Badge>
          <span className="text-sm">{a.actor ?? 'system'}</span>
          {a.detail ? (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(a.detail)}>
              {JSON.stringify(a.detail)}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/* ── Overview (Q12): identity, health and what must happen next. ── */
function OverviewTab({
  invoice,
  historical,
  effective,
}: {
  invoice: any
  historical: any
  effective: any
}) {
  const exceptions = invoice.exceptions ?? []
  const red = exceptions.filter((e: any) => e.severity === 'red' && e.status === 'open').length
  const yellow = exceptions.filter((e: any) => e.severity === 'yellow' && e.status === 'open').length
  const rows = invoice.rows ?? []
  const matched = rows.filter((r: any) => r.matchMethod !== 'NONE').length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Courier" value={invoice.courier} capitalize />
        <Figure label="Provider invoice no" value={invoice.invoiceNo ?? '—'} />
        <Figure label="Invoice date" value={new Date(invoice.invoiceDate).toLocaleDateString()} />
        <Figure label="Imported" value={new Date(invoice.createdAt).toLocaleString()} />
        <Figure label="Rows (page shown)" value={`${rows.length} of ${invoice.rowCount}`} />
        <Figure label="Matched on this page" value={`${matched} of ${rows.length}`} />
        <Figure label="Open RED" value={String(red)} />
        <Figure label="Open YELLOW" value={String(yellow)} />
        <Figure label="Accounting" value={invoice.accountingStatus ?? '—'} />
        <Figure
          label="Snapshot"
          value={historical ? `v${historical.version} · ${new Date(historical.takenAt).toLocaleString()}` : 'none yet'}
        />
        <Figure label="Effective net" value={bdt(effective.effectiveTotals?.net)} strong />
        <Figure label="Rows under revisions" value={String(effective.supersededRows ?? 0)} />
      </div>
      <div className="rounded-xl border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">
        Current effective totals are shown above the tabs and never change when you switch tabs —
        the sheet is always the raw file, Reconciliation is always the effective figures, and
        Activity is the audit trail.
      </div>
    </div>
  )
}

function Figure({
  label,
  value,
  strong,
  capitalize,
}: {
  label: string
  value: string
  strong?: boolean
  capitalize?: boolean
}) {
  return (
    <div className="rounded-xl border border-border/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`${strong ? 'text-lg font-semibold' : 'text-sm font-medium'} tabular-nums truncate ${
          capitalize ? 'capitalize' : ''
        }`}
      >
        {value}
      </div>
    </div>
  )
}

/* ── Row pagination (P13: ≤250 rows per response) ── */
function RowsPager({
  meta,
  onPage,
}: {
  meta?: { page: number; limit: number; total: number; pages: number }
  onPage: (page: number) => void
}) {
  if (!meta || meta.total <= meta.limit) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
      <span>
        Rows {meta.total} · page {meta.page} of {Math.max(meta.pages, 1)} ({meta.limit} per page)
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="tap-h"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="tap-h"
          disabled={meta.page >= meta.pages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

// Mirrors CLAIMABLE_STATES in courier-settlement-finalize.service.ts — the UI
// must never offer an action the backend refuses (P11 gate).
const FINALIZABLE = ['READY_FOR_REVIEW', 'REVIEW_REQUIRED'] as const
const PRE_FINALIZE = [
  'UPLOADED',
  'ANALYZED',
  'MAPPING_REQUIRED',
  'IMPORTING',
  'READY_FOR_REVIEW',
  'REVIEW_REQUIRED',
  'ISSUE_FOUND',
] as const

export function InvoiceDetailPage({ id }: { id: string }) {
  const [rowsPage, setRowsPage] = useState(1)
  const [tab, setTab] = useState('overview')
  const [highlight, setHighlight] = useState<number[]>([])
  const { data, isLoading, isError } = useInvoice(id, { rowsPage, rowsLimit: 250 })
  const navigate = useNavigate()
  // Hook order must be unconditional — these live before any early return.
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardReason, setDiscardReason] = useState('')
  const { finalize, repairAccounting, reclaimStale, postAccounting, discard } =
    useCourierSettlementMutations()

  if (isLoading)
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-9 w-[28rem] max-w-full rounded-md" />
        <Skeleton className="h-72 rounded-md" />
      </div>
    )
  if (isError || !data)
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
        Invoice not found or you lack permission.
      </div>
    )

  const { invoice, historical, effective, divergence } = data
  const rowsMeta = data.rowsMeta
  const exceptionsMeta = data.exceptionsMeta
  const rows = invoice.rows ?? []
  const exceptions = invoice.exceptions ?? []
  const openRed = exceptions.filter((e) => e.severity === 'red' && e.status === 'open').length
  const openYellow = exceptions.filter((e) => e.severity === 'yellow' && e.status === 'open').length
  const state = invoice.state as string
  const canFinalize = FINALIZABLE.includes(state as any)
  const canRepair = state === 'ACCOUNTING_FAILED'
  const canReclaim = state === 'FINALIZING'
  const canPost = state === 'FINALIZED_PENDING_ACCOUNTING'
  const canDiscard = PRE_FINALIZE.includes(state as any)

  const finalizeIt = () =>
    finalize.mutate(
      { id },
      {
        onSuccess: () => navigate({ to: '/op/courier-settlement' }),
      },
    )

  const divergent = divergence as {
    version?: number
    takenAt?: string
    fields?: Record<string, { from: number; to: number }>
  } | null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            to="/op/courier-settlement"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> All invoices
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
              <BadgeDollarSign className="size-5" aria-hidden />
            </span>
            {invoice.displayId}
            <InvoiceStateBadge state={state} />
            {invoice.isRevision ? <Badge variant="outline">revision</Badge> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {invoice.courier}
            {invoice.invoiceNo ? ` · ${invoice.invoiceNo}` : ''} ·{' '}
            {new Date(invoice.invoiceDate).toLocaleDateString()} · {invoice.rowCount} rows
            {invoice.accountingStatus ? ` · accounting: ${invoice.accountingStatus}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="tap-h"
            onClick={() => setDiscardOpen(true)}
            disabled={!canDiscard}
          >
            Discard
          </Button>
          <Button
            variant="outline"
            className="tap-h"
            onClick={() => reclaimStale.mutate(id)}
            disabled={!canReclaim || reclaimStale.isPending}
          >
            Reclaim stuck
          </Button>
          <Button
            variant="outline"
            className="tap-h"
            onClick={() => repairAccounting.mutate(id)}
            disabled={!canRepair || repairAccounting.isPending}
          >
            Repair accounting
          </Button>
          <Button
            variant="outline"
            className="tap-h"
            onClick={() => postAccounting.mutate(id)}
            disabled={!canPost || postAccounting.isPending}
          >
            Post accounting
          </Button>
          <Button
            className="tap-h"
            onClick={finalizeIt}
            disabled={!canFinalize || finalize.isPending}
            title={openRed ? `${openRed} blocking finding(s)` : undefined}
          >
            {finalize.isPending ? 'Finalizing…' : 'Finalize'}
          </Button>
        </div>
      </div>

      {state === 'IMPORTING' ? (
        <div className="rounded-xl border border-info/30 bg-info-soft p-3 text-sm text-info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              Importing in background
              {invoice.importStage ? (
                <span className="font-mono text-xs"> · {invoice.importStage}</span>
              ) : null}
            </span>
            <span className="tabular-nums">{invoice.importProgress ?? 0}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-info-soft">
            <div
              className="h-full rounded-full bg-info transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(100, invoice.importProgress ?? 0))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs opacity-80">
            Rows land in review — nothing is booked. This page refreshes automatically.
          </p>
        </div>
      ) : null}

      {openRed > 0 ? (
        <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {openRed} RED finding(s) must be resolved — finalization is refused until they are.
        </p>
      ) : openYellow > 0 ? (
        <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          {openYellow} warning(s) — acknowledgement required before finalization.
        </p>
      ) : null}

      <Card className="chart-card rounded-2xl">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2.5">
            <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
              <BadgeDollarSign className="h-4 w-4" />
            </span>
            <CardTitle className="text-sm">Current effective totals</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <TotalsGrid totals={effective.effectiveTotals as unknown as Record<string, number>} />
          {divergent ? (
            <div className="rounded-xl border border-accent-violet/30 bg-accent-violet-soft p-3 text-sm text-accent-violet">
              <p className="font-medium">
                Revised — historical at finalization differs from current effective
                {divergent.version ? ` (snapshot v${divergent.version})` : ''}.
              </p>
              <table className="mt-2 text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="pr-4">Field</th>
                    <th className="pr-4">Historical at finalization</th>
                    <th>Current effective</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(divergent.fields ?? {}).map(([k, v]) => (
                    <tr key={k}>
                      <td className="pr-4">{TOTAL_LABEL[k] ?? k}</td>
                      <td className="pr-4 tabular-nums">{bdt(v.from)}</td>
                      <td className="tabular-nums">{bdt(v.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : historical ? (
            <p className="text-xs text-muted-foreground">
              Snapshot v{historical.version} taken{' '}
              {new Date(historical.takenAt).toLocaleString()} still equals the current effective
              state.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={discardOpen}
        onOpenChange={(v) => {
          if (!v) {
            setDiscardOpen(false)
            setDiscardReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard {invoice.displayId}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The invoice is withdrawn before finalization. Nothing is deleted — it stays for
              audit and stops blocking the duplicate-file check, but it can no longer be
              finalized.
            </p>
            <Input
              value={discardReason}
              onChange={(e) => setDiscardReason(e.target.value)}
              placeholder="Reason (recorded in activity)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="tap-h" onClick={() => setDiscardOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="tap-h"
              disabled={discard.isPending}
              onClick={() =>
                discard.mutate(
                  { id, reason: discardReason || undefined },
                  {
                    onSuccess: () => {
                      setDiscardOpen(false)
                      setDiscardReason('')
                    },
                  },
                )
              }
            >
              {discard.isPending ? 'Discarding…' : 'Discard invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="tap-h h-auto max-w-full flex-wrap overflow-x-auto no-scrollbar">
          <TabsTrigger value="overview" className="tap-h">Overview</TabsTrigger>
          <TabsTrigger value="sheet" className="tap-h">Invoice sheet (raw)</TabsTrigger>
          <TabsTrigger value="recon" className="tap-h">Reconciliation</TabsTrigger>
          <TabsTrigger value="exceptions" className="tap-h">
            Exceptions
            {exceptions.length
              ? ` (${exceptions.length}${exceptionsMeta && exceptionsMeta.total > exceptionsMeta.limit ? `+` : ''})`
              : ''}
          </TabsTrigger>
          <TabsTrigger value="adjustments" className="tap-h">Adjustments</TabsTrigger>
          <TabsTrigger value="activity" className="tap-h">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab invoice={invoice} historical={historical} effective={effective} />
        </TabsContent>
        <TabsContent value="sheet" className="mt-4 space-y-2">
          <SheetTab
            rows={rows}
            exceptions={exceptions}
            invoiceId={id}
            courier={invoice.courier}
            sourceHeaders={invoice.sourceHeaders}
            highlight={highlight}
            onClearHighlight={() => setHighlight([])}
          />
          <RowsPager meta={rowsMeta} onPage={setRowsPage} />
        </TabsContent>
        <TabsContent value="recon" className="mt-4 space-y-2">
          <ReconciliationTab rows={rows} />
          <RowsPager meta={rowsMeta} onPage={setRowsPage} />
        </TabsContent>
        <TabsContent value="exceptions" className="mt-4">
          <ExceptionsTab
            invoiceId={id}
            exceptions={exceptions}
            rows={rows}
            onViewRow={(rowNumber) => {
              setHighlight([rowNumber])
              setTab('sheet')
            }}
          />
        </TabsContent>
        <TabsContent value="adjustments" className="mt-4">
          <AdjustmentsTab invoiceId={id} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab invoiceId={id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
