import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useOverview } from './hooks'
import { InvoiceStateBadge } from './state-badge'

const bdt = (v: number) =>
  `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Period = 'month' | 'lastMonth' | '90d' | 'all'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Kpi({
  title,
  value,
  sub,
  tone,
}: {
  title: string
  value: number
  sub?: string
  tone?: 'good' | 'warn' | 'bad'
}) {
  const color =
    tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-foreground'
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold tabular-nums ${color}`}>{bdt(value)}</div>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

/**
 * Overview (§10): two distinct planes — PERIOD FLOW (what settled in the
 * selected period: expected → collected → charges → net → cash) and CURRENT
 * POSITION (what is true right now: COD outstanding, work queue, invoice
 * states). The stock-vs-flow invariant only verifies on an all-time basis, so
 * it says so instead of crying broken on a scoped period.
 */
export function OverviewPanel() {
  const [period, setPeriod] = useState<Period>('month')

  const params = useMemo(() => {
    const now = new Date()
    if (period === 'lastMonth') {
      // to = first of this month → covers every finalized second of last month.
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      }
    }
    if (period === '90d') return { from: iso(new Date(now.getTime() - 90 * 86_400_000)) }
    if (period === 'all') return { from: '1970-01-01' }
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) }
  }, [period])

  const { data, isLoading, isError } = useOverview(params)

  if (isLoading) {
    return <div className="py-10 text-center text-muted-foreground">Loading overview…</div>
  }
  if (isError || !data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load the courier settlement overview. The figures below would be incomplete, so
        nothing is shown.
      </div>
    )
  }

  const { kpis, waterfall, invoicesByState, invariant } = data
  const rangeLabel = `${new Date(data.range.from).toLocaleDateString()} – ${new Date(
    data.range.to,
  ).toLocaleDateString()}`
  const scoped = period !== 'all'
  const flowDelta = invariant.currentEffectiveCharges - invariant.periodCharges

  const steps: { label: string; value: number }[] = [
    { label: 'Expected', value: waterfall.expected },
    { label: 'Collected', value: waterfall.collected },
    { label: 'Charges', value: -waterfall.charges },
    { label: 'Net', value: waterfall.net },
    { label: 'Cash received', value: waterfall.cashReceived },
    { label: 'Cash disbursed', value: -waterfall.cashDisbursed },
  ]

  return (
    <div className="space-y-4">
      {/* ── Period selector ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Flow figures follow the selected period; position figures are current.
        </p>
        <div className="flex items-center rounded-md border p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 cursor-pointer ${
                period === p.value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Period flow ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">Period flow</h2>
          <span className="text-xs text-muted-foreground">{rangeLabel}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi
            title="Settled this period"
            value={kpis.settledThisPeriod.net}
            sub={`received ${bdt(kpis.settledThisPeriod.cashReceived)} · disbursed ${bdt(kpis.settledThisPeriod.cashDisbursed)}`}
          />
          <Kpi title="Courier cost" value={kpis.courierCost} sub="finalized effective charges" />
          <Kpi title="Shipping margin" value={kpis.shippingMargin} />
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Settlement waterfall</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {steps.map((s) => (
                <div key={s.label} className="rounded-md border p-2 text-center">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">
                    {s.value < 0 ? `−${bdt(Math.abs(s.value))}` : bdt(s.value)}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Cash derives from net (the remittance), not gross collected.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── Current position ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Current position</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
            <Kpi
              title="COD outstanding"
              value={kpis.codOutstanding}
              sub={`awaiting settlement ${bdt(kpis.awaitingSettlement)}`}
              tone={kpis.codOutstanding > 0 ? 'warn' : 'good'}
            />
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Exceptions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">RED (blocking)</span>
                  <Badge variant="outline" className="bg-red-100 text-red-800">
                    {kpis.exceptions.red}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">YELLOW</span>
                  <Badge variant="outline" className="bg-amber-100 text-amber-800">
                    {kpis.exceptions.yellow}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Open</span>
                  <Badge variant="outline">{kpis.exceptions.open}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Invoices by state</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(invoicesByState).length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices imported yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(invoicesByState).map(([state, count]) => (
                    <div
                      key={state}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                    >
                      <InvoiceStateBadge state={state} />
                      <span className="text-sm font-semibold tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Stock-vs-flow check: basis-aware ── */}
      {scoped ? (
        <div
          className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground"
          role="status"
        >
          Stock-vs-flow check runs on an <span className="font-medium">All time</span> basis — this
          period's flow {bdt(invariant.periodCharges)} vs current effective{' '}
          {bdt(invariant.currentEffectiveCharges)} differ by{' '}
          <span className="font-medium tabular-nums">{bdt(Math.abs(flowDelta))}</span> (history
          outside the selected period). Switch to All time to verify.
        </div>
      ) : (
        <div
          className={`rounded-md border p-3 text-sm ${
            invariant.equal
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
          role="status"
        >
          <span className="font-medium">
            {invariant.equal ? 'Invariant holds' : 'INVARIANT BROKEN'}
          </span>{' '}
          — current effective charges {bdt(invariant.currentEffectiveCharges)} = sum over all
          periods {bdt(invariant.periodCharges)}.
          {!invariant.equal ? ' Figures are not trustworthy until this is reconciled.' : ''}
        </div>
      )}
    </div>
  )
}
