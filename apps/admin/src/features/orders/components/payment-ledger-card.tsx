import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'

export interface LedgerPayment {
  id: string
  amount: number | string
  status: string
  gatewayCode?: string | null
  account?: string | null
  transactionId?: string | null
  recordedAt?: string | null
  createdAt?: string | null
  recordedBy?: string | null
  submittedBy?: string | null
  notes?: string | null
}

function statusLabel(status?: string | null): string {
  const s = (status || '').toLowerCase()
  if (s === 'paid' || s === 'verified' || s === 'completed') return 'verified'
  if (s === 'pending' || s === 'payment_pending' || s === 'payment_verifying') return 'pending'
  return s || '—'
}

function statusVariant(status?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = (status || '').toLowerCase()
  if (s === 'paid' || s === 'verified' || s === 'completed') return 'default'
  if (s === 'pending' || s === 'payment_pending' || s === 'payment_verifying') return 'secondary'
  if (s === 'failed' || s === 'cancelled' || s === 'refunded') return 'destructive'
  return 'outline'
}

/** Shorten `staff:<userId>` / `customer:<id>` actor tags for display. */
export function ledgerActor(p: Pick<LedgerPayment, 'recordedBy' | 'submittedBy'>): string {
  const raw = p.recordedBy || p.submittedBy
  if (!raw) return '—'
  const m = raw.match(/^(staff|customer):(.+)$/)
  return m ? `${m[1]} ${m[2].slice(0, 8)}` : raw
}

const fmtSigned = (v: number | string) => {
  const n = Number(v)
  const sign = n < 0 ? '-' : '+'
  return `${sign}৳${Math.abs(n).toLocaleString()}`
}

/**
 * Full append-only payment ledger (Task 11). Corrections are NEW negative
 * entries via the refund/record flows — this card deliberately renders NO
 * in-place edit affordance on listed rows (S2 OFF hides editing entirely).
 */
export function PaymentLedgerCard({
  payments,
  onRecordPayment,
  onRecordRefund,
}: {
  payments: LedgerPayment[]
  onRecordPayment: () => void
  onRecordRefund: () => void
}) {
  return (
    <div className="space-y-2.5 pt-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Payment ledger
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={onRecordPayment}>
            Record payment
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={onRecordRefund}>
            Record refund
          </Button>
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
          No payments recorded yet — use Record payment for the first entry.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium">Gateway / Account</th>
                <th className="px-3 py-2 font-medium">Txn ID</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Recorded by</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const negative = Number(p.amount) < 0
                return (
                  <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {p.recordedAt || p.createdAt
                        ? new Date((p.recordedAt || p.createdAt) as string).toLocaleString()
                        : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${negative ? 'text-pink-600 dark:text-pink-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {fmtSigned(p.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-foreground">{p.gatewayCode || '—'}</span>
                      {p.account && (
                        <span className="block font-mono text-[11px] text-muted-foreground">{p.account}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.transactionId ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-foreground">
                          <span className="truncate max-w-28">{p.transactionId}</span>
                          <CopyButton text={p.transactionId} label="TrxID" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(p.status)} className="text-[10px]">
                        {statusLabel(p.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground font-mono text-[11px]">
                      {ledgerActor(p)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-40 truncate" title={p.notes || ''}>
                      {p.notes || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
