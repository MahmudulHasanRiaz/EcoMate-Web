import { useId, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { gatewayApi, type GatewayConfig, type PaymentSettingKey } from './api'
import { PaymentLogo } from '@/components/payment-logo'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save, ChevronDown, ChevronUp, Phone, Settings2, Info, CheckCircle2, Truck, ShieldCheck, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { accountingApi } from '@/features/accounting/api'
import { flattenEligibleAssetAccounts } from '@/features/payments/lib/eligible-accounts'

/**
 * D (owner-locked): Global payment defaults. These are the S1/S2 values every
 * gateway follows unless it sets its own override (per-gateway tri-state lives
 * inside each manual gateway card). Persisted as the `payments.staffAutoVerified`
 * / `payments.editAllowed` SystemSetting keys (seeded; code defaults match when
 * absent) — unchanged storage, only the placement was fixed: this section now
 * lives BELOW the gateway list instead of masquerading as per-gateway state.
 */
function GlobalPaymentDefaults() {
  const uid = useId()
  const queryClient = useQueryClient()
  const { data: effective, isLoading } = useQuery({
    queryKey: ['payment-effective-settings'],
    queryFn: () => gatewayApi.getEffectivePaymentSettings(),
  })
  const role = useAuthStore((s) => s.auth.user?.role)

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: PaymentSettingKey; value: boolean }) =>
      gatewayApi.setPaymentSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-effective-settings'] })
    },
    onError: () => {
      toast.error('Failed to update payment setting')
    },
  })

  const staffAuto = effective?.global.staffAutoVerified ?? true
  const editAllowed = effective?.global.editAllowed ?? false
  // Refunds are NOT admin-only by default (owner decision, 2026-10-21): staff
  // may process refunds unless an admin switches this off. Only admins may
  // change it — the backend refuses any `payments.*` write from a non-admin.
  const staffRefunds = effective?.global.staffRefundsAllowed ?? true
  const isAdmin = (role ?? '').toLowerCase() === 'admin' || (role ?? '').toLowerCase() === 'superadmin'
  const busy = isLoading || setMut.isPending

  return (
    <Card className='shadow-sm'>
      <CardContent className='p-4 space-y-4'>
        <CardDescription className='text-xs'>
          These defaults apply to every gateway. Expand a manual gateway to override them for that gateway only.
        </CardDescription>
        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`${uid}-s1`} className='text-xs font-semibold'>Staff manual payments auto-verified</Label>
          <Switch
            id={`${uid}-s1`}
            checked={staffAuto}
            disabled={busy}
            onCheckedChange={(v) => setMut.mutate({ key: 'payments.staffAutoVerified', value: v })}
          />
        </div>
        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`${uid}-s3`} className='text-xs font-semibold'>
            Staff can process refunds
            {!isAdmin ? <span className='ml-1 font-normal text-muted-foreground'>(admin only)</span> : null}
          </Label>
          <Switch
            id={`${uid}-s3`}
            checked={staffRefunds}
            disabled={busy || !isAdmin}
            onCheckedChange={(v) => setMut.mutate({ key: 'payments.staffRefundsAllowed', value: v })}
          />
        </div>
        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor={`${uid}-s2`} className='text-xs font-semibold'>Staff may edit recorded payments</Label>
          <Switch
            id={`${uid}-s2`}
            checked={editAllowed}
            disabled={busy}
            onCheckedChange={(v) => setMut.mutate({ key: 'payments.editAllowed', value: v })}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * D (owner-locked): per-gateway tri-state override row. Value null = "use
 * global default"; true/false = explicit override. The hint shows the value
 * that WILL be enforced — the pending selection when an override is chosen,
 * otherwise the server-resolved effective value — and where it came from, so
 * staff can see exactly what the backend will enforce before saving.
 */
function GatewayOverrideRow({
  label,
  value,
  effective,
  onChange,
}: {
  label: string
  value: boolean | null
  effective: boolean
  onChange: (v: boolean | null) => void
}) {
  const selected = value === null ? 'global' : value ? 'on' : 'off'
  return (
    <div className='flex items-center justify-between gap-4'>
      <div className='space-y-0.5'>
        <Label className='text-xs font-semibold'>{label}</Label>
        <p className='text-[11px] text-muted-foreground'>
          Effective: <b>{effective ? 'On' : 'Off'}</b>
          {value === null ? ' — from global default' : ' — set on this gateway'}
        </p>
      </div>
      <Select
        value={selected}
        onValueChange={(v) => onChange(v === 'global' ? null : v === 'on')}
      >
        <SelectTrigger className='h-8 w-44 text-xs' aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='global'>Use global default</SelectItem>
          <SelectItem value='on'>On</SelectItem>
          <SelectItem value='off'>Off</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function GatewaySettings() {
  const queryClient = useQueryClient()
  const { data: optionsData, isLoading } = useQuery({
    queryKey: ['payment-options'],
    queryFn: () => gatewayApi.listOptions().then(r => r.data),
  })

  // D: effective settings (global + per-gateway) — used for the tri-state
  // hints inside manual gateway cards. Single source with the backend gate.
  const { data: effectiveSettings } = useQuery({
    queryKey: ['payment-effective-settings'],
    queryFn: () => gatewayApi.getEffectivePaymentSettings(),
  })
  const { data: accountTree } = useQuery({
    queryKey: ['accounts-tree'],
    queryFn: () => accountingApi.getAccountTree().then((r) => r.data),
    staleTime: 60_000,
  })
  const assetAccounts = useMemo(
    () => flattenEligibleAssetAccounts(accountTree),
    [accountTree],
  )
  const effectiveFor = (code: string) =>
    effectiveSettings?.gateways.find((g) => g.code === code)?.effective
  const globalDefaults = effectiveSettings?.global

  const [expandedGateways, setExpandedGateways] = useState<Record<string, boolean>>({})
  const [gatewayEditData, setGatewayEditData] = useState<Record<string, any>>({})

  const updateOptionMut = useMutation({
    mutationFn: ({ type, data }: { type: string; data: { enabled?: boolean } }) =>
      gatewayApi.updateOption(type, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-options'] })
      toast.success('Payment option updated successfully')
    },
  })

  const updateGatewayMut = useMutation({
    mutationFn: ({ code, data }: { code: string; data: any }) =>
      gatewayApi.updateGateway(code, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-options'] })
      queryClient.invalidateQueries({ queryKey: ['admin-gateways'] })
      queryClient.invalidateQueries({ queryKey: ['payment-effective-settings'] })
      toast.success('Gateway settings updated successfully')
    },
  })

  const initGatewayEdit = (g: GatewayConfig) => {
    if (gatewayEditData[g.code]) return
    setGatewayEditData(prev => ({
      ...prev,
      [g.code]: {
        name: g.name,
        type: g.type,
        paymentOptionType: g.paymentOptionType,
        sortOrder: g.sortOrder,
        enabled: g.enabled,
        mode: g.mode || (g.type === 'api' ? 'sandbox' : 'personal'),
        phoneNumber: g.phoneNumber || '',
        credentials: g.credentials || {},
        accountId: g.accountId ?? null,
        staffAutoVerifiedOverride: g.staffAutoVerifiedOverride ?? null,
        editAllowedOverride: g.editAllowedOverride ?? null,
      },
    }))
  }

  const handleToggleExpand = (g: GatewayConfig) => {
    initGatewayEdit(g)
    setExpandedGateways(prev => ({ ...prev, [g.code]: !prev[g.code] }))
  }

  const handleGatewaySave = (code: string) => {
    const d = gatewayEditData[code]
    if (!d) return
    updateGatewayMut.mutate({ code, data: d })
  }

  const settlementAccountField = (g: GatewayConfig, d: any, compact = false) => (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <Label className='text-xs font-semibold'>Settlement account</Label>
      <Select
        value={d.accountId ?? 'none'}
        onValueChange={(v) =>
          setGatewayEditData((p) => ({
            ...p,
            [g.code]: { ...d, accountId: v === 'none' ? null : v },
          }))
        }
      >
        <SelectTrigger className='h-9 text-xs' aria-label={`${g.name} settlement account`}>
          <SelectValue placeholder='Not set' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='none'>Not set</SelectItem>
          {assetAccounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name} ({a.code})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {assetAccounts.length === 0 ? (
        <p className='text-[11px] text-amber-600 dark:text-amber-500'>
          No eligible accounts. Create an active asset leaf in Accounting → Chart of Accounts.
        </p>
      ) : (
        <p className='text-[11px] text-muted-foreground'>
          Payments on this gateway are stamped with this account. Leave “Not set” to show the warning badge.
        </p>
      )}
    </div>
  )

  const noSettlementBadge = (g: GatewayConfig) =>
    g.accountId ? null : (
      <Badge variant='warning' className='text-[10px] font-medium'>
        No settlement account
      </Badge>
    )

  if (isLoading) return (
    <div className='flex items-center justify-center min-h-[400px]'>
      <Loader2 className='animate-spin h-8 w-8 text-primary' />
    </div>
  )

  const optionIcons: Record<string, any> = {
    FULL_PAYMENT: ShieldCheck,
    PARTIAL_PAYMENT: Zap,
    CASH_ON_DELIVERY: Truck,
  }

  return (
    <div className='space-y-8 w-full pb-12'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Payment Gateways</h2>
        <p className='text-muted-foreground'>
          Manage your store&apos;s payment options and gateway configurations.
        </p>
      </div>
      <Separator className='my-6' />

      {/* SECTION A: Payment Options */}
      <div className='space-y-4'>
        <div className='flex items-center gap-2 px-1'>
          <Settings2 className='h-4 w-4 text-primary' />
          <h3 className='text-sm font-bold uppercase tracking-wider'>Payment Options</h3>
        </div>
        <div className='grid gap-4 md:grid-cols-3'>
          {(optionsData || []).sort((a, b) => a.sortOrder - b.sortOrder).map(option => {
            const Icon = optionIcons[option.type] || ShieldCheck
            const isCod = option.type === 'CASH_ON_DELIVERY'
            return (
              <Card key={option.id} className={cn(isCod ? 'border-none shadow-sm bg-muted/20' : 'shadow-sm')}>
                <CardContent className='p-4 flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-4'>
                    <div className={cn('p-2 rounded-lg border shadow-sm shrink-0', isCod ? 'bg-background' : 'bg-primary/5')}>
                      <Icon className='h-5 w-5 text-primary' />
                    </div>
                    <div className='space-y-0.5'>
                      <CardTitle className='text-sm'>{option.name}</CardTitle>
                      {option.description && (
                        <CardDescription className='text-xs'>{option.description}</CardDescription>
                      )}
                    </div>
                  </div>
                  <div className='flex items-center gap-3 shrink-0'>
                    <Switch
                      checked={option.enabled}
                      onCheckedChange={(v) => updateOptionMut.mutate({ type: option.type, data: { enabled: v } })}
                    />
                    <span className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>
                      {option.enabled ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* SECTION B: Payment Gateways */}
      {(optionsData || []).filter(o => o.gateways?.length).map(option => {
        const GroupIcon = optionIcons[option.type] || ShieldCheck
        return (
          <div key={option.type} className='space-y-4 pt-2'>
            <div className='flex items-center gap-2 px-1'>
              <GroupIcon className='h-4 w-4 text-primary' />
              <h3 className='text-sm font-bold uppercase tracking-wider'>{option.name} Gateways</h3>
            </div>
            <div className='grid gap-4'>
              {[...option.gateways].sort((a, b) => a.sortOrder - b.sortOrder).map(g => {
                const isCashType = g.type === 'cash'
                const isOpen = expandedGateways[g.code]
                const d = gatewayEditData[g.code] || {
                  name: g.name,
                  type: g.type,
                  paymentOptionType: g.paymentOptionType,
                  sortOrder: g.sortOrder,
                  enabled: g.enabled,
                  mode: g.mode || 'personal',
                  phoneNumber: g.phoneNumber || '',
                  credentials: g.credentials || {},
                  accountId: g.accountId ?? null,
                  staffAutoVerifiedOverride: g.staffAutoVerifiedOverride ?? null,
                  editAllowedOverride: g.editAllowedOverride ?? null,
                }

                if (isCashType) {
                  return (
                    <Card key={g.id} className='border-none shadow-sm bg-muted/20'>
                      <CardContent className='p-4 space-y-3'>
                        <div className='flex items-center justify-between'>
                          <div className='flex items-center gap-4'>
                            <div className='p-2 rounded-lg bg-background border shadow-sm'>
                              <Truck className='h-5 w-5 text-primary' />
                            </div>
                            <div className='space-y-0.5'>
                              <CardTitle className='text-base flex items-center gap-2'>
                                {g.name}
                                {noSettlementBadge(g)}
                              </CardTitle>
                              <CardDescription className='text-xs'>Allow customers to pay when they receive the order.</CardDescription>
                            </div>
                          </div>
                          <div className='flex items-center gap-3'>
                            <Switch
                              checked={g.enabled}
                              onCheckedChange={(v) => updateGatewayMut.mutate({ code: g.code, data: { enabled: v } })}
                            />
                            <span className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>
                              {g.enabled ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                        <div className='flex items-end gap-2 border-t pt-3'>
                          <div className='flex-1'>{settlementAccountField(g, d, true)}</div>
                          <Button
                            size='sm'
                            onClick={() => updateGatewayMut.mutate({ code: g.code, data: d })}
                            disabled={updateGatewayMut.isPending}
                          >
                            {updateGatewayMut.isPending ? <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' /> : <Save className='h-3.5 w-3.5 mr-2' />}
                            Save
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                }

                return (
                  <Card key={g.id} className={cn('transition-all duration-200 border shadow-sm overflow-hidden', isOpen ? 'ring-1 ring-primary' : 'hover:border-muted-foreground/20')}>
                    <div className='p-4 cursor-pointer flex items-center justify-between gap-4' onClick={() => handleToggleExpand(g)}>
                      <div className='flex items-center gap-4'>
                        <PaymentLogo method={g.code} size='md' showName={false} />
                        <div className='space-y-0.5'>
                          <CardTitle className='text-sm flex items-center gap-2'>
                            {g.name}
                            {g.enabled && <CheckCircle2 className='h-3 w-3 text-green-500' />}
                            {noSettlementBadge(g)}
                          </CardTitle>
                          <CardDescription className='text-[11px]'>{g.type === 'api' ? 'Automatic payment via API' : 'Manual payment with number verification'}</CardDescription>
                        </div>
                      </div>
                      <div className='flex items-center gap-4'>
                        <Switch 
                          checked={d.enabled} 
                          onCheckedChange={(v) => { 
                            initGatewayEdit(g); 
                            const currentMode = d.mode || g.mode || (g.type === 'api' ? 'sandbox' : 'personal');
                            const currentPhone = d.phoneNumber || g.phoneNumber || '';
                            const currentCreds = d.credentials || g.credentials || {};
                            
                            const updated = { 
                              enabled: v, 
                              mode: currentMode,
                              phoneNumber: currentPhone,
                              credentials: currentCreds,
                              accountId: d.accountId ?? g.accountId ?? null,
                              staffAutoVerifiedOverride: d.staffAutoVerifiedOverride ?? null,
                              editAllowedOverride: d.editAllowedOverride ?? null,
                            };
                            setGatewayEditData(p => ({ ...p, [g.code]: updated }));
                            
                            updateGatewayMut.mutate({ 
                              code: g.code, 
                              data: {
                                name: g.name,
                                type: g.type,
                                paymentOptionType: g.paymentOptionType,
                                enabled: v,
                                mode: currentMode,
                                phoneNumber: currentPhone,
                                credentials: currentCreds,
                                accountId: d.accountId ?? g.accountId ?? null,
                                sortOrder: g.sortOrder,
                                staffAutoVerifiedOverride: d.staffAutoVerifiedOverride ?? null,
                                editAllowedOverride: d.editAllowedOverride ?? null,
                              } 
                            });
                          }} 
                          onClick={e => e.stopPropagation()} 
                        />
                        {isOpen ? <ChevronUp className='h-4 w-4 text-muted-foreground' /> : <ChevronDown className='h-4 w-4 text-muted-foreground' />}
                      </div>
                    </div>
                    {isOpen && (
                      <CardContent className='p-4 pt-0 border-t bg-muted/5 animate-in fade-in slide-in-from-top-1'>
                        {g.type === 'api' ? (
                          <div className='pt-4 grid gap-6 md:grid-cols-12'>
                            <div className='md:col-span-7 space-y-4'>
                              <div className='space-y-2'>
                                <Label className='text-xs font-semibold'>API Environment</Label>
                                <Select value={d.mode || 'sandbox'} onValueChange={v => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, mode: v } }))}>
                                  <SelectTrigger className='h-9'><SelectValue placeholder='Select' /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value='sandbox'>Sandbox (Testing Mode)</SelectItem>
                                    <SelectItem value='production'>Production (Live Mode)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className='grid gap-4 sm:grid-cols-2'>
                                <div className='space-y-2'>
                                  <Label className='text-xs font-semibold'>App Key</Label>
                                  <Input className='h-9' value={d.credentials?.appKey || ''} onChange={e => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, credentials: { ...d.credentials, appKey: e.target.value } } }))} placeholder='App Key' />
                                </div>
                                <div className='space-y-2'>
                                  <Label className='text-xs font-semibold'>App Secret</Label>
                                  <Input className='h-9' type='password' value={d.credentials?.appSecret || ''} onChange={e => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, credentials: { ...d.credentials, appSecret: e.target.value } } }))} placeholder='App Secret' />
                                </div>
                                <div className='space-y-2'>
                                  <Label className='text-xs font-semibold'>API Username</Label>
                                  <Input className='h-9' value={d.credentials?.username || ''} onChange={e => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, credentials: { ...d.credentials, username: e.target.value } } }))} placeholder='Username' />
                                </div>
                                <div className='space-y-2'>
                                  <Label className='text-xs font-semibold'>API Password</Label>
                                  <Input className='h-9' type='password' value={d.credentials?.password || ''} onChange={e => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, credentials: { ...d.credentials, password: e.target.value } } }))} placeholder='Password' />
                                </div>
                              </div>
                              {settlementAccountField(g, d)}
                            </div>
                            <div className='md:col-span-5 space-y-4'>
                              <div className='rounded-lg bg-background border p-4 space-y-3'>
                                <div className='flex items-center gap-2 font-semibold text-xs text-primary'>
                                  <Settings2 className='h-3.5 w-3.5' />
                                  <span>Integration Guide</span>
                                </div>
                                <ul className='text-[10px] space-y-2 text-muted-foreground'>
                                  <li className='flex gap-2'><Info className='h-3 w-3 shrink-0 mt-0.5' /> Use <b>Sandbox</b> credentials for local testing.</li>
                                  <li className='flex gap-2'><Info className='h-3 w-3 shrink-0 mt-0.5' /> <b>Production</b> credentials require official approval.</li>
                                  <li className='flex gap-2'><Info className='h-3 w-3 shrink-0 mt-0.5' /> Check official <a href='https://developer.bka.sh/' target='_blank' className='text-primary hover:underline'>bKash Documentation</a> for keys.</li>
                                </ul>
                                <Separator className='my-2' />
                                <Button size='sm' className='w-full' onClick={() => handleGatewaySave(g.code)} disabled={updateGatewayMut.isPending}>
                                  {updateGatewayMut.isPending ? <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' /> : <Save className='h-3.5 w-3.5 mr-2' />}
                                  Save API Settings
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className='pt-4 grid gap-4 sm:grid-cols-2'>
                            <div className='space-y-2'>
                              <Label className='text-xs font-semibold'>Account Type</Label>
                              <Select value={d.mode || 'personal'} onValueChange={v => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, mode: v } }))}>
                                <SelectTrigger className='h-9'><SelectValue placeholder='Select' /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='personal'>Personal</SelectItem>
                                  <SelectItem value='agent'>Agent</SelectItem>
                                  <SelectItem value='merchant'>Merchant</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className='space-y-2'>
                              <Label className='text-xs font-semibold flex items-center gap-1.5'><Phone className='h-3 w-3' /> Phone Number</Label>
                              <Input className='h-9' value={d.phoneNumber || ''} onChange={e => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, phoneNumber: e.target.value } }))} placeholder='01XXXXXXXXX' />
                            </div>
                            <div className='sm:col-span-2'>
                              {settlementAccountField(g, d)}
                            </div>
                            {g.type === 'manual' && (
                              <div className='sm:col-span-2 space-y-3 rounded-lg border bg-background p-3'>
                                <p className='text-[11px] text-muted-foreground'>
                                  Per-gateway overrides — leave on “Use global default” to follow the Global Payment Defaults below the gateway list.
                                </p>
                                <GatewayOverrideRow
                                  label='Staff manual payments auto-verified'
                                  value={d.staffAutoVerifiedOverride ?? null}
                                  effective={d.staffAutoVerifiedOverride ?? effectiveFor(g.code)?.staffAutoVerified ?? globalDefaults?.staffAutoVerified ?? true}
                                  onChange={(v) => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, staffAutoVerifiedOverride: v } }))}
                                />
                                <GatewayOverrideRow
                                  label='Staff may edit recorded payments'
                                  value={d.editAllowedOverride ?? null}
                                  effective={d.editAllowedOverride ?? effectiveFor(g.code)?.editAllowed ?? globalDefaults?.editAllowed ?? false}
                                  onChange={(v) => setGatewayEditData(p => ({ ...p, [g.code]: { ...d, editAllowedOverride: v } }))}
                                />
                              </div>
                            )}
                            <div className='sm:col-span-2 flex justify-end'>
                              <Button size='sm' onClick={() => handleGatewaySave(g.code)} disabled={updateGatewayMut.isPending}>
                                {updateGatewayMut.isPending ? <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' /> : <Save className='h-3.5 w-3.5 mr-2' />}
                                Save Configuration
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* SECTION C: Global Payment Defaults — deliberately BELOW the gateway
          list (D, owner-locked): they are store-wide fallbacks, not gateway
          state. Each manual gateway can override them individually. */}
      <div className='space-y-4 pt-2'>
        <div className='flex items-center gap-2 px-1'>
          <ShieldCheck className='h-4 w-4 text-primary' />
          <h3 className='text-sm font-bold uppercase tracking-wider'>Global Payment Defaults</h3>
        </div>
        <GlobalPaymentDefaults />
      </div>
    </div>
  )
}
