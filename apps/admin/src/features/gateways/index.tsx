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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, ChevronDown, ChevronUp, Phone } from 'lucide-react'

const gatewayLabels: Record<string, string> = {
  bkash: 'bKash (Manual)', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay',
  cellfin: 'Cellfin/Selfin', bkash_pgw: 'bKash PGW', cod: 'Cash on Delivery',
}

export function GatewaySettings() {
  const queryClient = useQueryClient()
  const { data: gateways, isLoading } = useQuery({
    queryKey: ['gateways'],
    queryFn: () => gatewayApi.list().then(r => r.data),
  })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editData, setEditData] = useState<Record<string, { enabled: boolean; mode: string; phoneNumber: string; credentials: string }>>({})

  const updateMut = useMutation({
    mutationFn: ({ gateway, data }: { gateway: string; data: any }) => gatewayApi.update(gateway, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['gateways'] }); toast.success('Gateway updated') },
  })

  const initEdit = (g: GatewayConfig) => {
    setEditData(prev => ({
      ...prev,
      [g.gateway]: {
        enabled: g.enabled,
        mode: g.mode || 'personal',
        phoneNumber: g.phoneNumber || '',
        credentials: JSON.stringify(g.credentials || {}, null, 2),
      },
    }))
  }

  const handleSave = (gateway: string) => {
    const d = editData[gateway]
    if (!d) return
    updateMut.mutate({
      gateway,
      data: {
        gateway,
        enabled: d.enabled,
        mode: d.mode,
        phoneNumber: d.phoneNumber || null,
        credentials: (() => { try { return JSON.parse(d.credentials) } catch { return {} } })(),
      },
    })
  }

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Payment Gateways</h2>
          <p className='text-muted-foreground'>Enable, disable, and configure payment gateways.</p>
        </div>

        <div className='space-y-4'>
          {(gateways || []).map(g => {
            const isOpen = expanded[g.gateway]
            const d = editData[g.gateway] || { enabled: g.enabled, mode: g.mode || 'personal', phoneNumber: g.phoneNumber || '', credentials: JSON.stringify(g.credentials || {}, null, 2) }

            return (
              <Card key={g.id}>
                <CardHeader
                  className='pb-2 cursor-pointer flex flex-row items-center justify-between'
                  onClick={() => { initEdit(g); setExpanded(prev => ({ ...prev, [g.gateway]: !prev[g.gateway] })) }}
                >
                  <div className='flex items-center gap-3'>
                    <PaymentLogo method={g.gateway} size='sm' showName={false} />
                    <div>
                      <CardTitle className='text-sm'>{gatewayLabels[g.gateway] || g.gateway}</CardTitle>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${g.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                      {g.enabled ? 'Active' : 'Disabled'}
                    </span>
                    {isOpen ? <ChevronUp className='h-4 w-4 text-muted-foreground' /> : <ChevronDown className='h-4 w-4 text-muted-foreground' />}
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent className='space-y-4 pt-4 border-t' onClick={e => e.stopPropagation()}>
                    <div className='flex items-center gap-3'>
                      <Switch checked={d.enabled} onCheckedChange={(v) => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, enabled: v } }))} />
                      <Label>{d.enabled ? 'Enabled' : 'Disabled'}</Label>
                    </div>

                    <div className='grid grid-cols-2 gap-4'>
                      <div className='space-y-1.5'>
                        <Label>Account Type</Label>
                        <select
                          className='w-full rounded-md border px-3 py-2 text-sm bg-background'
                          value={d.mode}
                          onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, mode: e.target.value } }))}
                        >
                          <option value='personal'>Personal</option>
                          <option value='agent'>Agent</option>
                          <option value='merchant'>Merchant</option>
                        </select>
                      </div>
                      <div className='space-y-1.5'>
                        <Label className='flex items-center gap-1'><Phone className='h-3 w-3' /> Phone Number</Label>
                        <Input
                          value={d.phoneNumber}
                          onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, phoneNumber: e.target.value } }))}
                          placeholder='01XXXXXXXXX'
                        />
                      </div>
                    </div>

                    <div className='space-y-1.5'>
                      <Label>Credentials (JSON)</Label>
                      <textarea
                        className='w-full min-h-[100px] rounded-md border px-3 py-2 text-sm bg-background font-mono'
                        value={d.credentials}
                        onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: e.target.value } }))}
                        placeholder='{"appKey":"...","secretKey":"..."}'
                      />
                      <p className='text-xs text-muted-foreground'>Enter gateway-specific credentials as JSON. Eg: appKey, secretKey, merchantId, etc.</p>
                    </div>

                    <div className='flex justify-end'>
                      <Button size='sm' onClick={() => handleSave(g.gateway)} disabled={updateMut.isPending}>
                        {updateMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : <Save className='h-4 w-4 mr-1' />}
                        Save
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      </Main>
    </>
  )
}
