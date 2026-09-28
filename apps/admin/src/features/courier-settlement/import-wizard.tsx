import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useColumnMappings, useCourierSettlementMutations, usePreview } from './hooks'
import { InvoiceStateBadge } from './state-badge'
import { MappingDialog } from './mapping-dialog'
import { SourceSheet } from './source-sheet'
import type { InvoicePreview, UploadResult } from './api'

/**
 * The four couriers with a real integration AND an approved financial rule in
 * this build. Anything else would be a misleading option (no parser, no rule),
 * so it is not offered — the architecture stays extensible by adding a
 * descriptor + rule, not by widening this list.
 */
export const SUPPORTED_COURIERS = ['pathao', 'steadfast', 'redx', 'carrybee'] as const

const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Import wizard: Upload → Analyze → Preview → Decision.
 *
 * The primary action never commits a financial document. Step 1 stores the
 * bytes and renders the preview (state → figures → Source sheet → Findings →
 * Previous settlements); the document only enters the database as rows +
 * exceptions when the operator picks **Import for review** (→ **Edit mapping**
 * fixes columns, **Discard** throws the draft away). The analyzed draft is
 * resumable from the Invoices tab — there is no separate save button.
 *
 * Import ≠ finalize: nothing is booked until the imported invoice is finalized
 * from its own page.
 */

/** At this many source rows the workspace takes over the whole viewport (§13). */
const FULLSCREEN_MIN_ROWS = 2000
export function ImportWizard({
  open,
  onOpenChange,
  initialDraftId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialDraftId?: string | null
}) {
  const [step, setStep] = useState<0 | 1>(0)
  const [tab, setTab] = useState('review')
  const [file, setFile] = useState<File | null>(null)
  const [courier, setCourier] = useState<string>('')
  const [result, setResult] = useState<UploadResult | null>(null)
  const [preview, setPreview] = useState<InvoicePreview | null>(null)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [highlight, setHighlight] = useState<number[]>([])
  const navigate = useNavigate()
  const { upload, importDraft, discard } = useCourierSettlementMutations()
  const draftPreview = usePreview(step === 1 && initialDraftId ? initialDraftId : null)
  const mappings = useColumnMappings(preview?.identity.courier ?? null)

  // Opening with a draft resumes straight into the preview step; opening from
  // the Import button always starts at Upload.
  useEffect(() => {
    if (!open) return
    setStep(initialDraftId ? 1 : 0)
    if (!initialDraftId) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDraftId])

  // Resume a stored draft: its preview is recomputed from the stored bytes.
  useEffect(() => {
    if (step === 1 && !preview && draftPreview.data) {
      setPreview(draftPreview.data)
      setResult({
        invoiceId: draftPreview.data.invoiceId,
        displayId: draftPreview.data.displayId,
        provider: draftPreview.data.identity.provider,
        state: draftPreview.data.state,
        rowCount: draftPreview.data.classification.total,
        matchedCount: draftPreview.data.matching.matched,
        severity: draftPreview.data.findings.some((f) => f.severity === 'red')
          ? 'red'
          : draftPreview.data.findings.some((f) => f.severity === 'yellow')
            ? 'yellow'
            : 'green',
        blocking: draftPreview.data.findings.some((f) => f.blocking),
        duplicateFile: draftPreview.data.duplicateFile,
        resumed: true,
      })
    }
  }, [step, preview, draftPreview.data])

  const reset = () => {
    setStep(0)
    setTab('review')
    setFile(null)
    setCourier('')
    setResult(null)
    setPreview(null)
    setHighlight([])
  }

  const close = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const start = () => {
    if (!file) return
    upload.mutate(
      { file, courier: courier && courier !== 'auto' ? courier : undefined },
      {
        onSuccess: (res) => {
          setResult(res)
          setPreview(res.preview ?? null)
          setTab('review')
          setStep(1)
        },
      },
    )
  }

  const confirmImport = () => {
    const id = preview?.invoiceId ?? result?.invoiceId
    if (!id) return
    importDraft.mutate(id, {
      onSuccess: (res) => {
        const importedId = res.invoiceId
        close(false)
        navigate({ to: '/op/courier-settlement/$id', params: { id: importedId } })
      },
    })
  }

  const discardDraft = () => {
    const id = preview?.invoiceId ?? result?.invoiceId
    if (!id) return
    discard.mutate(
      { id, reason: 'Discarded from the import preview' },
      { onSuccess: () => close(false) },
    )
  }

  const goToRows = (rowNumbers: number[]) => {
    if (rowNumbers.length === 0) return
    setHighlight(rowNumbers)
    setTab('sheet')
  }

  const headers = preview?.classification.headers ?? []
  const findings = preview?.findings ?? []
  const blocking = findings.filter((f) => f.blocking)
  const warnings = findings.filter((f) => !f.blocking && f.severity === 'yellow')
  const unmatched = preview?.matching.unmatched ?? 0
  const previous = preview?.previousSettlements ?? []
  const mappingList = (mappings.data?.data ?? [])
    .filter((m) => m.active !== false)
    .map((m) => ({
      sourceHeader: m.sourceHeader,
      targetField: m.fieldLabel ?? m.field,
    }))

  const tooBig =
    (preview?.classification.data ?? 0) >= FULLSCREEN_MIN_ROWS ||
    (result?.rowCount ?? 0) >= FULLSCREEN_MIN_ROWS

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className={`flex flex-col gap-0 overflow-hidden p-0 ${
          tooBig
            ? 'h-[100vh] max-h-[100vh] w-[100vw] max-w-[100vw] rounded-none border-0'
            : 'max-h-[92vh] w-full max-w-6xl rounded-md'
        }`}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="text-base">
            {step === 0 ? (
              'Import courier invoice'
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                {preview?.displayId ?? ''}
                <span className="font-normal text-muted-foreground">
                  · {preview?.identity.filename ?? ''}
                </span>
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === 0
              ? 'Choose the courier and the settlement file. The file is analyzed first — nothing is added to your books until you confirm the preview.'
              : 'Review what the courier actually sent, then decide. Nothing is imported yet.'}
          </DialogDescription>
          {step === 1 && preview ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <InvoiceStateBadge state={preview.state} />
              <span className="text-muted-foreground">
                {preview.identity.courier} · {preview.classification.total} rows ·{' '}
                {headers.length} source columns
              </span>
              {blocking.length > 0 ? (
                <Badge variant="danger" className="rounded-md font-medium">
                  {blocking.length} blocking
                </Badge>
              ) : null}
              {warnings.length > 0 ? (
                <Badge variant="warning" className="rounded-md font-medium">
                  {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                </Badge>
              ) : null}
              <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                Draft · not imported
              </span>
            </div>
          ) : null}
        </DialogHeader>

        {step === 0 ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <Label>Courier</Label>
              <Select value={courier} onValueChange={setCourier}>
                <SelectTrigger className="tap-h rounded-md">
                  <SelectValue placeholder="Detect from file header (recommended)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Detect from file header (recommended)</SelectItem>
                  {SUPPORTED_COURIERS.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="capitalize">{c}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pathao, Steadfast, RedX, CarryBee. Detect from the header — it fixes the format and
                the financial rule.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cs-file">Settlement file (CSV / XLSX)</Label>
              <Input
                id="cs-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="rounded-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Stored byte-for-byte with a checksum. Re-uploading an analyzed file resumes it;
                re-uploading an imported file is flagged <span className="font-mono">DUPLICATE_FILE</span>{' '}
                instead of double-counting.
              </p>
            </div>

            {/* ── Upload step: single clear primary action ── */}
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <p className="max-w-md text-xs text-muted-foreground">
                Analyze only stores the file — nothing is imported or booked.
              </p>
              <Button
                onClick={start}
                disabled={!file || upload.isPending}
                className="tap-h rounded-md text-xs"
              >
                {upload.isPending ? 'Analyzing…' : 'Analyze file'}
              </Button>
            </div>
          </div>
        ) : preview ? (
          <>
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
              <div className="shrink-0 border-b px-5 pt-3">
                <TabsList className="tap-h h-9 max-w-full overflow-x-auto rounded-md bg-muted no-scrollbar">
                  <TabsTrigger value="review" className="tap-h">Review</TabsTrigger>
                  <TabsTrigger value="sheet" className="tap-h">Source sheet</TabsTrigger>
                  <TabsTrigger value="findings" className="tap-h">
                    Findings
                    {findings.length > 0 ? (
                      <span className="ml-1.5 rounded-sm bg-background px-1.5 text-[10px] font-medium tabular-nums text-foreground shadow-sm">
                        {findings.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="previous" className="tap-h">Previous settlements</TabsTrigger>
                </TabsList>
              </div>

              {/* ── Review: settlement expectation, then source identity ── */}
              <TabsContent
                value="review"
                className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4"
              >
                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    What this invoice says
                  </h4>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Gross COD collected" value={money(preview.money.grossCollected)} />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Courier charges" value={money(preview.money.charges)} />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Net settlement" value={money(preview.money.net)} strong />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure
                        label="Expected COD"
                        value={unmatched > 0 ? '—' : money(preview.money.expectedCod)}
                        na={unmatched > 0}
                        title={
                          unmatched > 0
                            ? `Unavailable — ${unmatched} unmatched row(s) have no order expectation`
                            : undefined
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Cash we receive" value={money(preview.money.cashReceived)} muted />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Cash we pay out" value={money(preview.money.cashDisbursed)} muted />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Unexplained residual" value={money(preview.money.residual)} muted />
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20">
                      <Figure label="Shipping margin impact" value={money(-preview.money.charges)} muted />
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    The file's own declared figures, summed over data rows. Nothing is booked yet —
                    import writes rows for review, finalization moves the money.
                  </p>
                </section>

                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Source file
                  </h4>
                  <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <Meta label="Courier" value={preview.identity.courier} capitalize />
                    <Meta label="Provider invoice no" value={preview.identity.invoiceNo ?? '—'} />
                    <Meta label="Invoice date" value={new Date(preview.identity.invoiceDate).toLocaleDateString()} />
                    <Meta label="Detected format" value={preview.identity.format} mono />
                    <Meta label="File" value={preview.identity.filename} />
                    <Meta label="Size" value={`${((preview.identity.fileSize ?? 0) / 1024).toFixed(1)} KB`} />
                    <Meta label="Source columns" value={String(headers.length)} />
                    <Meta
                      label="Checksum (sha256)"
                      value={`${(preview.identity.sha256 ?? '').slice(0, 16)}…`}
                      mono
                      full={preview.identity.sha256 ?? ''}
                    />
                  </dl>
                </section>

                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Row classification & matching
                  </h4>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                    <Stat label="Data rows" value={preview.classification.data} />
                    <Stat label="Summary" value={preview.classification.summary} />
                    <Stat label="Footer" value={preview.classification.footer} />
                    <Stat label="Unknown" value={preview.classification.unknown} />
                    <Stat label="Blank lines skipped" value={preview.classification.blankLines} />
                    <Stat label="Matched to orders" value={preview.matching.matched} />
                    <Stat label="Unmatched" value={preview.matching.unmatched} warn={preview.matching.unmatched > 0} />
                    <Stat label="Repeated consignment IDs" value={preview.matching.duplicateIdentifiersInFile} warn={preview.matching.duplicateIdentifiersInFile > 0} />
                    <Stat label="Already settled orders" value={preview.matching.previouslySettledOrders} warn={preview.matching.previouslySettledOrders > 0} />
                  </div>
                </section>

                {!preview.identity.proven ? (
                  <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                    No approved financial rule for this format — you can import and review it, but
                    finalization stays disabled until a rule is approved in Rules.
                  </p>
                ) : null}
                {preview.duplicateFile ? (
                  <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                    This exact file already exists. Confirming creates a flagged duplicate
                    (<span className="font-mono">DUPLICATE_FILE</span>) so it can never silently
                    double-count.
                  </p>
                ) : null}
              </TabsContent>

              {/* ── Source sheet: raw only, full spreadsheet viewer ── */}
              <TabsContent value="sheet" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <SourceSheet
                  rows={preview.rows}
                  headers={headers}
                  mappings={mappingList}
                  highlightRowNumbers={highlight}
                  onClearHighlight={() => setHighlight([])}
                  onViewFinding={() => setTab('findings')}
                  totalRows={preview.classification.total}
                  truncatedNote={
                    preview.rowsTruncated
                      ? `Preview shows the first 200 data rows — the full sheet (all ${preview.classification.data.toLocaleString()} rows) is available after import.`
                      : undefined
                  }
                  heightClass="max-h-[48vh]"
                  emptyMessage="No rows match the current search and filters."
                />
              </TabsContent>

              {/* ── Previous settlements ── */}
              <TabsContent
                value="previous"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
              >
                {unmatched > 0 ? (
                  <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                    Previous-settlement check unavailable — {unmatched} unmatched row(s). The check
                    can only cover rows matched to an order.
                  </p>
                ) : null}
                {previous.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    None of the orders in this file have been settled before — no duplicate-settlement
                    risk.
                  </p>
                ) : (
                  <>
                    <p className="text-sm">
                      <span className="font-medium">{previous.length}</span> order(s) in this file
                      were already settled by a finalized invoice. Confirm the remaining amount
                      before you import.
                    </p>
                    <div className="max-h-[45vh] overflow-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/95">
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="border-b px-3 py-2 font-medium">Order</th>
                            <th className="border-b px-3 py-2 font-medium">Previously settled by</th>
                            <th className="border-b px-3 py-2 text-right font-medium">Already collected</th>
                            <th className="border-b px-3 py-2 text-right font-medium">Already charged</th>
                            <th className="border-b px-3 py-2 text-right font-medium">Already settled (net)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previous.map((p) => (
                            <tr key={p.orderId} className="transition-colors hover:bg-muted/50">
                              <td className="border-b px-3 py-2 font-medium">
                                {p.orderDisplayId ?? p.orderId.slice(0, 8)}
                              </td>
                              <td className="border-b px-3 py-2">
                                {p.invoices.map((i) => (
                                  <span
                                    key={i.invoiceId}
                                    className="mr-1 inline-block rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                                  >
                                    {i.displayId}
                                  </span>
                                ))}
                              </td>
                              <td className="border-b px-3 py-2 text-right tabular-nums">{money(p.collected)}</td>
                              <td className="border-b px-3 py-2 text-right tabular-nums">{money(p.charges)}</td>
                              <td className="border-b px-3 py-2 text-right tabular-nums">{money(p.net)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ── Findings → jump to the affected source rows ── */}
              <TabsContent
                value="findings"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
              >
                {findings.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No findings — every row reconciles cleanly.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-danger">
                        <span className="size-1.5 rounded-full bg-danger" />
                        {blocking.length} blocking
                      </span>
                      <span className="flex items-center gap-1.5 font-medium text-warning">
                        <span className="size-1.5 rounded-full bg-warning" />
                        {warnings.length} review
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {findings.map((f) => (
                        <li
                          key={`${f.severity}-${f.ruleId}-${f.message}`}
                          className={`flex items-start gap-2.5 rounded-xl border px-2.5 py-2 text-sm transition-colors ${
                            f.severity === 'red'
                              ? 'border-danger/30 bg-danger-soft'
                              : 'border-warning/30 bg-warning-soft'
                          }`}
                        >
                          <span
                            className={`mt-1.5 size-2 shrink-0 rounded-full ${
                              f.severity === 'red' ? 'bg-danger' : 'bg-warning'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className={f.severity === 'red' ? 'text-danger' : 'text-warning'}>
                              {f.message}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              <span className="font-mono">{f.ruleId}</span> · {f.count} row(s)
                              {f.blocking
                                ? ' · blocks finalization until resolved'
                                : ' · acknowledge before finalizing'}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {f.ruleId === 'COURIER_FORMAT_MISMATCH' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="tap-h rounded-md text-xs"
                                onClick={() => setMappingOpen(true)}
                              >
                                Edit mapping
                              </Button>
                            ) : null}
                            {f.sampleRowNumbers.length > 0 ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="tap-h rounded-md text-xs"
                                onClick={() => goToRows(f.sampleRowNumbers)}
                              >
                                Review {f.sampleRowNumbers.length} affected row
                                {f.sampleRowNumbers.length > 1 ? 's' : ''}
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  Red findings must be fixed (match the row, correct the mapping) before this invoice
                  can be finalized. Yellow findings must be acknowledged. You can import with either
                  present — nothing is booked until finalization.
                </p>
              </TabsContent>
            </Tabs>

            {/* ── Decision point: secondary · destructive · safe · primary ── */}
            <div className="shrink-0 border-t px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-md text-xs text-muted-foreground">
                  {blocking.length > 0
                    ? `Import is allowed — rows and findings are written for review. Finalization stays refused while ${blocking.length} blocking finding(s) remain.`
                    : 'Import ≠ finalize: this writes rows and findings for review. Nothing is booked until you Finalize from the invoice.'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    className="tap-h rounded-md text-xs"
                    onClick={() => setMappingOpen(true)}
                  >
                    Edit mapping
                  </Button>
                  <Button
                    variant="ghost"
                    className="tap-h rounded-md text-xs text-danger hover:text-danger"
                    onClick={discardDraft}
                    disabled={discard.isPending}
                  >
                    {discard.isPending ? 'Discarding…' : 'Discard'}
                  </Button>
                  <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
                  <Button
                    className="tap-h rounded-md text-xs"
                    onClick={confirmImport}
                    disabled={importDraft.isPending}
                    title="Writes rows and findings for review — nothing is booked"
                  >
                    {importDraft.isPending
                      ? 'Importing…'
                      : importDraft.isError
                        ? 'Try again'
                        : 'Import for review'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : draftPreview.isLoading ? (
          <div className="min-h-0 flex-1 space-y-3 px-5 py-6">
            <div className="h-4 w-1/3 skeleton-shimmer rounded-sm bg-muted" />
            <div className="h-24 skeleton-shimmer rounded-md bg-muted" />
            <div className="h-4 w-1/2 skeleton-shimmer rounded-sm bg-muted" />
            <p className="text-center text-sm text-muted-foreground">Loading draft preview…</p>
          </div>
        ) : draftPreview.isError ? (
          <p className="px-5 py-10 text-center text-sm text-danger">
            Unable to load this draft — the original file may be missing. Re-upload it to continue.
          </p>
        ) : null}

        {preview ? (
          <MappingDialog
            open={mappingOpen}
            onOpenChange={setMappingOpen}
            courier={preview.identity.courier}
            headers={preview.classification.headers}
            invoiceId={preview.invoiceId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** One figure in the primary settlement strip. */
function Figure({
  label,
  value,
  strong,
  muted,
  na,
  title,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
  na?: boolean
  title?: string
}) {
  return (
    <div className="px-3 py-2.5" title={title}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={`${
          na
            ? 'text-base font-medium text-muted-foreground/70'
            : strong
              ? 'kpi-value'
              : muted
                ? 'text-sm font-medium text-foreground/80'
                : 'text-base font-medium'
        } tabular-nums`}
      >
        {value}
      </div>
    </div>
  )
}

function Meta({
  label,
  value,
  mono,
  capitalize,
  full,
}: {
  label: string
  value: string
  mono?: boolean
  capitalize?: boolean
  full?: string
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-dashed py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right font-medium ${mono ? 'font-mono' : ''} ${
          capitalize ? 'capitalize' : ''
        }`}
        title={full || value}
      >
        {value}
      </dd>
    </div>
  )
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string
  value: number
  warn?: boolean
}) {
  return (
    <span className="text-xs">
      <span className="text-muted-foreground">{label} </span>
      <span className={`font-medium tabular-nums ${warn ? 'text-warning' : ''}`}>
        {value}
      </span>
    </span>
  )
}
