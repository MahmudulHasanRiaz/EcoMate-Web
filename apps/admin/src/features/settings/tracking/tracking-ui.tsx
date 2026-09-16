import { Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Shared presentation primitives for the provider-oriented Tracking Settings
 * page (Meta / TikTok / GA4). Presentation only — no setting keys, API calls,
 * or tracking semantics live here.
 */

/**
 * Compact info affordance: a small `?`-style button that opens the same short
 * explanation on hover, keyboard focus, and mobile tap (Radix Popover).
 * Use sparingly — only where the label alone is ambiguous.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label={`About ${label}`}
          className='inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        >
          <Info className='h-3.5 w-3.5' />
        </button>
      </PopoverTrigger>
      <PopoverContent side='top' className='w-64 text-xs leading-relaxed'>
        {text}
      </PopoverContent>
    </Popover>
  )
}

/** Label + InfoTip pairing used across provider forms. */
export function FieldLabel({ htmlFor, children, tip }: { htmlFor?: string; children: React.ReactNode; tip?: string }) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      <Label htmlFor={htmlFor}>{children}</Label>
      {tip && <InfoTip label={typeof children === 'string' ? children : 'this field'} text={tip} />}
    </span>
  )
}

/**
 * Compact provider header row: identity, live/disabled status, master switch.
 * The switch stays in the header so enablement is visible without scrolling.
 */
export function ProviderHeader({
  title,
  enabled,
  onToggle,
  disabled,
  statusHint,
}: {
  title: string
  enabled: boolean
  onToggle: (v: boolean) => void
  disabled?: boolean
  statusHint?: string
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='flex min-w-0 items-center gap-2'>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden />
        <h3 className='truncate text-base font-semibold'>{title}</h3>
        <span className='shrink-0 text-xs text-muted-foreground'>
          {statusHint ?? (enabled ? 'Enabled' : 'Disabled')}
        </span>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} aria-label={`${title} enabled`} />
    </div>
  )
}

/**
 * Shared provider-level Purchase timing controls (Meta + TikTok use the same
 * semantics: provider-level instant/validated + trigger status). Controlled —
 * all state lives in the page so Save behavior is unchanged.
 */
export function PurchaseTimingFields({
  idPrefix,
  mode,
  onModeChange,
  status,
  onStatusChange,
  statusList,
  disabled,
}: {
  idPrefix: string
  mode: string
  onModeChange: (v: string) => void
  status: string
  onStatusChange: (v: string) => void
  statusList: { id: string; name: string }[] | undefined
  disabled?: boolean
}) {
  return (
    <div className='grid gap-4 sm:grid-cols-2'>
      <div className='space-y-2'>
        <FieldLabel
          htmlFor={`${idPrefix}-purchase-mode`}
          tip='Instant sends the Purchase right away (browser + server). Validated waits until the order reaches the trigger status, then sends server-side only. Applies to the whole provider.'
        >
          Purchase Event Mode
        </FieldLabel>
        <Select value={mode} onValueChange={onModeChange} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-purchase-mode`} className='bg-background/50'>
            <SelectValue placeholder='Select mode' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='instant'>Instant — Send immediately</SelectItem>
            <SelectItem value='validated'>Validated — Send on status</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-2'>
        <FieldLabel
          htmlFor={`${idPrefix}-validated-status`}
          tip='The order status that triggers the server-side Purchase. Only used when the mode is Validated.'
        >
          Trigger on Status
        </FieldLabel>
        <Select value={status} onValueChange={onStatusChange} disabled={disabled || mode !== 'validated'}>
          <SelectTrigger id={`${idPrefix}-validated-status`} className='bg-background/50'>
            <SelectValue placeholder={mode === 'validated' ? 'Select order status' : 'Needs Validated mode'} />
          </SelectTrigger>
          <SelectContent>
            {(statusList || []).map((s) => (
              <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
