import { Fragment, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageInfo } from '@/components/page-info'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Play,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Inventory → Reconciliation (2026-10-30 directive §2.8).
 *
 * Read-only finder report (R1–R5 + Q1–Q8) with a guarded Apply. The page
 * is visible only with the `run_stock_reconciliation` permission (sidebar
 * hides it; this component ALSO refuses to render the tool without the
 * key — the backend guard is the real access control). Apply stays
 * disabled until a preview is loaded, a backup id is entered and the
 * operator confirms; the backend re-runs the finder and applies ONLY
 * rows that are still R1/R2/R6/R8. R7 and ambiguous legacy returns
 * (R8-H) are report-only and are refused by the backend even if sent.
 *
 * Layout (2026-11-12 redesign): compact stat tiles, findings table,
 * checks as an expand-on-click table (no wall of text by default), a
 * compact Apply card, and a superadmin-only card that settles orphaned
 * Q8 units via POST /inventory/reconciliation/q8-settle.
 */

export interface ReconRow {
  id: string
  category: 'R1' | 'R2' | 'R3' | 'R4' | 'R6' | 'R7' | 'R8'
  /** R8 only: terminal/pending rows are applicable; human = report-only. */
  r8Kind?: 'terminal' | 'pending' | 'human'
  orderDisplayId: string
  returnDisplayId: string | null
  productName: string
  variantId: string | null
  layer: 'managed' | 'physical' | 'both'
  orderedQty: number
  receivedGoodQty: number
  damagedQty: number
  alreadyRestoredManaged: number
  alreadyRestoredPhysical: number
  missingManagedQty: number
  missingPhysicalQty: number
  evidence: string
}

export interface ReconCheck {
  key: string
  label: string
  value: number
  pass: boolean | null
  detail: string
}

export interface ReconReport {
  generatedAt: string
  imEnabled: boolean
  rows: ReconRow[]
  counts: {
    R1: number
    R2: number
    R3: number
    R4: number
    R5: Record<string, number>
    R6: number
    R7: number
    R8: number
    R8H: number
  }
  checks: ReconCheck[]
}

export interface ReconApplyResult {
  runId: string
  applied: string[]
  skipped: { id: string; reason: string }[]
  checks: ReconCheck[]
  idempotency: { ok: boolean; remainingR1R2: number; remainingR6: number; remainingR8: number }
}

export interface Q8SettleResult {
  dryRun: boolean
  settled: { releasedUnits: number; flagsCleared: number; ledgerEntries: string[] }
  remainingFails: number
  detail: string
}

/** Rows the backend will apply: R1/R2/R6 plus evidence-backed R8. */
export const isApplicableReconRow = (r: ReconRow): boolean =>
  r.category === 'R1' ||
  r.category === 'R2' ||
  r.category === 'R6' ||
  (r.category === 'R8' && r.r8Kind !== 'human')

/**
 * Human labels for the R5 out-of-scope counts — the backend sends raw keys
 * (returnPending, alwaysMode, …) which read as jargon on the chips.
 * alwaysMode = products on ALWAYS_IN_STOCK / ALWAYS_OUT_OF_STOCK.
 * Unknown keys fall back to the raw key rather than disappearing.
 */
const R5_LABELS: Record<string, string> = {
  returnPending: 'return pending',
  damaged: 'damaged',
  partialWithoutRecord: 'partial without record',
  alwaysMode: 'always in/out of stock',
  imOffInventoryControlled: 'inventory-controlled (IM off)',
}

/** Long check details (e.g. Q4's 300+ divergence entries) render as one
    unreadable wall — collapse past 400 chars behind a toggle. Short
    details render exactly as before. */
function CheckDetail({ detail }: { detail: string }) {
  const [expanded, setExpanded] = useState(false)
  const LIMIT = 400
  if (detail.length <= LIMIT) {
    return <span className='block text-xs text-muted-foreground'>{detail}</span>
  }
  return (
    <span className='block text-xs text-muted-foreground'>
      {expanded ? detail : `${detail.slice(0, LIMIT)}…`}
      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        className='ml-1 font-medium text-foreground underline'
      >
        {expanded ? 'Show less' : 'Show full detail'}
      </button>
    </span>
  )
}

function CheckStatusIcon({ pass }: { pass: boolean | null }) {
  if (pass === null) return <Info className='h-4 w-4 shrink-0 text-muted-foreground' />
  if (pass) return <CheckCircle2 className='h-4 w-4 shrink-0 text-green-600' />
  return <XCircle className='h-4 w-4 shrink-0 text-destructive' />
}

const EMPTY_PERMISSIONS: string[] = []

export function Reconciliation() {
  const permissions = useAuthStore((s) => s.auth.user?.permissions) ?? EMPTY_PERMISSIONS
  const canRun =
    permissions.includes('*') || permissions.includes('run_stock_reconciliation')
  const isSuperAdmin = useAuthStore((s) => s.auth.user?.role) === 'superadmin'

  const [report, setReport] = useState<ReconReport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [backupId, setBackupId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<ReconApplyResult | null>(null)
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)
  const [settleConfirmed, setSettleConfirmed] = useState(false)
  const [settleResult, setSettleResult] = useState<Q8SettleResult | null>(null)

  const reportMut = useMutation({
    mutationFn: () =>
      apiClient.post('/inventory/reconcile', {}, { timeout: 120_000 }).then((r) => r.data as ReconReport),
    onSuccess: (data) => {
      setReport(data)
      setResult(null)
      setSelected(
        new Set(
          data.rows.filter(isApplicableReconRow).map((r) => r.id),
        ),
      )
      toast.success('Reconciliation report loaded — nothing was written.')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Failed to load the reconciliation report.'),
  })

  const applyMut = useMutation({
    mutationFn: () =>
      apiClient
        .post(
          '/inventory/reconcile/apply',
          { backupId: backupId.trim(), rowIds: [...selected], confirmed: true },
          { timeout: 120_000 },
        )
        .then((r) => r.data as ReconApplyResult),
    onSuccess: (data) => {
      setResult(data)
      if (data.idempotency.ok) {
        toast.success(
          `Applied ${data.applied.length} row(s), skipped ${data.skipped.length}. Idempotency check passed.`,
        )
      } else {
        toast.warning(
          'Apply finished but the idempotency check FAILED — do not re-apply; check the result below.',
        )
      }
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Reconciliation apply failed.'),
  })

  const settleMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiClient
        .post(
          '/inventory/reconciliation/q8-settle',
          { dryRun },
          { timeout: 120_000 },
        )
        .then((r) => r.data as Q8SettleResult),
    onSuccess: (data) => {
      setSettleResult(data)
      if (data.dryRun) {
        toast.success('Q8 settle preview ready — nothing was written.')
      } else {
        toast.success(
          `Settled ${data.settled.releasedUnits} orphaned unit(s), cleared ${data.settled.flagsCleared} flag(s).`,
        )
      }
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Q8 settle failed.'),
  })

  const applicableCount = useMemo(
    () => report?.rows.filter(isApplicableReconRow).length ?? 0,
    [report],
  )
  const applyDisabled =
    !report ||
    backupId.trim().length === 0 ||
    !confirmed ||
    selected.size === 0 ||
    applyMut.isPending ||
    reportMut.isPending

  const toggleRow = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <>
      <Header>
        <div className='flex items-center gap-2'>
          <h1 className='text-lg font-semibold'>Stock Reconciliation</h1>
          <PageInfo text='Apply writes real stock. Run the report first and review every row, then enter a restore-tested backup id. Only R1/R2/R6/R8 rows are ever applied; R3/R5/R7 and ambiguous legacy returns (R8-H) are report-only and need a human decision.' />
        </div>
        <div className='ml-auto flex items-center gap-2'>
          <GlobalSearchBar />
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        {!canRun ? (
          <div className='mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center'>
            <ShieldAlert className='h-10 w-10 text-muted-foreground' />
            <p className='font-medium'>You do not have access to stock reconciliation.</p>
            <p className='text-sm text-muted-foreground'>
              This tool requires the “Run Stock Reconciliation” permission. Ask a
              superadmin to grant it via an access preset.
            </p>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <Button onClick={() => reportMut.mutate()} disabled={reportMut.isPending}>
                {reportMut.isPending ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <Play className='mr-2 h-4 w-4' />
                )}
                Run report (dry-run)
              </Button>
              {report && (
                <span className='text-sm text-muted-foreground'>
                  Generated {new Date(report.generatedAt).toLocaleString()} · Inventory
                  Management {report.imEnabled ? 'ON' : 'OFF'}
                </span>
              )}
              <span className='flex items-center gap-1.5 text-xs font-medium text-destructive'>
                <AlertTriangle className='h-3.5 w-3.5' />
                Danger: Apply writes real stock.
              </span>
            </div>

            {report && (
              <>
                <div className='flex flex-wrap gap-2'>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R1 missed restock: {report.counts.R1}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R2 layer-missing: {report.counts.R2}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R3 report-only: {report.counts.R3}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R4 human decision: {report.counts.R4}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R6 stranded managed: {report.counts.R6}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R8 legacy returns: {report.counts.R8}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R7 mirror-suspect (report-only): {report.counts.R7}
                  </span>
                  <span className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                    R8-H ambiguous (report-only): {report.counts.R8H}
                  </span>
                  {Object.entries(report.counts.R5).map(([k, v]) => (
                    <span key={k} className='rounded-md border px-2.5 py-1.5 text-xs font-medium'>
                      R5 {R5_LABELS[k] ?? k}: {v}
                    </span>
                  ))}
                </div>

                <Card>
                  <CardHeader className='pb-0'>
                    <CardTitle className='text-sm'>
                      Findings ({report.rows.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='px-0 pb-0'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-10'>Apply</TableHead>
                          <TableHead>Cat</TableHead>
                          <TableHead>Order</TableHead>
                          <TableHead>Return</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Layer</TableHead>
                          <TableHead className='text-right'>Ordered</TableHead>
                          <TableHead className='text-right'>Good</TableHead>
                          <TableHead className='text-right' title='Damaged quantity received'>Dmg</TableHead>
                          <TableHead className='text-right' title='Already restored: managed / physical'>Restored M/P</TableHead>
                          <TableHead className='text-right' title='Still missing: managed / physical'>Missing M/P</TableHead>
                          <TableHead>Evidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={12} className='text-center text-muted-foreground'>
                              No findings — every received return has its matching ledger adds.
                            </TableCell>
                          </TableRow>
                        )}
                        {report.rows.map((r) => {
                          const applicable = isApplicableReconRow(r)
                          return (
                            <TableRow key={r.id}>
                              <TableCell>
                                <input
                                  type='checkbox'
                                  aria-label={`Select row ${r.id}`}
                                  disabled={!applicable}
                                  checked={applicable && selected.has(r.id)}
                                  onChange={(e) => toggleRow(r.id, e.target.checked)}
                                />
                              </TableCell>
                              <TableCell>
                                <Badge variant={applicable ? 'destructive' : 'secondary'}>
                                  {r.category === 'R8' && r.r8Kind === 'human' ? 'R8-H' : r.category}
                                </Badge>
                              </TableCell>
                              <TableCell>{r.orderDisplayId}</TableCell>
                              <TableCell>{r.returnDisplayId ?? '—'}</TableCell>
                              <TableCell>{r.productName}</TableCell>
                              <TableCell>{r.layer}</TableCell>
                              <TableCell className='text-right'>{r.orderedQty}</TableCell>
                              <TableCell className='text-right'>{r.receivedGoodQty}</TableCell>
                              <TableCell className='text-right'>{r.damagedQty}</TableCell>
                              <TableCell className='text-right'>
                                {r.alreadyRestoredManaged}/{r.alreadyRestoredPhysical}
                              </TableCell>
                              <TableCell className='text-right'>
                                {r.missingManagedQty}/{r.missingPhysicalQty}
                              </TableCell>
                              <TableCell className='max-w-xs text-xs text-muted-foreground'>
                                {r.evidence}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className='pb-0'>
                    <CardTitle className='text-sm'>Verification checks (Q1–Q8)</CardTitle>
                  </CardHeader>
                  <CardContent className='px-0 pb-0'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className='w-10'>Status</TableHead>
                          <TableHead className='w-16'>Check</TableHead>
                          <TableHead>Label</TableHead>
                          <TableHead className='w-20 text-right'>Count</TableHead>
                          <TableHead className='w-10' />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.checks.map((c) => {
                          const open = expandedCheck === c.key
                          return (
                            <Fragment key={c.key}>
                              <TableRow>
                                <TableCell>
                                  <span className='flex items-center gap-1.5'>
                                    <CheckStatusIcon pass={c.pass} />
                                    <Badge
                                      variant={
                                        c.pass === null ? 'outline' : c.pass ? 'secondary' : 'destructive'
                                      }
                                    >
                                      {c.pass === null ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}
                                    </Badge>
                                  </span>
                                </TableCell>
                                <TableCell className='font-medium'>{c.key}</TableCell>
                                <TableCell>{c.label}</TableCell>
                                <TableCell className='text-right'>{c.value}</TableCell>
                                <TableCell>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    aria-label={`${c.key} details`}
                                    aria-expanded={open}
                                    onClick={() =>
                                      setExpandedCheck((v) => (v === c.key ? null : c.key))
                                    }
                                  >
                                    {open ? (
                                      <ChevronUp className='h-4 w-4' />
                                    ) : (
                                      <ChevronDown className='h-4 w-4' />
                                    )}
                                  </Button>
                                </TableCell>
                              </TableRow>
                              {open && (
                                <TableRow>
                                  <TableCell colSpan={5}>
                                    <CheckDetail detail={c.detail} />
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className='pb-0'>
                    <CardTitle className='flex items-center gap-2 text-sm'>
                      <AlertTriangle className='h-4 w-4 text-destructive' />
                      Apply repairs
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-2'>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
                      <div className='flex-1'>
                        <label htmlFor='recon-backup-id' className='mb-1 block text-sm font-medium'>
                          Backup id (restore-tested dump)
                        </label>
                        <Input
                          id='recon-backup-id'
                          value={backupId}
                          onChange={(e) => setBackupId(e.target.value)}
                          placeholder='e.g. backup-2026-10-30-avelto'
                        />
                      </div>
                      <label className='flex items-center gap-2 text-sm'>
                        <input
                          type='checkbox'
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I reviewed the preview and the backup restores correctly
                      </label>
                      <Button
                        variant='destructive'
                        disabled={applyDisabled}
                        onClick={() => applyMut.mutate()}
                      >
                        {applyMut.isPending ? (
                          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        ) : (
                          <Wrench className='mr-2 h-4 w-4' />
                        )}
                        Apply {selected.size} selected row(s)
                      </Button>
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      {applicableCount} applicable (R1/R2/R6/R8) row(s) in this report. R7 and
                      R8-H are report-only. Applying re-checks every row first — rows that no
                      longer qualify are skipped with a reason.
                    </p>
                  </CardContent>
                </Card>

                {result && (
                  <Card>
                    <CardHeader className='pb-0'>
                      <CardTitle className='text-sm'>Apply result (run {result.runId})</CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-2 text-sm'>
                      <p>
                        Applied: {result.applied.length} · Skipped: {result.skipped.length} ·
                        Idempotency:{' '}
                        {result.idempotency.ok
                          ? 'OK — no applied row is still missing stock'
                          : `FAILED — ${result.idempotency.remainingR1R2} R1/R2, ${result.idempotency.remainingR6} R6, ${result.idempotency.remainingR8} R8 row(s) remain; do NOT re-apply, restore from backup and investigate`}
                      </p>
                      {result.skipped.length > 0 && (
                        <ul className='list-disc pl-5'>
                          {result.skipped.map((s) => (
                            <li key={s.id}>
                              <span className='font-mono text-xs'>{s.id}</span> — {s.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                      <ul className='space-y-1'>
                        {result.checks.map((c) => (
                          <li key={c.key} className='flex items-start gap-2'>
                            <Badge
                              variant={
                                c.pass === null ? 'outline' : c.pass ? 'secondary' : 'destructive'
                              }
                            >
                              {c.key} {c.pass === null ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}
                            </Badge>
                            <span>
                              <span className='font-medium'>{c.label}</span> = {c.value}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {isSuperAdmin && (
              <Card>
                <CardHeader className='pb-0'>
                  <CardTitle className='flex items-center gap-2 text-sm'>
                    Settle orphaned Q8 units
                    <PageInfo text='Releases orphaned reservations flagged by check Q8 (ledger-vs-state) and writes the matching ledger entries. Preview first to see what would change — settling writes real stock.' />
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
                    <Button
                      variant='outline'
                      disabled={settleMut.isPending}
                      onClick={() => settleMut.mutate(true)}
                    >
                      {settleMut.isPending ? (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      ) : (
                        <Play className='mr-2 h-4 w-4' />
                      )}
                      Preview
                    </Button>
                    <label className='flex items-center gap-2 text-sm'>
                      <input
                        type='checkbox'
                        checked={settleConfirmed}
                        onChange={(e) => setSettleConfirmed(e.target.checked)}
                      />
                      I understand settling writes ledger entries
                    </label>
                    <Button
                      variant='destructive'
                      disabled={!settleConfirmed || settleMut.isPending}
                      onClick={() => settleMut.mutate(false)}
                    >
                      {settleMut.isPending ? (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      ) : (
                        <Wrench className='mr-2 h-4 w-4' />
                      )}
                      Settle
                    </Button>
                  </div>
                  {settleResult && (
                    <div className='space-y-1 rounded-md border p-3 text-sm'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Badge variant={settleResult.dryRun ? 'outline' : 'secondary'}>
                          {settleResult.dryRun ? 'Preview — nothing was written' : 'Settled'}
                        </Badge>
                        <span className='font-medium'>
                          Released units: {settleResult.settled.releasedUnits}
                        </span>
                        <span className='font-medium'>
                          Flags cleared: {settleResult.settled.flagsCleared}
                        </span>
                        <span className='font-medium'>
                          Remaining fails: {settleResult.remainingFails}
                        </span>
                      </div>
                      <p className='text-xs text-muted-foreground'>{settleResult.detail}</p>
                      {settleResult.settled.ledgerEntries.length > 0 && (
                        <ul className='list-disc pl-5 text-xs'>
                          {settleResult.settled.ledgerEntries.map((e) => (
                            <li key={e} className='font-mono'>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
