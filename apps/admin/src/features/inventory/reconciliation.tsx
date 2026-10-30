import { useMemo, useState } from 'react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertTriangle, Loader2, Play, ShieldAlert, Wrench } from 'lucide-react'
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
 * rows that are still R1/R2.
 */

export interface ReconRow {
  id: string
  category: 'R1' | 'R2' | 'R3' | 'R4'
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
  counts: { R1: number; R2: number; R3: number; R4: number; R5: Record<string, number> }
  checks: ReconCheck[]
}

export interface ReconApplyResult {
  runId: string
  applied: string[]
  skipped: { id: string; reason: string }[]
  checks: ReconCheck[]
  idempotency: { ok: boolean; remainingR1R2: number }
}

const EMPTY_PERMISSIONS: string[] = []

export function Reconciliation() {
  const permissions = useAuthStore((s) => s.auth.user?.permissions) ?? EMPTY_PERMISSIONS
  const canRun =
    permissions.includes('*') || permissions.includes('run_stock_reconciliation')

  const [report, setReport] = useState<ReconReport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [backupId, setBackupId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<ReconApplyResult | null>(null)

  const reportMut = useMutation({
    mutationFn: () =>
      apiClient.post('/inventory/reconcile', {}, { timeout: 120_000 }).then((r) => r.data as ReconReport),
    onSuccess: (data) => {
      setReport(data)
      setResult(null)
      setSelected(
        new Set(
          data.rows
            .filter((r) => r.category === 'R1' || r.category === 'R2')
            .map((r) => r.id),
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

  const applicableCount = useMemo(
    () => report?.rows.filter((r) => r.category === 'R1' || r.category === 'R2').length ?? 0,
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
          <div className='space-y-6'>
            <div
              role='alert'
              className='flex gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
            >
              <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
              <div className='text-sm'>
                <p className='font-semibold'>Danger: Apply writes real stock.</p>
                <p>
                  Run the report first and review every row. Before applying, take a
                  full database backup and verify it restores — then enter its backup
                  id below. Only R1/R2 rows are ever applied; R3 is report-only and
                  R4 always needs a human decision.
                </p>
              </div>
            </div>

            <div className='flex items-center gap-3'>
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
            </div>

            {report && (
              <>
                <div className='flex flex-wrap gap-2'>
                  <Badge variant='destructive'>R1 missed restock: {report.counts.R1}</Badge>
                  <Badge variant='destructive'>R2 layer-missing: {report.counts.R2}</Badge>
                  <Badge variant='secondary'>R3 report-only: {report.counts.R3}</Badge>
                  <Badge variant='secondary'>R4 human decision: {report.counts.R4}</Badge>
                  {Object.entries(report.counts.R5).map(([k, v]) => (
                    <Badge key={k} variant='outline'>
                      R5 {k}: {v}
                    </Badge>
                  ))}
                </div>

                <div className='rounded-md border'>
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
                        <TableHead className='text-right'>Dmg</TableHead>
                        <TableHead className='text-right'>Restored M/P</TableHead>
                        <TableHead className='text-right'>Missing M/P</TableHead>
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
                        const applicable = r.category === 'R1' || r.category === 'R2'
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
                                {r.category}
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
                </div>

                <div className='rounded-md border p-4'>
                  <h2 className='mb-3 font-semibold'>Verification checks (Q1–Q8)</h2>
                  <ul className='space-y-2 text-sm'>
                    {report.checks.map((c) => (
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
                          <span className='block text-xs text-muted-foreground'>{c.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className='rounded-md border p-4'>
                  <h2 className='mb-3 font-semibold'>Apply repairs</h2>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
                    <div className='flex-1'>
                      <label htmlFor='recon-backup-id' className='mb-1 block text-sm font-medium'>
                        Backup id (restore-tested dump taken just now)
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
                  <p className='mt-2 text-xs text-muted-foreground'>
                    {applicableCount} applicable (R1/R2) row(s) in this report. Apply is
                    disabled until a preview is loaded, a backup id is entered and the
                    confirmation is ticked. Applying re-checks every row first — rows
                    that no longer qualify are skipped with a reason.
                  </p>
                </div>

                {result && (
                  <div className='rounded-md border p-4'>
                    <h2 className='mb-3 font-semibold'>Apply result (run {result.runId})</h2>
                    <p className='text-sm'>
                      Applied: {result.applied.length} · Skipped: {result.skipped.length} ·
                      Idempotency:{' '}
                      {result.idempotency.ok
                        ? 'OK — no applied row is still missing stock'
                        : `FAILED — ${result.idempotency.remainingR1R2} R1/R2 row(s) remain; do NOT re-apply, restore from backup and investigate`}
                    </p>
                    {result.skipped.length > 0 && (
                      <ul className='mt-2 list-disc pl-5 text-sm'>
                        {result.skipped.map((s) => (
                          <li key={s.id}>
                            <span className='font-mono text-xs'>{s.id}</span> — {s.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    <ul className='mt-3 space-y-2 text-sm'>
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
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
