import { useMemo } from 'react'
import { AlertTriangle, Loader2, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { dhakaTodayString } from '@/lib/dhaka-time'
import {
  COMMISSION_PURPOSES,
  THRESHOLD_PERIODS,
  VALUE_BASES,
  type CommissionAmountType,
  type CommissionPurpose,
  type CommissionRuleV2,
  type CommissionRuleV2Input,
  type ThresholdPeriod,
  type ValueBasis,
} from '../api'
import { EffectiveRange } from './effective-range'

/**
 * One commission rule, fully configured.
 *
 * This is the whole configuration for a single rule — from "Commission For"
 * through to its own validity dates. Nothing is inherited from a sibling rule,
 * so an employee can hold a rate for Confirmed, a different one for Packed, and
 * a third that starts next month, all side by side.
 *
 * The block is self-contained: it owns its state, reports whether it is dirty,
 * and surfaces its own save error. The modal stacks several of these and saves
 * them together, so a failure on one rule must never be reported as a blanket
 * success or hide the rules that did save.
 */

export interface RuleDraft {
  /** Null until the rule has been persisted; a local id keys it before then. */
  id: string | null
  localId: string
  rule: CommissionRuleV2Input
}

export function emptyDraft(employeeId: string, purpose: CommissionPurpose): RuleDraft {
  return {
    id: null,
    localId: `new-${Math.random().toString(36).slice(2, 9)}`,
    rule: {
      employeeId,
      purpose,
      amountType: 'fixed',
      amount: 0,
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
      effectiveFrom: null,
      effectiveTo: null,
    },
  }
}

export function draftFromRule(rule: CommissionRuleV2): RuleDraft {
  return {
    id: rule.id,
    localId: `rule-${rule.id}`,
    rule: {
      employeeId: rule.employeeId,
      purpose: rule.purpose,
      amountType: rule.amountType,
      amount: rule.amount,
      valueBasis: (rule.valueBasis as ValueBasis) ?? 'order_total',
      minOrderAmount: rule.minOrderAmount,
      capPerOrder: rule.capPerOrder,
      minimumCount: rule.minimumCount,
      thresholdPeriod: rule.thresholdPeriod,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
    },
  }
}

interface RuleEditorProps {
  draft: RuleDraft
  saved: CommissionRuleV2 | null
  employeeName: string
  /** Purposes already taken by another rule of this employee, so none can repeat. */
  usedPurposes: CommissionPurpose[]
  onChange: (next: RuleDraft) => void
  onSave: () => void
  onEndNow?: () => void
  onRemove?: () => void
  isSaving: boolean
  error: string | null
}

export function RuleEditor({
  draft,
  saved,
  employeeName,
  usedPurposes,
  onChange,
  onSave,
  onEndNow,
  onRemove,
  isSaving,
  error,
}: RuleEditorProps) {
  const { rule } = draft
  const isNew = draft.id === null
  const purpose = COMMISSION_PURPOSES.find((p) => p.value === rule.purpose)
  const idp = draft.localId

  function patch(next: Partial<CommissionRuleV2Input>) {
    onChange({ ...draft, rule: { ...rule, ...next } })
  }

  /** Optional numeric fields are '' when untouched — a real number or null otherwise. */
  const num = (v: string) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const amount = Number.isFinite(rule.amount) && rule.amount > 0
  const canSave = amount && (!usedPurposes.includes(rule.purpose) || !isNew) && !isSaving

  // A rule that starts in the future legitimately pays nothing until then. That
  // is correct behaviour, but it surprises people at payroll time, so it is
  // stated on the block rather than discovered later.
  const futureStart =
    !!rule.effectiveFrom && rule.effectiveFrom > dhakaTodayString()

  const summary = useMemo(() => {
    if (!amount) return null
    const value =
      rule.amountType === 'fixed'
        ? `৳${rule.amount.toFixed(2)} per qualifying ${rule.purpose} order`
        : `${rule.amount.toFixed(2)}% of the ${rule.valueBasis === 'subtotal' ? 'subtotal' : 'order total'} for each qualifying ${rule.purpose} order`
    const parts: string[] = [`${employeeName} earns ${value}`]

    if (rule.minimumCount && rule.thresholdPeriod) {
      parts.push(
        `after completing ${rule.minimumCount} qualifying ${rule.purpose} orders each ${rule.thresholdPeriod} ` +
          `(the first ${rule.minimumCount} do not pay; commission starts from order #${rule.minimumCount + 1})`,
      )
    }
    if (rule.minOrderAmount != null) parts.push(`for orders of at least ৳${rule.minOrderAmount.toFixed(2)}`)
    if (rule.capPerOrder != null) parts.push(`(capped at ৳${rule.capPerOrder.toFixed(2)} per order)`)
    return parts.join(' ') + '.'
  }, [
    amount, employeeName, rule.amountType, rule.amount, rule.purpose, rule.valueBasis,
    rule.minimumCount, rule.thresholdPeriod, rule.minOrderAmount, rule.capPerOrder,
  ])

  return (
    <div
      className='rounded-lg border bg-card'
      data-rule-block={draft.localId}
      data-purpose={rule.purpose}
    >
      {/* ── Block header: which rule this is, and its lifecycle actions ── */}
      <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <Badge variant='outline' className='shrink-0 text-[10px]'>
            {purpose?.label ?? rule.purpose}
          </Badge>
          {saved && !saved.isActive && (
            <Badge variant='secondary' className='shrink-0 text-[10px]'>Inactive</Badge>
          )}
          {saved?.effectiveTo && saved.effectiveTo < dhakaTodayString() && (
            <Badge variant='secondary' className='shrink-0 text-[10px]'>Ended</Badge>
          )}
          {isNew && <span className='shrink-0 text-[11px] text-muted-foreground'>Not saved yet</span>}
        </div>

        <div className='flex shrink-0 items-center gap-1'>
          {onEndNow && saved?.isActive && !saved.effectiveTo && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='h-7 text-[11px]'
              disabled={isSaving}
              onClick={onEndNow}
              data-end-now={draft.localId}
            >
              <Zap className='me-1 h-3 w-3' />
              End now
            </Button>
          )}
          {onRemove && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-7 text-[11px] text-muted-foreground'
              disabled={isSaving}
              onClick={onRemove}
              aria-label='Remove this rule'
              data-remove-rule={draft.localId}
            >
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>
      </div>

      <div className='grid gap-3 p-3'>
        {/* ── Commission For ── */}
        <div className='grid gap-2'>
          <Label htmlFor={`${idp}-purpose`}>Commission For</Label>
          <Select
            value={rule.purpose}
            onValueChange={(v) => patch({ purpose: v as CommissionPurpose })}
          >
            <SelectTrigger id={`${idp}-purpose`} data-purpose-trigger={draft.localId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMISSION_PURPOSES.map((p) => {
                const takenByOther = usedPurposes.includes(p.value) && p.value !== rule.purpose
                return (
                  <SelectItem
                    key={p.value}
                    value={p.value}
                    disabled={takenByOther}
                    className={takenByOther ? 'opacity-50' : undefined}
                  >
                    {p.label} — {p.hint}
                    {takenByOther ? ' (already set)' : ''}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {isNew && usedPurposes.includes(rule.purpose) && (
            <p className='text-xs text-destructive'>
              This employee already has a rule for that action. Pick a different one.
            </p>
          )}
        </div>

        {/* ── Type + amount ── */}
        <div className='grid gap-2'>
          <Label>Commission Type</Label>
          <RadioGroup
            value={rule.amountType}
            onValueChange={(v) => patch({ amountType: v as CommissionAmountType })}
            className='flex gap-4'
          >
            <div className='flex items-center gap-2'>
              <RadioGroupItem value='fixed' id={`${idp}-type-fixed`} />
              <Label htmlFor={`${idp}-type-fixed`} className='font-normal'>
                Fixed Amount
              </Label>
            </div>
            <div className='flex items-center gap-2'>
              <RadioGroupItem value='percent' id={`${idp}-type-percent`} />
              <Label htmlFor={`${idp}-type-percent`} className='font-normal'>
                Percentage
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className='grid gap-2'>
          <Label htmlFor={`${idp}-amount`}>
            {rule.amountType === 'fixed' ? 'Amount per qualifying order (৳)' : 'Percentage (%)'}
          </Label>
          <Input
            id={`${idp}-amount`}
            type='number'
            min='0'
            step='0.01'
            value={rule.amount || ''}
            onChange={(e) => patch({ amount: num(e.target.value) ?? 0 })}
            placeholder={rule.amountType === 'fixed' ? '10' : '1.00'}
          />
        </div>

        {rule.amountType === 'percent' && (
          <div className='grid gap-2'>
            <Label htmlFor={`${idp}-basis`}>Percentage is measured against</Label>
            <Select
              value={rule.valueBasis ?? 'order_total'}
              onValueChange={(v) => patch({ valueBasis: v as ValueBasis })}
            >
              <SelectTrigger id={`${idp}-basis`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUE_BASES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ── Threshold: a COUNT of qualifying orders, per period ── */}
        <div className='grid gap-3 rounded-lg border p-3'>
          <div className='flex items-center gap-2'>
            <Checkbox
              id={`${idp}-use-min-count`}
              checked={rule.minimumCount !== null}
              onCheckedChange={(v) =>
                patch(v ? { minimumCount: 50, thresholdPeriod: 'daily' } : { minimumCount: null, thresholdPeriod: null })
              }
            />
            <Label htmlFor={`${idp}-use-min-count`} className='font-normal'>
              Require a minimum number of qualifying orders before paying
            </Label>
          </div>

          {rule.minimumCount !== null && (
            <div className='grid gap-3 ps-6'>
              <div className='grid gap-2'>
                <Label htmlFor={`${idp}-min-count`}>Minimum qualifying orders</Label>
                <Input
                  id={`${idp}-min-count`}
                  type='number'
                  min='1'
                  step='1'
                  value={rule.minimumCount}
                  onChange={(e) => patch({ minimumCount: num(e.target.value) })}
                  placeholder='50'
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor={`${idp}-period`}>Period</Label>
                <Select
                  value={rule.thresholdPeriod ?? 'daily'}
                  onValueChange={(v) => patch({ thresholdPeriod: v as ThresholdPeriod })}
                >
                  <SelectTrigger id={`${idp}-period`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THRESHOLD_PERIODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(() => {
            const min = rule.minimumCount as number
            const period = rule.thresholdPeriod as ThresholdPeriod
            return (
              <p className='text-xs text-muted-foreground'>
                The first {min} qualifying {rule.purpose} orders each {period} only qualify — they do
                not pay. Commission starts from order #{min + 1}. Counts are tracked per employee, per
                action, in Dhaka time.
              </p>
            )
          })()}
            </div>
          )}
        </div>

        {/* ── Per-order amount gate: a DIFFERENT condition from the count ── */}
        <div className='grid gap-3 rounded-lg border p-3'>
          <div className='flex items-center gap-2'>
            <Checkbox
              id={`${idp}-use-min-amount`}
              checked={rule.minOrderAmount !== null}
              onCheckedChange={(v) => patch({ minOrderAmount: v ? 0 : null })}
            />
            <Label htmlFor={`${idp}-use-min-amount`} className='font-normal'>
              Only pay on orders above a minimum amount
            </Label>
          </div>
          {rule.minOrderAmount !== null && (
            <div className='grid gap-2 ps-6'>
              <Label htmlFor={`${idp}-min-amount`}>Minimum order amount (৳)</Label>
              <Input
                id={`${idp}-min-amount`}
                type='number'
                min='0'
                step='0.01'
                value={rule.minOrderAmount}
                onChange={(e) => patch({ minOrderAmount: num(e.target.value) })}
                placeholder='500'
              />
            </div>
          )}
        </div>

        <div className='grid gap-3 rounded-lg border p-3'>
          <div className='flex items-center gap-2'>
            <Checkbox
              id={`${idp}-use-cap`}
              checked={rule.capPerOrder !== null}
              onCheckedChange={(v) => patch({ capPerOrder: v ? 0 : null })}
            />
            <Label htmlFor={`${idp}-use-cap`} className='font-normal'>
              Cap the commission for a single order
            </Label>
          </div>
          {rule.capPerOrder !== null && (
            <div className='grid gap-2 ps-6'>
              <Label htmlFor={`${idp}-cap`}>Maximum commission per order (৳)</Label>
              <Input
                id={`${idp}-cap`}
                type='number'
                min='0'
                step='0.01'
                value={rule.capPerOrder}
                onChange={(e) => patch({ capPerOrder: num(e.target.value) })}
                placeholder='100'
              />
            </div>
          )}
        </div>

        {/* ── This rule's own validity window ── */}
        <EffectiveRange
          idPrefix={idp}
          effectiveFrom={rule.effectiveFrom ?? null}
          effectiveTo={rule.effectiveTo ?? null}
          onChange={(next) =>
            patch({ effectiveFrom: next.effectiveFrom, effectiveTo: next.effectiveTo })
          }
        />

        {futureStart && (
          <div
            className='flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2'
            data-future-start-warning
          >
            <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
            <p className='text-xs'>
              This rule starts on {rule.effectiveFrom}. It pays nothing before that date — including
              today, if the rule was already paying.
            </p>
          </div>
        )}

        {summary && (
          <div className='rounded-lg border border-primary/25 bg-primary/5 p-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1'>
              What this rule does
            </p>
            <p className='text-sm leading-relaxed'>{summary}</p>
          </div>
        )}

        {error && (
          <p className='rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive' data-rule-error>
            {error}
          </p>
        )}
      </div>

      {/* ── Per-block save ── */}
      <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
        {isNew && onRemove && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='me-auto text-[11px]'
            disabled={isSaving}
            onClick={onRemove}
          >
            Discard
          </Button>
        )}
        <Button
          type='button'
          size='sm'
          className='h-7 text-[11px]'
          disabled={!canSave}
          onClick={onSave}
          data-save-rule={draft.localId}
        >
          {isSaving && <Loader2 className='me-1 h-3 w-3 animate-spin' />}
          {isNew ? 'Add this rule' : 'Save this rule'}
        </Button>
      </div>
    </div>
  )
}