import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

const fmt = (v: number) => `৳${(Math.round(v * 100) / 100).toFixed(2)}`

/**
 * Submit gate for the paid-confirm block. The dialog can NEVER skip it:
 * confirmed must be checked, the figure non-negative, and any figure that
 * differs from the recorded Σ PAID needs a written reason (mirrors the
 * backend paidConfirmed/paidAdjustmentReason fail-closed rule).
 */
export function isPaidConfirmValid(
  paid: number,
  recordedPaid: number,
  reason: string,
  confirmed: boolean,
): boolean {
  if (!confirmed) return false
  if (!Number.isFinite(paid) || paid < 0) return false
  if (Math.abs(paid - recordedPaid) > 0.005 && !reason.trim()) return false
  return true
}

/**
 * Exchange "Already paid" confirmation (phase-1 paidConfirmed contract).
 *
 * Pre-filled from the ledger (Σ PAID rows on the original order). Staff may
 * edit the figure, but the SIGNED rule applies: a positive delta ADDS credit
 * to the exchange, a negative delta REDUCES it — and any difference needs a
 * written reason. The live bill preview reads original → adjustment →
 * new total so staff see collect-vs-refund before submitting.
 */
export function ExchangePaidConfirm({
  recordedPaid,
  exchangeTotal,
  paid,
  reason,
  confirmed,
  onPaid,
  onReason,
  onConfirmed,
}: {
  recordedPaid: number
  exchangeTotal: number
  paid: number
  reason: string
  confirmed: boolean
  onPaid: (v: number) => void
  onReason: (v: string) => void
  onConfirmed: (v: boolean) => void
}) {
  const diff = (Number(paid) || 0) - (Number(recordedPaid) || 0)
  const differs = Math.abs(diff) > 0.005
  const due = (Number(exchangeTotal) || 0) - (Number(paid) || 0)

  return (
    <div className='rounded-lg border border-border p-3.5 space-y-3'>
      <div className='text-xs font-semibold text-foreground'>Already paid on the original</div>
      <p className='text-[11px] text-muted-foreground -mt-1.5'>
        Ledger Σ PAID: <span className='font-semibold text-foreground'>{fmt(recordedPaid)}</span>.
        Confirm the figure below — a positive change ADDS credit, a negative change REDUCES it.
      </p>

      <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
        <div>
          <Label htmlFor='ex-paid-confirmed' className='text-xs text-muted-foreground mb-1 block'>
            Confirmed paid (৳)
          </Label>
          <Input
            id='ex-paid-confirmed'
            type='number'
            min={0}
            step='0.01'
            value={Number.isFinite(paid) ? paid : 0}
            onChange={(e) => onPaid(parseFloat(e.target.value) || 0)}
            className='h-9 text-sm'
          />
          {!differs ? (
            <p className='text-[11px] text-emerald-600 mt-1'>Matches the ledger — no adjustment.</p>
          ) : diff > 0 ? (
            <p className='text-[11px] text-foreground mt-1'>
              <span className='font-semibold text-emerald-600'>+{fmt(diff)} ADDS</span> to the exchange credit.
            </p>
          ) : (
            <p className='text-[11px] text-foreground mt-1'>
              <span className='font-semibold text-amber-600'>−{fmt(Math.abs(diff))} REDUCES</span> the exchange credit.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor='ex-paid-reason' className='text-xs text-muted-foreground mb-1 block'>
            Adjustment reason {differs ? '(required)' : '(only if adjusted)'}
          </Label>
          <Textarea
            id='ex-paid-reason'
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder='Why does the confirmed figure differ from the ledger?'
            className='text-sm resize-none'
          />
        </div>
      </div>

      <div className='bg-muted/50 rounded-xl p-3 space-y-1.5 text-sm border border-border/40'>
        <div className='flex justify-between items-center text-xs'>
          <span className='text-muted-foreground'>Original paid</span>
          <span className='font-medium'>{fmt(recordedPaid)}</span>
        </div>
        <div className='flex justify-between items-center text-xs'>
          <span className='text-muted-foreground'>Adjustment</span>
          <span className={`font-medium ${differs ? (diff > 0 ? 'text-emerald-600' : 'text-amber-600') : ''}`}>
            {!differs ? '—' : diff > 0 ? `+${fmt(diff)}` : `−${fmt(Math.abs(diff))}`}
          </span>
        </div>
        <div className='flex justify-between items-center text-xs'>
          <span className='text-muted-foreground'>New exchange total</span>
          <span className='font-medium'>{fmt(exchangeTotal)}</span>
        </div>
        <div className='flex justify-between items-center font-bold text-sm pt-1.5 border-t border-border/60'>
          {due > 0.005 ? (
            <>
              <span>To collect</span>
              <span className='text-primary'>{fmt(due)}</span>
            </>
          ) : due < -0.005 ? (
            <>
              <span className='text-amber-600'>Refund due</span>
              <span className='text-amber-600'>{fmt(Math.abs(due))}</span>
            </>
          ) : (
            <>
              <span>Settled exactly</span>
              <span className='text-emerald-600'>{fmt(0)}</span>
            </>
          )}
        </div>
      </div>

      <label htmlFor='ex-paid-confirm' className='flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-border p-3 hover:bg-muted/40'>
        <Checkbox
          id='ex-paid-confirm'
          checked={confirmed}
          onCheckedChange={(v) => onConfirmed(v === true)}
        />
        <span className='text-xs text-muted-foreground leading-relaxed'>
          <span className='font-semibold text-foreground block'>I confirm the customer paid {fmt(paid)} on the original order.</span>
          This figure drives the settlement — it cannot be skipped.
        </span>
      </label>
    </div>
  )
}
