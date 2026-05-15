import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { gatewayApi, type GatewayConfig } from './api'
import { PaymentLogo } from '@/components/payment-logo'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, ChevronDown, ChevronUp, Phone, Truck } from 'lucide-react'

const gatewayLabels: Record<string, string> = { bkash: 'bKash (Manual)', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay', cellfin: 'Cellfin/Selfin', bkash_pgw: 'bKash PGW', cod: 'Cash on Delivery' }
const isManual = (g: string) => ['bkash', 'nagad', 'rocket', 'upay', 'cellfin'].includes(g)
const isPgw = (g: string) => g === 'bkash_pgw'
const isCod = (g: string) => g === 'cod'

export function GatewaySettings() {
  const queryClient = useQueryClient()
  const { data: gateways, isLoading } = useQuery({ queryKey: ['gateways'], queryFn: () => gatewayApi.list().then(r => r.data) })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editData, setEditData] = useState<Record<string, any>>({})

  const updateMut = useMutation({
    mutationFn: ({ gateway, data }: { gateway: string; data: any }) => gatewayApi.update(gateway, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['gateways'] }); toast.success('Saved') },
  })

  const initEdit = (g: GatewayConfig) => {
    setEditData(prev => ({ ...prev, [g.gateway]: {
      enabled: g.enabled, mode: g.mode || 'personal', phoneNumber: g.phoneNumber || '',
      credentials: JSON.stringify(g.credentials || {}, null, 2),
    }}))
  }

  const handleSave = (gateway: string) => updateMut.mutate({ gateway, data: { ...editData[gateway], credentials: (() => { try { return JSON.parse(editData[gateway]?.credentials || '{}') } catch { return {} } })() } })

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  const manualGateways = (gateways || []).filter(g => isManual(g.gateway))
  const pgwGateways = (gateways || []).filter(g => isPgw(g.gateway))
  const codGateway = (gateways || []).find(g => isCod(g.gateway))

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div><h2 className='text-2xl font-bold tracking-tight'>Payment Gateways</h2><p className='text-muted-foreground'>Configure payment methods for your store.</p></div>

        {/* COD */}
        {codGateway && (
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-3'>
              <div className='flex items-center gap-3'>
                <div className='bg-green-100 dark:bg-green-900/30 p-2 rounded-lg'><Truck className='h-5 w-5 text-green-700 dark:text-green-400' /></div>
                <div><CardTitle className='text-base'>Cash on Delivery</CardTitle><p className='text-xs text-muted-foreground'>Payment collected at time of delivery</p></div>
              </div>
              <div className='flex items-center gap-2'>
                <Switch checked={codGateway.enabled} onCheckedChange={(v) => updateMut.mutate({ gateway: 'cod', data: { enabled: v } })} />
                <Badge className={codGateway.enabled ? 'bg-green-500' : ''}>{codGateway.enabled ? 'Active' : 'Disabled'}</Badge>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Manual Gateways */}
        <div><h3 className='text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3'>Manual Payment Methods</h3></div>
        {manualGateways.map(g => {
          const isOpen = expanded[g.gateway]
          const d = editData[g.gateway] || { enabled: g.enabled, mode: g.mode || 'personal', phoneNumber: g.phoneNumber || '', credentials: '{}' }
          return (
            <Card key={g.id}>
              <CardHeader className='pb-2 cursor-pointer flex flex-row items-center justify-between' onClick={() => { initEdit(g); setExpanded(prev => ({ ...prev, [g.gateway]: !prev[g.gateway] })) }}>
                <div className='flex items-center gap-3'>
                  <PaymentLogo method={g.gateway} size='md' showName={false} />
                  <div><CardTitle className='text-sm'>{gatewayLabels[g.gateway]}</CardTitle><p className='text-xs text-muted-foreground'>Manual verification required</p></div>
                </div>
                <div className='flex items-center gap-2'>
                  <Badge className={g.enabled ? 'bg-green-500' : ''}>{g.enabled ? 'Active' : 'Disabled'}</Badge>
                  {isOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className='space-y-3 pt-4 border-t' onClick={e => e.stopPropagation()}>
                  <div className='flex items-center gap-3'><Switch checked={d.enabled} onCheckedChange={(v) => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, enabled: v } }))} /><Label>{d.enabled ? 'Enabled' : 'Disabled'}</Label></div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div><Label>Account Type</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={d.mode} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, mode: e.target.value } }))}><option value='personal'>Personal</option><option value='agent'>Agent</option><option value='merchant'>Merchant</option></select></div>
                    <div><Label className='flex items-center gap-1'><Phone className='h-3 w-3' /> Phone</Label><Input value={d.phoneNumber} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, phoneNumber: e.target.value } }))} placeholder='01XXXXXXXXX' /></div>
                  </div>
                  <Button size='sm' onClick={() => handleSave(g.gateway)} disabled={updateMut.isPending}><Save className='h-4 w-4 mr-1' /> Save</Button>
                </CardContent>
              )}
            </Card>
          )
        })}

        {/* bKash PGW */}
        <div><h3 className='text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 mt-4'>Automatic Payment Gateway</h3></div>
        {pgwGateways.map(g => {
          const isOpen = expanded[g.gateway]
          const d = editData[g.gateway] || { enabled: g.enabled, mode: g.mode || 'merchant', phoneNumber: g.phoneNumber || '', credentials: JSON.stringify(g.credentials || {}, null, 2) }
          return (
            <Card key={g.id}>
              <CardHeader className='pb-2 cursor-pointer flex flex-row items-center justify-between' onClick={() => { initEdit(g); setExpanded(prev => ({ ...prev, [g.gateway]: !prev[g.gateway] })) }}>
                <div className='flex items-center gap-3'>
                  <PaymentLogo method={g.gateway} size='md' showName={false} />
                  <div><CardTitle className='text-sm'>bKash Payment Gateway</CardTitle><p className='text-xs text-muted-foreground'>Automatic payment processing via bKash API</p></div>
                </div>
                <div className='flex items-center gap-2'>
                  <Badge className={g.enabled ? 'bg-green-500' : ''}>{g.enabled ? 'Active' : 'Disabled'}</Badge>
                  {isOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className='space-y-3 pt-4 border-t' onClick={e => e.stopPropagation()}>
                  <div className='flex items-center gap-3'><Switch checked={d.enabled} onCheckedChange={(v) => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, enabled: v } }))} /><Label>{d.enabled ? 'Enabled' : 'Disabled'}</Label></div>
                  <div><Label>Environment</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={d.mode === 'production' ? 'production' : 'sandbox'} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, mode: e.target.value } }))}><option value='sandbox'>Sandbox (Test)</option><option value='production'>Production (Live)</option></select></div>
                  <div className='space-y-2'>
                    <Label>API Credentials</Label>
                    <div className='grid grid-cols-2 gap-2'>
                      <Input value={JSON.parse(d.credentials || '{}').appKey || ''} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: JSON.stringify({ ...JSON.parse(d.credentials || '{}'), appKey: e.target.value }, null, 2) } }))} placeholder='App Key' />
                      <Input type='password' value={JSON.parse(d.credentials || '{}').appSecret || ''} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: JSON.stringify({ ...JSON.parse(d.credentials || '{}'), appSecret: e.target.value }, null, 2) } }))} placeholder='App Secret' />
                      <Input value={JSON.parse(d.credentials || '{}').username || ''} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: JSON.stringify({ ...JSON.parse(d.credentials || '{}'), username: e.target.value }, null, 2) } }))} placeholder='Username' />
                      <Input type='password' value={JSON.parse(d.credentials || '{}').password || ''} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: JSON.stringify({ ...JSON.parse(d.credentials || '{}'), password: e.target.value }, null, 2) } }))} placeholder='Password' />
                    </div>
                    <textarea className='w-full min-h-[60px] rounded-md border px-3 py-2 text-xs bg-background font-mono' value={d.credentials} onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: e.target.value } }))} />
                  </div>
                  <Button size='sm' onClick={() => handleSave(g.gateway)} disabled={updateMut.isPending}><Save className='h-4 w-4 mr-1' /> Save</Button>
                </CardContent>
              )}
            </Card>
          )
        })}
      </Main>
    </>
  )
}
