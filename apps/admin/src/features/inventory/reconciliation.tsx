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
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { ReconVerdictBanner } from './components/recon-verdict-banner'
import { ReconDetailsSheet } from './components/recon-details-sheet'
import {
  ReconFixAllResultCard,
  ReconPreviewCard,
} from './components/recon-one-click-flow'
import { buildReconPreview } from './components/recon-helpers'

export { isApplicableReconRow } from './components/recon-helpers'

/**
 * Inventory → Reconciliation (2026-10-30 directive §2.8).
 *
 * Finder report (R1–R5 + Q1–Q8) with a one-click guarded fix. The page
 * is visible only with the `run_stock_reconciliation` permission (sidebar
 * hides it; this component ALSO refuses to render the tool without the
 * key — the backend guard is the real access control). The fix runs a
 * dry-run first, shows a plain-language preview, and only then — on
 * exactly ONE explicit confirm — executes the fix-all; the backend
 * creates the backup itself, re-runs the finder and applies ONLY rows
 * that are still applicable. Report-only rows are refused by the
 * backend even if sent.
 *
 * Layout (2026-11-12 redesign): a verdict banner + one "Check & fix stock"
 * button + a plain-language preview, then exactly ONE confirm executes
 * the fix. The details view (default closed) is a clean sheet: one row
 * per finding — Problem | Order/Item | Qty | Result (Auto-fix / Needs
 * you) — plain English, no R-codes, no UUIDs; the verification checks
 * sit below it as an expand-on-click table (no wall of text by default).
 * The old Apply (manual backup id + row checkboxes) and the standalone
 * Q8 settle card are gone — the one-click fix (auto-backup, Q8 settle
 * for superadmins) is the only write path.
 *
 * One-click flow (2026-11-12): the default view is plain English — a
 * verdict banner + one "Check & fix stock" button. Clicking it runs
 * the dry-run, then a preview screen (what WILL be fixed, what will NOT),
 * then exactly ONE explicit confirm executes POST
 * /inventory/reconcile/fix-all { confirmed: true } — the backend creates
 * the backup itself, derives the applicable rows from a fresh report
 * (the default flow never sends rowIds), and settles Q8 for superadmins.
 * The details view is the sheet (see above), not the old UI.
 */

export interface ReconRow {
  id: string
  category: 'R1' | 'R2' | 'R3' | 'R4' | 'R6' | 'R7' | 'R8'
  /** R8 only: terminal/pending rows are applicable; human = report-only. */
  r8Kind?: 'terminal' | 'pending' | 'human'
  orderDisplayId: string
  returnDisplayId: string | null
  /** Raw product id — only used to spot a UUID-shaped productName fallback. */
  productId?: string
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
  /** R6 only: the signed managed quantity stranded on the unit. */
  strandedManagedQty?: number
  /** R7 only: the physical quantity on the suspected mirror row. */
  physicalQty?: number
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

export interface Q8SettleResult {
  dryRun: boolean
  settled: { releasedUnits: number; flagsCleared: number; ledgerEntries: string[] }
  remainingFails: number
  detail: string
}

/**
 * One-click fix-all result (POST /inventory/reconcile/fix-all).
 * The backend creates the backup itself, derives applicable rows from a
 * fresh report, and settles Q8 for superadmins in the same call.
 */
export interface ReconFixAllResult {
  backupId: string
  apply: {
    runId: string
    applied: string[]
    skipped: { id: string; reason: string }[]
    idempotency: {
      ok: boolean
      remainingR1R2: number
      remainingR6: number
      remainingR8: number
    }
  }
  settle:
    | {
        ran: true
        releasedUnits: number
        flagsCleared: number
        ledgerEntries: string[]
        remainingFails: number
        detail: string
      }
    | { ran: false; reason: string }
  postReport: { counts: ReconReport['counts']; checks: ReconCheck[] }
  generatedAt: string
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
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)

  // One-click flow state (2026-11-12): idle → checking (dry-run, + Q8
  // preview for superadmins) → preview → executing → done (result or
  // fail-closed error). Details stay open/closed independently.
  type FlowStep = 'idle' | 'checking' | 'preview' | 'executing' | 'done'
  const [flowStep, setFlowStep] = useState<FlowStep>('idle')
  const [showDetails, setShowDetails] = useState(false)
  const [fixConfirmed, setFixConfirmed] = useState(false)
  const [q8Preview, setQ8Preview] = useState<Q8SettleResult | null>(null)
  const [fixAllResult, setFixAllResult] = useState<ReconFixAllResult | null>(null)
  const [fixAllError, setFixAllError] = useState<string | null>(null)

  const resetFlow = () => {
    setFlowStep('idle')
    setFixConfirmed(false)
    setQ8Preview(null)
    setFixAllResult(null)
    setFixAllError(null)
  }

  const reportMut = useMutation({
    mutationFn: () =>
      apiClient.post('/inventory/reconcile', {}, { timeout: 120_000 }).then((r) => r.data as ReconReport),
    onSuccess: (data) => {
      setReport(data)
      toast.success('Reconciliation report loaded — nothing was written.')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Failed to load the reconciliation report.'),
  })

  /** Q8 dry-run preview for the one-click flow. Superadmin only; never
      called for other roles. */
  const q8PreviewMut = useMutation({
    mutationFn: () =>
      apiClient
        .post('/inventory/reconciliation/q8-settle', { dryRun: true }, { timeout: 120_000 })
        .then((r) => r.data as Q8SettleResult),
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Q8 preview failed.'),
  })

  /** One-click fix-all: the backend creates the backup, derives the
      applicable rows from a fresh report (no rowIds are ever sent), and
      settles Q8 for superadmins. On success the dry-run is re-run
      automatically so the verdict banner reflects the fresh state. */
  const fixAllMut = useMutation({
    mutationFn: () =>
      apiClient
        .post(
          '/inventory/reconcile/fix-all',
          { confirmed: true },
          { timeout: 300_000 },
        )
        .then((r) => r.data as ReconFixAllResult),
    onSuccess: (data) => {
      setFixAllResult(data)
      setFixAllError(null)
      setFlowStep('done')
      toast.success('Fixed — running a new check.')
      // Fresh verdict: clear the stale report, then re-run the dry-run.
      setReport(null)
      reportMut.mutate()
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message || 'Reconciliation fix-all failed.'
      setFixAllError(message)
      setFixAllResult(null)
      setFlowStep('done')
      toast.error(message)
    },
  })

  /** One-click button: dry-run first (writes nothing), then — for
      superadmins only — the Q8 settle preview, then the preview screen.
      Any failure stops the flow before the preview; nothing is written. */
  const handleOneClickCheck = async () => {
    resetFlow()
    setFlowStep('checking')
    try {
      await reportMut.mutateAsync()
    } catch {
      setFlowStep('idle')
      return
    }
    if (isSuperAdmin) {
      try {
        setQ8Preview(await q8PreviewMut.mutateAsync())
      } catch {
        setFlowStep('idle')
        return
      }
    }
    setFlowStep('preview')
  }

  const preview = useMemo(
    () => (report ? buildReconPreview(report, q8Preview, isSuperAdmin) : null),
    [report, q8Preview, isSuperAdmin],
  )

  const oneClickBusy =
    flowStep === 'checking' || flowStep === 'executing' || reportMut.isPending

  return (
    <>
      <Header>
        <div className='flex items-center gap-2'>
          <h1 className='text-lg font-semibold'>Stock Reconciliation</h1>
          <PageInfo text='Fixing writes real stock. Check & fix stock runs a dry-run first — nothing is written until you confirm the fix. The fix applies the rows marked Auto-fix and creates a backup automatically; rows marked Needs you need a human decision.' />
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
            <ReconVerdictBanner report={report} />

            <div className='flex flex-wrap items-center gap-3'>
              <Button
                onClick={handleOneClickCheck}
                disabled={oneClickBusy || flowStep === 'preview'}
              >
                {flowStep === 'checking' ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <Wrench className='mr-2 h-4 w-4' />
                )}
                {flowStep === 'checking' ? 'Checking…' : 'Check & fix stock'}
              </Button>
            </div>

            {(flowStep === 'preview' || flowStep === 'executing') && preview && (
              <ReconPreviewCard
                preview={preview}
                confirmed={fixConfirmed}
                onConfirmedChange={setFixConfirmed}
                isPending={fixAllMut.isPending}
                onConfirm={() => {
                  setFlowStep('executing')
                  fixAllMut.mutate()
                }}
              />
            )}

            {flowStep === 'done' && (
              <ReconFixAllResultCard
                result={fixAllResult}
                error={fixAllError}
                isRefreshingReport={reportMut.isPending}
                onRestart={() => {
                  resetFlow()
                  reportMut.mutate()
                }}
              />
            )}

            <div className='flex flex-wrap items-center gap-3'>
              <Button
                variant='outline'
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
              >
                {showDetails ? (
                  <ChevronUp className='mr-2 h-4 w-4' />
                ) : (
                  <ChevronDown className='mr-2 h-4 w-4' />
                )}
                {showDetails ? 'Hide details' : 'Show details'}
              </Button>
              <span className='text-sm text-muted-foreground'>
                Every finding, one row each — expand a row for the full evidence.
              </span>
            </div>

            {showDetails && (
              <>
                {report ? (
                  <>
                    <p className='text-sm text-muted-foreground'>
                      Generated {new Date(report.generatedAt).toLocaleString()} · Inventory
                      Management {report.imEnabled ? 'ON' : 'OFF'}
                    </p>

                    <ReconDetailsSheet report={report} />

                    <Card>
                      <CardHeader className='pb-0'>
                        <CardTitle className='text-sm'>Verification checks</CardTitle>
                      </CardHeader>
                      <CardContent className='px-0 pb-0'>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className='w-10'>Status</TableHead>
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
                                            c.pass === null
                                              ? 'outline'
                                              : c.pass
                                                ? 'secondary'
                                                : 'destructive'
                                          }
                                        >
                                          {c.pass === null ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}
                                        </Badge>
                                      </span>
                                    </TableCell>
                                    <TableCell>{c.label}</TableCell>
                                    <TableCell className='text-right'>{c.value}</TableCell>
                                    <TableCell>
                                      <Button
                                        variant='ghost'
                                        size='sm'
                                        aria-label={`Details for ${c.label}`}
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
                                      <TableCell colSpan={4}>
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
                  </>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    No report yet — use 'Check &amp; fix stock' above to run a check.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
