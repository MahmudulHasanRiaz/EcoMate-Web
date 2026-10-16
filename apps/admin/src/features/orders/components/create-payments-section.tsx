import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2 } from 'lucide-react'

export interface CollectedPaymentRow {
  amount: string
  gatewayCode: string
  account: string
  transactionId: string
  note: string
}

export const GATEWAY_OPTIONS = ['cash', 'bkash', 'nagad', 'bank', 'card']

export const emptyCollectedRow = (): CollectedPaymentRow => ({
  amount: '',
  gatewayCode: 'cash',
  account: '',
  transactionId: '',
  note: '',
})

/** Rows with any filled field — fully-empty rows are ignored, never validated. */
export function nonEmptyCollectedRows(rows: CollectedPaymentRow[]): CollectedPaymentRow[] {
  return rows.filter(
    (r) => r.amount.trim() || r.account.trim() || r.transactionId.trim() || r.note.trim(),
  )
}

export function collectedRowsTotal(rows: CollectedPaymentRow[]): number {
  return rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
}

/**
 * Mirror of the server ledger guards (account always, txn iff the entry will
 * await verification, positive amounts). Returns human errors; [] = submittable.
 *
 * D (owner-locked): txn requirement is PER ROW when a resolver is passed —
 * each row's gateway has its own effective S1 (tri-state override ?? global).
 */
export function validateCollectedRows(
  rows: CollectedPaymentRow[],
  txnRequired: boolean | ((gatewayCode: string) => boolean),
): string[] {
  const needsTxn = (gw: string) =>
    typeof txnRequired === 'function' ? txnRequired(gw) : txnRequired
  const errors: string[] = []
  nonEmptyCollectedRows(rows).forEach((r, i) => {
    const n = `Row ${i + 1}`
    const amt = parseFloat(r.amount)
    if (!r.amount || isNaN(amt) || amt <= 0) errors.push(`${n}: enter an amount greater than 0`)
    if (!r.gatewayCode) errors.push(`${n}: gateway is required`)
    if (!r.account.trim()) errors.push(`${n}: account is required`)
    if (needsTxn(r.gatewayCode) && !r.transactionId.trim()) errors.push(`${n}: transaction ID is required`)
  })
  return errors
}

/**
 * Multi-row collected-payments section for order CREATE (full/partial).
 * Rows are recorded via POST /payments/:id AFTER the order is created
 * (backend create takes no payment rows) — see create.tsx submit flow.
 * Overpayment is allowed and only warns: the excess becomes customer credit.
 */
export function CreatePaymentsSection({
  rows,
  onRowsChange,
  txnRequired,
  total,
  creditBalance,
  applyCredit,
  onApplyCreditChange,
  creditAmount,
  onCreditAmountChange,
}: {
  rows: CollectedPaymentRow[]
  onRowsChange: (rows: CollectedPaymentRow[]) => void
  /** Boolean = same for every row; resolver = per-row effective S1 (D). */
  txnRequired: boolean | ((gatewayCode: string) => boolean)
  total: number
  creditBalance: number
  applyCredit: boolean
  onApplyCreditChange: (v: boolean) => void
  creditAmount: string
  onCreditAmountChange: (v: string) => void
}) {
  const collected = collectedRowsTotal(nonEmptyCollectedRows(rows))
  const over = Math.max(0, Math.round((collected - total) * 100) / 100)
  const rowTxnRequired = (gw: string) =>
    typeof txnRequired === 'function' ? txnRequired(gw) : txnRequired

  function patch(i: number, p: Partial<CollectedPaymentRow>) {
    onRowsChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  }

  return (
    <div className="p-3.5 bg-muted/40 rounded-xl border border-border/60 space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Collected now — one row per method. Recorded after the order is created.
      </p>
      {rows.map((r, i) => {
        const needsTxn = rowTxnRequired(r.gatewayCode)
        return (
        <div key={i} className="rounded-lg border border-border/60 bg-background p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Amount (৳) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={r.amount}
                onChange={(e) => patch(i, { amount: e.target.value })}
                placeholder="0.00"
                className="h-9 text-sm"
                aria-label={`Row ${i + 1} amount`}
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Gateway *</Label>
              <select
                value={r.gatewayCode}
                onChange={(e) => patch(i, { gatewayCode: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label={`Row ${i + 1} gateway`}
              >
                {GATEWAY_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Account *</Label>
              <Input
                value={r.account}
                onChange={(e) => patch(i, { account: e.target.value })}
                placeholder="Receiving account"
                className="h-9 text-sm"
                aria-label={`Row ${i + 1} account`}
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                Transaction ID{needsTxn ? ' *' : ''}
              </Label>
              <Input
                value={r.transactionId}
                onChange={(e) => patch(i, { transactionId: e.target.value })}
                placeholder={needsTxn ? 'Required — entry needs verification' : 'Optional — auto-verified'}
                className="h-9 text-sm font-mono"
                aria-label={`Row ${i + 1} transaction ID`}
              />
            </div>
          </div>
          {needsTxn && (
            <p className="text-[11px] text-muted-foreground">Transaction ID required — entries need verification (auto-verify off for this gateway).</p>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={r.note}
              onChange={(e) => patch(i, { note: e.target.value })}
              placeholder="Note (optional)"
              className="h-9 text-sm flex-1"
              aria-label={`Row ${i + 1} note`}
            />
            {rows.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-destructive hover:bg-destructive/10 shrink-0"
                onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove row ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        )
      })}
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs font-medium"
        onClick={() => onRowsChange([...rows, emptyCollectedRow()])}
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add payment row
      </Button>

      {over > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
          Overpayment ৳{over.toLocaleString()} — allowed, the excess becomes customer credit.
        </p>
      )}

      {creditBalance > 0 && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={applyCredit}
              onChange={(e) => onApplyCreditChange(e.target.checked)}
              className="accent-primary"
            />
            Apply credit ৳{Number(creditBalance).toLocaleString()}
          </label>
          {applyCredit && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Credit amount (৳)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={creditAmount}
                onChange={(e) => onCreditAmountChange(e.target.value)}
                placeholder={`Up to ৳${Number(creditBalance).toLocaleString()}`}
                className="h-9 text-sm"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
