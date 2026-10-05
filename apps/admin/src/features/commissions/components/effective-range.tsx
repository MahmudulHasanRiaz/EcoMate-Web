import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/date-picker'
import { cn } from '@/lib/utils'
import { toDhakaDateString, toDhakaDateStringOrNull, parseDhakaDateString } from '@/lib/dhaka-time'

/**
 * Per-rule validity dates.
 *
 * Each rule owns its own window — nothing is shared between an employee's
 * rules. Every value here is a plain `YYYY-MM-DD` Dhaka calendar day; the
 * conversion to an exact instant happens once on the server (see
 * commission-dates.ts), so the form never does timezone arithmetic itself.
 *
 * The three ways a start can be expressed:
 *   - "From today"    — starts at the beginning of today, Dhaka.
 *   - "From a date"   — a chosen day, which may be in the future.
 *   - "Always"        — no start at all; the rule has always applied.
 *
 * The two ways an end can be expressed:
 *   - "Endless"       — no end; keeps applying until explicitly ended.
 *   - "Ends on"       — a chosen day, inclusive: the rule still pays that day.
 */

type StartMode = 'today' | 'date' | 'always'
type EndMode = 'endless' | 'date'

interface EffectiveRangeProps {
  effectiveFrom: string | null
  effectiveTo: string | null
  onChange: (next: { effectiveFrom: string | null; effectiveTo: string | null }) => void
  /** Disable the start controls while a sibling new rule is still unsaved. */
  disabled?: boolean
  /** Prefix for control ids so several rules can coexist on one page. */
  idPrefix: string
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  name,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
  name: string
}) {
  return (
    // `flex-wrap` is load-bearing: at 390px the three start modes do not fit on
    // one line, and without wrapping the last one is clipped and pushes the
    // whole dialog into horizontal overflow.
    <div role='radiogroup' aria-label={name} className='flex flex-wrap rounded-md border p-0.5'>
      {options.map((o) => (
        <button
          key={o.value}
          type='button'
          role='radio'
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-w-0 flex-1 basis-1/3 rounded-sm px-2 py-1 text-xs transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            value === o.value
              ? 'bg-primary text-primary-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EffectiveRange({
  effectiveFrom,
  effectiveTo,
  onChange,
  disabled,
  idPrefix,
}: EffectiveRangeProps) {
  const today = toDhakaDateString(new Date())

  // Derive the segmented state from the stored value, so the control always
  // reflects what is actually saved rather than a parallel UI state that can
  // drift out of sync with it.
  const startMode: StartMode =
    effectiveFrom === null ? 'always' : effectiveFrom === today ? 'today' : 'date'
  const endMode: EndMode = effectiveTo === null ? 'endless' : 'date'

  const setStartMode = (mode: StartMode) => {
    if (mode === 'always') onChange({ effectiveFrom: null, effectiveTo })
    else if (mode === 'today') onChange({ effectiveFrom: today, effectiveTo })
    // 'date' keeps the current value if there is one, so switching back and
    // forth does not discard a date the operator already picked.
    else if (effectiveFrom === null) onChange({ effectiveFrom: today, effectiveTo })
  }

  const setEndMode = (mode: EndMode) => {
    onChange({ effectiveFrom, effectiveTo: mode === 'endless' ? null : today })
  }

  return (
    <div className='grid gap-2'>
      <Label text='Runs from' htmlFor={`${idPrefix}-from`} />

      <Segmented
        name='Start'
        value={startMode}
        onChange={setStartMode}
        disabled={disabled}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'date', label: 'On a date' },
          { value: 'always', label: 'Always' },
        ]}
      />

      {startMode === 'date' && (
        <DatePicker
          selected={parseDhakaDateString(effectiveFrom)}
          onSelect={(d) => onChange({ effectiveFrom: toDhakaDateStringOrNull(d), effectiveTo })}
          placeholder='Pick a start date'
          allowFuture
        />
      )}

      {startMode === 'today' && (
        <p className='text-xs text-muted-foreground'>
          Pays from the start of today ({today}).
        </p>
      )}
      {startMode === 'always' && (
        <p className='text-xs text-muted-foreground'>
          No start date — this rule has applied to every qualifying order.
        </p>
      )}

      <div className='pt-1'>
        <Label text='Runs until' htmlFor={`${idPrefix}-to`} />
      </div>

      <Segmented
        name='End'
        value={endMode}
        onChange={setEndMode}
        disabled={disabled}
        options={[
          { value: 'endless', label: 'Endless' },
          { value: 'date', label: 'Ends on a date' },
        ]}
      />

      {endMode === 'date' && effectiveTo && (
        <DatePicker
          selected={parseDhakaDateString(effectiveTo)}
          onSelect={(d) => onChange({ effectiveFrom, effectiveTo: toDhakaDateStringOrNull(d) })}
          placeholder='Pick an end date'
        />
      )}

      {endMode === 'endless' && (
        <p className='text-xs text-muted-foreground'>
          Keeps running until you end it. Endless is the default.
        </p>
      )}
      {endMode === 'date' && (
        <p className='text-xs text-muted-foreground'>
          Still pays on {effectiveTo} itself — the end date is inclusive.
        </p>
      )}
    </div>
  )
}

/** Small local Label so this file does not depend on a form-wide label context. */
function Label({ text, htmlFor }: { text: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className='text-xs font-medium text-muted-foreground uppercase tracking-wider'>
      {text}
    </label>
  )
}

/**
 * Read-only rendering of a rule's window, for list rows.
 * "Endless" and "Ended" are distinct facts and are never collapsed into a dash.
 */
export function EffectiveRangeBadge({
  effectiveFrom,
  effectiveTo,
}: {
  effectiveFrom: string | null
  effectiveTo: string | null
}) {
  if (effectiveFrom === null && effectiveTo === null) {
    return <span className='text-xs text-muted-foreground'>Always</span>
  }

  const parts: string[] = []
  parts.push(effectiveFrom ? effectiveFrom : 'Always')
  parts.push('→')
  parts.push(effectiveTo ? effectiveTo : 'Endless')

  return (
    <span className='inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground'>
      {effectiveTo && effectiveTo < toDhakaDateString(new Date()) && (
        <span className='rounded bg-muted px-1 py-0.5 text-[10px]'>Ended</span>
      )}
      {parts.join(' ')}
    </span>
  )
}

/** Icon-only clear affordance used by the rule block header. */
export function ClearDateButton({
  onClick,
  title,
}: {
  onClick: () => void
  title: string
}) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      onClick={onClick}
      title={title}
      aria-label={title}
      className='h-7 w-7 text-muted-foreground'
    >
      <X className='h-3.5 w-3.5' />
    </Button>
  )
}

export { CalendarIcon }