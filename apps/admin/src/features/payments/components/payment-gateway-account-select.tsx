import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { gatewayApi } from '@/features/gateways/api'
import { adminSelectableGatewayOptions, enabledGatewayOptions } from '@/features/payments/lib/eligible-accounts'

/**
 * Part 3 (owner-locked) + D7 (owner-locked 2026-10-24): ONE shared gateway
 * selector for every staff money form. Config is selected, never typed.
 *
 * D7: there is NO account picker anymore. Every gateway maps to exactly
 * one settlement account in Settings → Payment Gateways, so picking the
 * gateway settles the account — the selection carries the gateway's mapped
 * accountId, derived here, and the backend re-derives it on save as well.
 * When the mapping is missing or its account is inactive, staff see a
 * non-blocking warning: the payment still records, it just posts no
 * accounting entry until the mapping is fixed in Settings.
 *
 * D17: the list comes from the staff-safe /gateways/payment-form endpoint,
 * which embeds each gateway's mapped account — so this component no longer
 * calls the admin-only /gateways/admin (which also returns raw gateway
 * credentials) or /accounts/tree. Both old calls 403'd for employee-role
 * staff, which surfaced as endless "Loading payment configuration…" and
 * then a false "No payment gateway is enabled" message.
 */

export interface PaymentAccountSelection {
  gatewayCode: string
  accountId: string
}

export interface PaymentGatewayAccountSelectProps {
  gatewayCode: string
  accountId: string
  onChange: (next: PaymentAccountSelection) => void
  disabled?: boolean
  /** Optional label; defaults to the canonical "Gateway". */
  gatewayLabel?: string
  /** Tighter typography for inline editors. */
  compact?: boolean
  className?: string
}

export function PaymentGatewayAccountSelect({
  gatewayCode,
  accountId,
  onChange,
  disabled = false,
  gatewayLabel = 'Gateway',
  compact = false,
  className,
}: PaymentGatewayAccountSelectProps) {
  const { data: gateways, isLoading, isError } = useQuery({
    queryKey: ['admin-gateways'],
    queryFn: () => gatewayApi.listPaymentFormGateways().then((r) => r.data),
    staleTime: 60_000,
  })

  const gatewayOptions = useMemo(() => {
    const options = adminSelectableGatewayOptions(gateways)
    // History guard (D6): a form opened for an existing payment context
    // (e.g. recording a payment on an older order) keeps its gateway even
    // when that gateway is now hidden from the admin panel — the flag
    // hides it for NEW selections, never for work already in flight.
    if (gatewayCode && !options.some((g) => g.code === gatewayCode)) {
      const current = enabledGatewayOptions(gateways).find((g) => g.code === gatewayCode)
      if (current) return [...options, current]
    }
    return options
  }, [gateways, gatewayCode])
  // The mapped settlement account rides on the gateway row itself (D17) —
  // no separate account-tree lookup is needed for the settles-to line.
  const selectedGateway = gatewayOptions.find((g) => g.code === gatewayCode)
  const mappedAccountId = selectedGateway?.accountId ?? null
  const mappedAccount = selectedGateway?.account ?? undefined
  // A mapping can go stale when the account is deactivated after being
  // saved. Treat it as unmapped (with an explicit warning) instead of
  // silently stamping an account the journal can no longer post to.
  const brokenMapping = !!mappedAccountId && !mappedAccount
  // The account a payment on the selected gateway will settle to. Empty
  // string = no live mapping; the backend then records the payment with
  // no account (and no journal entry), exactly as an unmapped gateway
  // behaves server-side.
  const derivedAccountId = mappedAccount && mappedAccountId ? mappedAccountId : ''

  // Rule 2: exactly one option is auto-selected. It only fills a blank or
  // invalid value, so an explicit user choice at 2+ is never overwritten.
  useEffect(() => {
    if (isLoading || disabled) return
    if (gatewayOptions.length === 0) return
    if (gatewayCode && gatewayOptions.some((g) => g.code === gatewayCode)) return
    const only = gatewayOptions.length === 1 ? gatewayOptions[0] : undefined
    if (!only) return
    const onlyAccount = only.account ?? undefined
    onChange({ gatewayCode: only.code, accountId: onlyAccount ? only.accountId! : '' })
  }, [isLoading, disabled, gatewayOptions, gatewayCode, onChange])

  // The account is DERIVED from the gateway mapping (D7) — keep the
  // selection in sync whenever the gateway or the mapping changes.
  useEffect(() => {
    if (isLoading || disabled || !selectedGateway) return
    if (accountId !== derivedAccountId) {
      onChange({ gatewayCode, accountId: derivedAccountId })
    }
  }, [isLoading, disabled, selectedGateway, derivedAccountId, accountId, gatewayCode, onChange])

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 text-xs text-muted-foreground py-2'>
        <Loader2 className='h-3.5 w-3.5 animate-spin' /> Loading payment configuration…
      </div>
    )
  }

  // D17: a failed load must never masquerade as "not configured" — that
  // misdiagnosis is exactly what employee-role staff saw (403 on the old
  // admin-only endpoints surfaced as the empty-state message).
  if (isError) {
    return (
      <div
        role='alert'
        className='flex items-start gap-2 rounded-lg border border-red-300/70 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200'
      >
        <AlertTriangle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
        <span>Couldn't load payment gateways. Check your connection and try again — if this persists, ask an admin to confirm the gateway setup.</span>
      </div>
    )
  }

  if (gatewayOptions.length === 0) {
    return (
      <NotConfigured
        message='No payment gateway is enabled. Configure one in Settings → Payment Gateways.'
      />
    )
  }

  const gatewayLocked = disabled || gatewayOptions.length === 1
  const labelClass = compact ? 'text-xs font-medium' : 'text-sm font-medium'
  const triggerClass = compact ? 'h-9 text-xs' : 'h-9 text-sm'

  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label className={labelClass}>{gatewayLabel}</Label>
      <Select
        value={gatewayCode || undefined}
        onValueChange={(code) => {
          const picked = gatewayOptions.find((g) => g.code === code)
          const pickedAccount = picked?.account ?? undefined
          onChange({
            gatewayCode: code,
            accountId: pickedAccount ? picked!.accountId! : '',
          })
        }}
        disabled={gatewayLocked}
      >
        <SelectTrigger className={triggerClass} aria-label={gatewayLabel}>
          <SelectValue placeholder='Select gateway' />
        </SelectTrigger>
        <SelectContent>
          {gatewayOptions.map((g) => (
            <SelectItem key={g.code} value={g.code}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {gatewayOptions.length === 1 && (
        <p className='text-[11px] text-muted-foreground'>
          Only configured gateway — auto-selected.
        </p>
      )}
      {selectedGateway && mappedAccount ? (
        <p className='text-[11px] text-muted-foreground'>
          Settles to {mappedAccount.name} ({mappedAccount.code})
          {selectedGateway.phoneNumber ? ` — ${selectedGateway.phoneNumber}` : ''}.
        </p>
      ) : selectedGateway && brokenMapping ? (
        <p className='text-[11px] text-amber-600 dark:text-amber-500'>
          The settlement account mapped to this gateway is inactive or missing — this payment will be recorded without an accounting entry. Fix the mapping in Settings → Payment Gateways.
        </p>
      ) : selectedGateway ? (
        <p className='text-[11px] text-amber-600 dark:text-amber-500'>
          No settlement account is mapped to this gateway — this payment will be recorded without an accounting entry. Map an account in Settings → Payment Gateways.
        </p>
      ) : null}
    </div>
  )
}

export function NotConfigured({ message }: { message: string }) {
  return (
    <div
      role='alert'
      className='flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
    >
      <AlertTriangle className='h-3.5 w-3.5 mt-0.5 shrink-0' />
      <span>{message}</span>
    </div>
  )
}
