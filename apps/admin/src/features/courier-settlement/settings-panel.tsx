import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCourierSettlementMutations, useFinanceRules } from './hooks'
import type { FinanceRuleResponse, FinanceRuleTestResponse } from './api'

const NET_RULES = [
  'declared_field',
  'collected_minus_charges',
  'billing_when_no_collection',
  'component_sum',
] as const

const prettyRule = (r: string) => r.replace(/_/g, ' ')

/**
 * Rules (§11, was "Settings"): versioned declarative finance rules only — no
 * expression evaluation. Every approval archives the superseded configuration
 * as a immutable version (§12), so a finalized invoice always points at the
 * rule text that governed it. A rule must be approved by a
 * `finalize_courier_settlement` holder before financial finalization is allowed
 * for a generic/unproven provider.
 */
export function SettingsPanel() {
  const { data: rules, isLoading } = useFinanceRules()
  const { createFinanceRule, testFinanceRule } = useCourierSettlementMutations()

  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<FinanceRuleResponse | null>(null)
  const [showTest, setShowTest] = useState(false)

  // Builder form.
  const [courier, setCourier] = useState('')
  const [format, setFormat] = useState('')
  const [netRule, setNetRule] = useState<string>('declared_field')
  const [tolerance, setTolerance] = useState('1')
  const [residualThreshold, setResidualThreshold] = useState('100')
  const [note, setNote] = useState('')

  // §12 sample-row test.
  const [sCollected, setSCollected] = useState('')
  const [sCharges, setSCharges] = useState('')
  const [sNet, setSNet] = useState('')
  const [sBilling, setSBilling] = useState('')
  const [testResult, setTestResult] = useState<FinanceRuleTestResponse | null>(null)

  const resetForm = () => {
    setEditing(null)
    setCourier('')
    setFormat('')
    setNetRule('declared_field')
    setTolerance('1')
    setResidualThreshold('100')
    setNote('')
    setTestResult(null)
    setShowTest(false)
  }

  const startNewVersion = (r: FinanceRuleResponse) => {
    setEditing(r)
    setCourier(r.courier)
    setFormat(r.format ?? '')
    setNetRule(r.netRule)
    setTolerance(String(r.tolerance ?? 1))
    setResidualThreshold(String(r.residualThreshold ?? 100))
    setNote('')
    setTestResult(null)
    setShowTest(false)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() =>
        document.getElementById('cs-rule-builder')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      )
    }
  }

  const save = () => {
    if (!courier) return
    createFinanceRule.mutate(
      {
        courier,
        format: format || undefined,
        netRule,
        tolerance: Number(tolerance) || 1,
        residualThreshold: Number(residualThreshold) || 100,
        note: note || undefined,
      },
      { onSuccess: () => resetForm() },
    )
  }

  const runTest = () => {
    const sample: Record<string, unknown> = {}
    if (sCollected !== '') sample.collected = Number(sCollected) || 0
    if (sCharges !== '') sample.charges = Number(sCharges) || 0
    if (sNet !== '') sample.net = Number(sNet) || 0
    if (sBilling !== '') sample.billing = Number(sBilling) || 0
    testFinanceRule.mutate(
      {
        netRule,
        tolerance: Number(tolerance) || 1,
        residualThreshold: Number(residualThreshold) || 100,
        sample,
      },
      { onSuccess: (res) => setTestResult(res) },
    )
  }

  const toggleHistory = (id: string) =>
    setOpenHistory((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-4">
      <Card className="chart-card rounded-2xl animate-rise">
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>Finance rules</CardTitle>
              <CardDescription>
                Versioned declarative net rules — every approval archives the previous version, so a
                finalized invoice stays reconstructible. Approved rules gate finalization per courier
                and format.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !rules || rules.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No finance rules yet. Finalization is disabled for generic providers until one is
              approved.
            </p>
          ) : (
            rules.map((r) => {
              const components = Array.isArray(r.chargeComponents)
                ? (r.chargeComponents as { header?: string; field?: string; sign?: number }[])
                : []
              const archived = (r.versions ?? []).slice().reverse()
              const isOpen = openHistory.has(r.id)
              return (
              <div key={r.id} className="rounded-xl border border-border/50">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-2">
                  <span className="text-sm font-semibold capitalize">{r.courier}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.format ?? 'default format'}
                  </span>
                  <Badge variant="outline" className="tabular-nums">
                    v{r.version ?? 1}
                  </Badge>
                  {r.approvedAt ? (
                    <Badge variant="success">
                      approved
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      pending
                    </Badge>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="tap-h rounded-md text-xs"
                      onClick={() => {
                        startNewVersion(r)
                        setShowTest(true)
                      }}
                    >
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="tap-h rounded-md text-xs"
                      onClick={() => startNewVersion(r)}
                    >
                      Create new version
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="tap-h rounded-md text-xs"
                      onClick={() => toggleHistory(r.id)}
                    >
                      {isOpen ? 'Hide history' : `History (${(r.versions ?? []).length})`}
                    </Button>
                  </div>
                </div>

                  <dl className="grid gap-x-6 gap-y-1.5 px-3 py-2.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Net source" value={prettyRule(r.netRule)} />
                    <Field
                      label="Charge components"
                      value={
                        components.length === 0
                          ? '—'
                          : components
                              .map((c) => `${c.header ?? c.field ?? '?'}${(c.sign ?? 1) < 0 ? ' −' : ''}`)
                              .join(', ')
                      }
                      title={components.map((c) => `${c.header ?? c.field ?? '?'} (sign ${c.sign ?? 1})`).join('\n')}
                    />
                    <Field label="Residual tolerance" value={`±${r.tolerance}`} mono />
                    <Field
                      label="Effective from"
                      value={r.approvedAt ? new Date(r.approvedAt).toLocaleString() : '—'}
                    />
                    <Field label="Approved by" value={r.approvedById ?? '—'} />
                    <Field label="Note" value={r.note ?? '—'} />
                  </dl>

                  {isOpen ? (
                    <div className="border-t px-3 py-2.5">
                      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Version history
                      </div>
                      <ul className="space-y-1">
                        <li className="flex flex-wrap items-center gap-2 rounded-sm bg-muted/50 px-2 py-1.5 text-xs">
                          <span className="font-medium tabular-nums">v{r.version ?? 1}</span>
                          <span className="text-muted-foreground">current · {prettyRule(r.netRule)}</span>
                          <span className="ml-auto text-muted-foreground">
                            {r.approvedAt ? new Date(r.approvedAt).toLocaleString() : 'pending'}
                          </span>
                        </li>
                        {archived.map((v) => (
                          <li
                            key={v.version}
                            className="flex flex-wrap items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
                          >
                            <span className="font-medium tabular-nums">v{v.version}</span>
                            <span className="text-muted-foreground">
                              {prettyRule(String(v.snapshot?.netRule ?? '—'))} · tol ±
                              {v.snapshot?.tolerance ?? '—'}
                            </span>
                            <span className="ml-auto text-muted-foreground">
                              {v.approvedAt ? new Date(v.approvedAt).toLocaleString() : ''}
                            </span>
                          </li>
                        ))}
                        {archived.length === 0 ? (
                          <li className="px-2 py-1 text-xs text-muted-foreground">
                            First version — nothing superseded yet.
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card id="cs-rule-builder" className="chart-card rounded-2xl">
        <CardHeader>
          <CardTitle>
            {editing ? `Create new version — ${editing.courier}` : 'Add finance rule'}
          </CardTitle>
          <CardDescription>
            {editing
              ? 'The current configuration is archived as its own version; saving bumps the rule. Fields are locked to this courier and format.'
              : 'Approve a declarative rule for a courier and format. Saving creates version 1; re-saving later archives it and creates the next version.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fr-courier">Courier</Label>
            <Input
              id="fr-courier"
              value={courier}
              onChange={(e) => setCourier(e.target.value)}
              placeholder="e.g. steadfast"
              disabled={!!editing}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fr-format">Format (optional)</Label>
            <Input
              id="fr-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="e.g. monthly"
              disabled={!!editing}
            />
          </div>
          <div className="space-y-2">
            <Label>Net rule</Label>
            <Select value={netRule} onValueChange={setNetRule}>
              <SelectTrigger className="tap-h">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NET_RULES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {prettyRule(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fr-tol">Tolerance (৳)</Label>
              <Input
                id="fr-tol"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fr-thr">Residual threshold (৳)</Label>
              <Input
                id="fr-thr"
                value={residualThreshold}
                onChange={(e) => setResidualThreshold(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="fr-note">Note</Label>
            <Input
              id="fr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this rule is correct for the courier"
            />
          </div>

          {/* ── §12: Test against sample rows ── */}
          <div className="space-y-3 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="tap-h rounded-md text-xs"
                onClick={() => setShowTest((v) => !v)}
              >
                {showTest ? 'Hide sample test' : 'Test against sample rows'}
              </Button>
              <span className="text-xs text-muted-foreground">
                Pure arithmetic over pasted numbers — never evaluates a stored formula.
              </span>
            </div>
            {showTest ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ft-collected" className="text-xs">
                      Collected
                    </Label>
                    <Input
                      id="ft-collected"
                      value={sCollected}
                      onChange={(e) => setSCollected(e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="tap-h text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ft-charges" className="text-xs">
                      Charges
                    </Label>
                    <Input
                      id="ft-charges"
                      value={sCharges}
                      onChange={(e) => setSCharges(e.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="tap-h text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ft-net" className="text-xs">
                      Net / payout
                    </Label>
                    <Input
                      id="ft-net"
                      value={sNet}
                      onChange={(e) => setSNet(e.target.value)}
                      inputMode="decimal"
                      placeholder="for declared_field"
                      className="tap-h text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ft-billing" className="text-xs">
                      Billing
                    </Label>
                    <Input
                      id="ft-billing"
                      value={sBilling}
                      onChange={(e) => setSBilling(e.target.value)}
                      inputMode="decimal"
                      placeholder="for billing rule"
                      className="tap-h text-xs"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="tap-h rounded-md text-xs"
                    onClick={runTest}
                    disabled={testFinanceRule.isPending}
                  >
                    {testFinanceRule.isPending ? 'Testing…' : 'Run test'}
                  </Button>
                  {testResult ? (
                    <Badge
                      variant={
                        testResult.severity === 'ok'
                          ? 'success'
                          : testResult.severity === 'yellow'
                            ? 'warning'
                            : testResult.severity === 'red'
                              ? 'danger'
                              : 'outline'
                      }
                    >
                      {testResult.ok ? 'passes' : testResult.severity ?? 'no net'}
                    </Badge>
                  ) : null}
                </div>
                {testResult ? (
                  <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/50 bg-muted/40 px-3 py-2 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">Charges </span>
                      <span className="font-medium tabular-nums">{testResult.charges}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Net </span>
                      <span className="font-medium tabular-nums">
                        {testResult.net ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Residual </span>
                      <span className="font-medium tabular-nums">
                        {testResult.residual ?? '—'}
                      </span>
                    </div>
                    <p className="text-muted-foreground sm:col-span-3">{testResult.explanation}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button onClick={save} disabled={!courier || createFinanceRule.isPending} className="tap-h">
              {createFinanceRule.isPending
                ? 'Saving…'
                : editing
                  ? `Create version ${(editing.version ?? 1) + 1}`
                  : 'Save rule'}
            </Button>
            {editing ? (
              <Button variant="ghost" className="tap-h rounded-md text-xs" onClick={resetForm}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  title,
}: {
  label: string
  value: string
  mono?: boolean
  title?: string
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-dashed py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right font-medium ${mono ? 'font-mono tabular-nums' : ''}`}
        title={title || value}
      >
        {value}
      </dd>
    </div>
  )
}
