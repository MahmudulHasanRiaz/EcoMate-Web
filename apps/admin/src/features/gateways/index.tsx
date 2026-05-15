import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { gatewayApi, type GatewayConfig } from './api'
import { PaymentLogo } from '@/components/payment-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save, ChevronDown, ChevronUp, Phone, Settings2, Info, CheckCircle2, Truck, ShieldCheck, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

const gatewayLabels: Record<string, string> = {
  bkash: 'bKash (Manual)', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay',
  cellfin: 'Cellfin/Selfin', bkash_pgw: 'bKash PGW', cod: 'Cash on Delivery',
}

const gatewayDescriptions: Record<string, string> = {
  bkash: 'Manual bKash payment with number verification.',
  nagad: 'Nagad manual payment gateway.',
  rocket: 'Rocket mobile banking integration.',
  bkash_pgw: 'Official bKash Payment Gateway (Tokenized API).',
  cod: 'Standard Cash on Delivery for physical goods.',
}

export function GatewaySettings() {
  const queryClient = useQueryClient()
  const { data: gateways, isLoading } = useQuery({
    queryKey: ['gateways'],
    queryFn: () => gatewayApi.list().then(r => r.data),
  })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editData, setEditData] = useState<Record<string, any>>({})

  const updateMut = useMutation({
    mutationFn: ({ gateway, data }: { gateway: string; data: any }) => gatewayApi.update(gateway, data),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['gateways'] })
      toast.success('Settings updated successfully') 
    },
  })

  const initEdit = (g: GatewayConfig) => {
    if (editData[g.gateway]) return
    setEditData(prev => ({
      ...prev,
      [g.gateway]: {
        enabled: g.enabled,
        mode: g.mode || (g.gateway === 'bkash_pgw' ? 'sandbox' : 'personal'),
        phoneNumber: g.phoneNumber || '',
        credentials: g.credentials || {},
      },
    }))
  }

  const handleToggleExpand = (g: GatewayConfig) => {
    initEdit(g)
    setExpanded(prev => ({ ...prev, [g.gateway]: !prev[g.gateway] }))
  }

  const handleSave = (gateway: string) => {
    const d = editData[gateway]
    if (!d) return
    updateMut.mutate({ gateway, data: { ...d, gateway } })
  }

  if (isLoading) return (
    <div className='flex items-center justify-center min-h-[400px]'>
      <Loader2 className='animate-spin h-8 w-8 text-primary' />
    </div>
  )

  const manualGateways = (gateways || []).filter(g => ['bkash', 'nagad', 'rocket', 'upay', 'cellfin'].includes(g.gateway))
  const pgwGateway = (gateways || []).find(g => g.gateway === 'bkash_pgw')
  const codGateway = (gateways || []).find(g => g.gateway === 'cod')

  return (
    <div className='space-y-8 w-full pb-12'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Payment Gateways</h2>
        <p className='text-muted-foreground'>
          Manage your store&apos;s checkout options, manual payments and automated APIs.
        </p>
      </div>
      <Separator className='my-6' />

      {/* Cash on Delivery Section */}
      {codGateway && (
        <Card className='border-none shadow-sm bg-muted/20'>
          <CardContent className='p-4 flex items-center justify-between'>
            <div className='flex items-center gap-4'>
              <div className='p-2 rounded-lg bg-background border shadow-sm'>
                <Truck className='h-5 w-5 text-primary' />
              </div>
              <div className='space-y-0.5'>
                <CardTitle className='text-base'>Cash on Delivery</CardTitle>
                <CardDescription className='text-xs'>Allow customers to pay when they receive the order.</CardDescription>
              </div>
            </div>
            <div className='flex items-center gap-3'>
              <Switch 
                checked={codGateway.enabled} 
                onCheckedChange={(v) => updateMut.mutate({ gateway: 'cod', data: { enabled: v, gateway: 'cod' } })} 
              />
              <span className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>
                {codGateway.enabled ? 'Active' : 'Inactive'}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Payments Section */}
      <div className='space-y-4'>
        <div className='flex items-center gap-2 px-1'>
          <ShieldCheck className='h-4 w-4 text-primary' />
          <h3 className='text-sm font-bold uppercase tracking-wider'>Manual Payment Methods</h3>
        </div>
        <div className='grid gap-4'>
          {manualGateways.map(g => {
            const isOpen = expanded[g.gateway]
            const d = editData[g.gateway] || { enabled: g.enabled, mode: g.mode || 'personal', phoneNumber: g.phoneNumber || '' }
            return (
              <Card key={g.id} className={cn('transition-all duration-200 border shadow-sm overflow-hidden', isOpen ? 'ring-1 ring-primary' : 'hover:border-muted-foreground/20')}>
                <div className='p-4 cursor-pointer flex items-center justify-between gap-4' onClick={() => handleToggleExpand(g)}>
                  <div className='flex items-center gap-4'>
                    <PaymentLogo method={g.gateway} size='md' showName={false} />
                    <div className='space-y-0.5'>
                      <CardTitle className='text-sm flex items-center gap-2'>
                        {gatewayLabels[g.gateway]}
                        {g.enabled && <CheckCircle2 className='h-3 w-3 text-green-500' />}
                      </CardTitle>
                      <CardDescription className='text-[11px]'>{gatewayDescriptions[g.gateway]}</CardDescription>
                    </div>
                  </div>
                  <div className='flex items-center gap-4'>
                    <Switch checked={d.enabled} onCheckedChange={(v) => { initEdit(g); setEditData(p => ({ ...p, [g.gateway]: { ...d, enabled: v } })) }} onClick={e => e.stopPropagation()} />
                    {isOpen ? <ChevronUp className='h-4 w-4 text-muted-foreground' /> : <ChevronDown className='h-4 w-4 text-muted-foreground' />}
                  </div>
                </div>
                {isOpen && (
                  <CardContent className='p-4 pt-0 border-t bg-muted/5 animate-in fade-in slide-in-from-top-1'>
                    <div className='pt-4 grid gap-4 sm:grid-cols-2'>
                      <div className='space-y-2'>
                        <Label className='text-xs font-semibold'>Account Type</Label>
                        <Select value={d.mode} onValueChange={v => setEditData(p => ({ ...p, [g.gateway]: { ...d, mode: v } }))}>
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
                        <Input className='h-9' value={d.phoneNumber} onChange={e => setEditData(p => ({ ...p, [g.gateway]: { ...d, phoneNumber: e.target.value } }))} placeholder='01XXXXXXXXX' />
                      </div>
                      <div className='sm:col-span-2 flex justify-end'>
                        <Button size='sm' onClick={() => handleSave(g.gateway)} disabled={updateMut.isPending}>
                          {updateMut.isPending ? <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' /> : <Save className='h-3.5 w-3.5 mr-2' />}
                          Save Configuration
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* bKash PGW Section */}
      {pgwGateway && (
        <div className='space-y-4 pt-2'>
          <div className='flex items-center gap-2 px-1'>
            <Zap className='h-4 w-4 text-primary' />
            <h3 className='text-sm font-bold uppercase tracking-wider'>Automatic Payment Gateway</h3>
          </div>
          <Card className={cn('transition-all duration-200 border shadow-sm overflow-hidden', expanded[pgwGateway.gateway] ? 'ring-1 ring-primary' : 'hover:border-muted-foreground/20')}>
            <div className='p-4 cursor-pointer flex items-center justify-between gap-4' onClick={() => handleToggleExpand(pgwGateway)}>
              <div className='flex items-center gap-4'>
                <div className='p-2 rounded-lg bg-background border shadow-sm shrink-0'>
                  <PaymentLogo method='bkash_pgw' size='md' showName={false} />
                </div>
                <div className='space-y-0.5'>
                  <CardTitle className='text-sm flex items-center gap-2'>
                    bKash Payment Gateway
                    {pgwGateway.enabled && <CheckCircle2 className='h-3 w-3 text-green-500' />}
                  </CardTitle>
                  <CardDescription className='text-[11px]'>Official Tokenized API for automated real-time payments.</CardDescription>
                </div>
              </div>
              <div className='flex items-center gap-4'>
                <Switch checked={editData[pgwGateway.gateway]?.enabled ?? pgwGateway.enabled} onCheckedChange={(v) => { initEdit(pgwGateway); setEditData(p => ({ ...p, [pgwGateway.gateway]: { ...p[pgwGateway.gateway], enabled: v } })) }} onClick={e => e.stopPropagation()} />
                {expanded[pgwGateway.gateway] ? <ChevronUp className='h-4 w-4 text-muted-foreground' /> : <ChevronDown className='h-4 w-4 text-muted-foreground' />}
              </div>
            </div>
            {expanded[pgwGateway.gateway] && (
              <CardContent className='p-4 pt-0 border-t bg-muted/5 animate-in fade-in slide-in-from-top-1'>
                <div className='pt-4 grid gap-6 md:grid-cols-12'>
                  <div className='md:col-span-7 space-y-4'>
                    <div className='space-y-2'>
                      <Label className='text-xs font-semibold'>API Environment</Label>
                      <Select value={editData[pgwGateway.gateway]?.mode || 'sandbox'} onValueChange={v => setEditData(p => ({ ...p, [pgwGateway.gateway]: { ...p[pgwGateway.gateway], mode: v } }))}>
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
                        <Input className='h-9' value={editData[pgwGateway.gateway]?.credentials?.appKey || ''} onChange={e => setEditData(p => ({ ...p, [pgwGateway.gateway]: { ...p[pgwGateway.gateway], credentials: { ...p[pgwGateway.gateway].credentials, appKey: e.target.value } } }))} placeholder='App Key' />
                      </div>
                      <div className='space-y-2'>
                        <Label className='text-xs font-semibold'>App Secret</Label>
                        <Input className='h-9' type='password' value={editData[pgwGateway.gateway]?.credentials?.appSecret || ''} onChange={e => setEditData(p => ({ ...p, [pgwGateway.gateway]: { ...p[pgwGateway.gateway], credentials: { ...p[pgwGateway.gateway].credentials, appSecret: e.target.value } } }))} placeholder='App Secret' />
                      </div>
                      <div className='space-y-2'>
                        <Label className='text-xs font-semibold'>API Username</Label>
                        <Input className='h-9' value={editData[pgwGateway.gateway]?.credentials?.username || ''} onChange={e => setEditData(p => ({ ...p, [pgwGateway.gateway]: { ...p[pgwGateway.gateway], credentials: { ...p[pgwGateway.gateway].credentials, username: e.target.value } } }))} placeholder='Username' />
                      </div>
                      <div className='space-y-2'>
                        <Label className='text-xs font-semibold'>API Password</Label>
                        <Input className='h-9' type='password' value={editData[pgwGateway.gateway]?.credentials?.password || ''} onChange={e => setEditData(p => ({ ...p, [pgwGateway.gateway]: { ...p[pgwGateway.gateway], credentials: { ...p[pgwGateway.gateway].credentials, password: e.target.value } } }))} placeholder='Password' />
                      </div>
                    </div>
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
                      <Button size='sm' className='w-full' onClick={() => handleSave(pgwGateway.gateway)} disabled={updateMut.isPending}>
                        {updateMut.isPending ? <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' /> : <Save className='h-3.5 w-3.5 mr-2' />}
                        Save API Settings
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
