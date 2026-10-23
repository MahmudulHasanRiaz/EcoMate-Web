import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { accountingApi, type AccountResponse } from '@/features/accounting/api'
import { gatewayApi } from '@/features/gateways/api'
import { adminSelectableGatewayOptions, enabledGatewayOptions, flattenEligibleAssetAccounts } from '@/features/payments/lib/eligible-accounts'

/**
 * Part 3 (owner-locked): ONE shared gateway + account pair for every staff
 * money form. Config is selected, never typed. Free text remains only for
 * genuinely external values (transaction ID, note/reason).
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
  /** Optional labels; default to the canonical "Gateway" / "Account". */
  gatewayLabel?: string
  accountLabel?: string
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
  accountLabel = 'Account',
  compact = false,
  className,
}: PaymentGatewayAccountSelectProps) {
  const { data: gateways, isLoading: gatewaysLoading } = useQuery({
    queryKey: ['admin-gateways'],
    queryFn: () => gatewayApi.listGateways().then((r) => r.data),
    staleTime: 60_000,
  })
  const { data: accountTree, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts-tree'],
    queryFn: () => accountingApi.getAccountTree().then((r) => r.data),
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
  const accounts = useMemo(() => flattenEligibleAssetAccounts(accountTree), [accountTree])
  const selectedGateway = gatewayOptions.find((g) => g.code === gatewayCode)
  const mappedAccountId = selectedGateway?.accountId ?? null
  const mappedAccount = mappedAccountId ? accounts.find((a) => a.id === mappedAccountId) : undefined
  // A mapping can go stale when the account is deactivated after being saved.
  // Treat it as unmapped (with an explicit warning) instead of rendering an
  // empty locked select that can only fail on save.
  const brokenMapping = !!mappedAccountId && !mappedAccount

  const isLoading = gatewaysLoading || accountsLoading

  // Rule 2: exactly one option is auto-selected. This runs for both the
  // gateway list and (below) the derived account list; it only fills a blank
  // or invalid value, so an explicit user choice at 2+ is never overwritten.
  useEffect(() => {
    if (isLoading || disabled) return
    if (gatewayOptions.length === 0) return
    if (gatewayCode && gatewayOptions.some((g) => g.code === gatewayCode)) return
    const only = gatewayOptions.length === 1 ? gatewayOptions[0] : undefined
    if (!only) return
    const nextAccount = only.accountId
      ?? (accounts.length === 1 ? accounts[0].id : '')
    onChange({ gatewayCode: only.code, accountId: nextAccount })
  }, [isLoading, disabled, gatewayOptions, gatewayCode, accounts, onChange])

  useEffect(() => {
    if (isLoading || disabled || !selectedGateway) return
    if (mappedAccountId && mappedAccount) {
      if (accountId !== mappedAccountId) {
        onChange({ gatewayCode, accountId: mappedAccountId })
      }
      return
    }
    if (accounts.length === 0) return
    const valid = accountId && accounts.some((a) => a.id === accountId)
    if (valid) return
    if (accounts.length === 1) {
      onChange({ gatewayCode, accountId: accounts[0].id })
    } else if (accountId) {
      onChange({ gatewayCode, accountId: '' })
    }
  }, [isLoading, disabled, selectedGateway, mappedAccountId, mappedAccount, accounts, accountId, gatewayCode, onChange])

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 text-xs text-muted-foreground py-2'>
        <Loader2 className='h-3.5 w-3.5 animate-spin' /> Loading payment configuration…
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

  if (accounts.length === 0) {
    return (
      <NotConfigured
        message='No eligible money account exists. Create an active asset leaf in Accounting → Chart of Accounts.'
      />
    )
  }

  const accountOptions = mappedAccount
    ? accounts.filter((a) => a.id === mappedAccountId)
    : accounts
  const gatewayLocked = disabled || gatewayOptions.length === 1
  const accountLocked = disabled || !!mappedAccount || accountOptions.length === 1
  const labelClass = compact ? 'text-xs font-medium' : 'text-sm font-medium'
  const triggerClass = compact ? 'h-9 text-xs' : 'h-9 text-sm'

  return (
    <div className={className ?? 'grid gap-3 sm:grid-cols-2'}>
      <div className='space-y-1.5'>
        <Label className={labelClass}>{gatewayLabel}</Label>
        <Select
          value={gatewayCode || undefined}
          onValueChange={(code) => {
            const picked = gatewayOptions.find((g) => g.code === code)
            onChange({
              gatewayCode: code,
              accountId: picked?.accountId
                ?? (accounts.length === 1 ? accounts[0].id : ''),
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
      </div>

      <div className='space-y-1.5'>
        <Label className={labelClass}>{accountLabel}</Label>
        <Select
          value={accountId || undefined}
          onValueChange={(id) => onChange({ gatewayCode, accountId: id })}
          disabled={accountLocked}
        >
          <SelectTrigger className={triggerClass} aria-label={accountLabel}>
            <SelectValue placeholder='Select account' />
          </SelectTrigger>
          <SelectContent>
            {accountOptions.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {mappedAccount && selectedGateway?.phoneNumber
                  ? `${formatAccountLabel(a)} — ${selectedGateway.phoneNumber}`
                  : formatAccountLabel(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mappedAccount ? (
          <p className='text-[11px] text-muted-foreground'>
            Default settlement account for this gateway — auto-selected.
          </p>
        ) : brokenMapping ? (
          <p className='text-[11px] text-amber-600 dark:text-amber-500'>
            Mapped settlement account is inactive or missing — choose another account and update Settings → Payment Gateways.
          </p>
        ) : selectedGateway ? (
          <p className='text-[11px] text-amber-600 dark:text-amber-500'>
            No default account set for this gateway — set it in Settings → Payment Gateways.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function formatAccountLabel(a: AccountResponse): string {
  return `${a.name} (${a.code})`
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
