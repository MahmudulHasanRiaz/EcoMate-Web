import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { gatewayApi, type GatewayConfig } from './api'
import { PaymentLogo } from '@/components/payment-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save, ChevronDown, ChevronUp, Phone, Settings2, Info, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const gatewayLabels: Record<string, string> = {
  bkash: 'bKash (Manual)', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay',
  cellfin: 'Cellfin/Selfin', bkash_pgw: 'bKash PGW', cod: 'Cash on Delivery',
}

const gatewayDescriptions: Record<string, string> = {
  bkash: 'Manual bKash payment with number verification.',
  nagad: 'Nagad manual or automatic payment gateway.',
  rocket: 'Rocket mobile banking integration.',
  bkash_pgw: 'Official bKash Payment Gateway (Tokenized).',
  cod: 'Standard Cash on Delivery for physical goods.',
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
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ['gateways'] })
      toast.success('Gateway settings updated') 
    },
  })

  const initEdit = (g: GatewayConfig) => {
    if (editData[g.gateway]) return
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

  const handleToggleExpand = (g: GatewayConfig) => {
    initEdit(g)
    setExpanded(prev => ({ ...prev, [g.gateway]: !prev[g.gateway] }))
  }

  const handleSave = (gateway: string) => {
    const d = editData[gateway]
    if (!d) return
    
    let parsedCredentials = {}
    try {
      parsedCredentials = JSON.parse(d.credentials)
    } catch (e) {
      toast.error('Invalid JSON credentials format')
      return
    }

    updateMut.mutate({
      gateway,
      data: {
        gateway,
        enabled: d.enabled,
        mode: d.mode,
        phoneNumber: d.phoneNumber || null,
        credentials: parsedCredentials,
      },
    })
  }

  if (isLoading) return (
    <div className='flex items-center justify-center min-h-[400px]'>
      <Loader2 className='animate-spin h-8 w-8 text-primary' />
    </div>
  )

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Payment Gateways</h2>
        <p className='text-muted-foreground'>
          Manage your store&apos;s checkout options and automated payment gateways.
        </p>
      </div>
      <Separator className='my-6' />

      <div className='grid gap-6'>
        {(gateways || []).map(g => {
          const isOpen = expanded[g.gateway]
          const d = editData[g.gateway] || { 
            enabled: g.enabled, 
            mode: g.mode || 'personal', 
            phoneNumber: g.phoneNumber || '', 
            credentials: JSON.stringify(g.credentials || {}, null, 2) 
          }

          return (
            <Card key={g.id} className={cn(
              'transition-all duration-300 border shadow-sm overflow-hidden',
              isOpen ? 'ring-1 ring-primary' : 'hover:border-primary/50'
            )}>
              <div 
                className='p-4 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4'
                onClick={() => handleToggleExpand(g)}
              >
                <div className='flex items-center gap-4'>
                  <div className='p-2 rounded-lg bg-background border shadow-sm shrink-0'>
                    <PaymentLogo method={g.gateway} size='md' showName={false} />
                  </div>
                  <div className='space-y-0.5'>
                    <CardTitle className='text-base flex items-center gap-2'>
                      {gatewayLabels[g.gateway] || g.gateway}
                      {g.enabled && (
                        <CheckCircle2 className='h-3.5 w-3.5 text-green-500' />
                      )}
                    </CardTitle>
                    <CardDescription className='text-xs line-clamp-1'>
                      {gatewayDescriptions[g.gateway] || 'Configure payment settings.'}
                    </CardDescription>
                  </div>
                </div>
                
                <div className='flex items-center justify-between sm:justify-end gap-4'>
                  <div className='flex items-center gap-2'>
                    <span className={cn(
                      'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                      d.enabled 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {d.enabled ? 'Active' : 'Inactive'}
                    </span>
                    <Switch 
                      checked={d.enabled} 
                      onCheckedChange={(v) => {
                        initEdit(g);
                        setEditData(prev => ({ ...prev, [g.gateway]: { ...d, enabled: v } }))
                      }} 
                      onClick={e => e.stopPropagation()}
                    />
                  </div>
                  <Button variant='ghost' size='sm' className='h-8 w-8 p-0'>
                    {isOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                  </Button>
                </div>
              </div>

              {isOpen && (
                <CardContent className='p-4 pt-0 border-t bg-muted/5 animate-in fade-in slide-in-from-top-2 duration-200' onClick={e => e.stopPropagation()}>
                  <div className='pt-4 grid gap-6 md:grid-cols-12'>
                    <div className='md:col-span-7 space-y-4'>
                      <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                        <div className='space-y-2'>
                          <Label className='text-xs font-semibold'>Account Type</Label>
                          <Select 
                            value={d.mode} 
                            onValueChange={v => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, mode: v } }))}
                          >
                            <SelectTrigger className='h-9'>
                              <SelectValue placeholder='Select type' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='personal'>Personal</SelectItem>
                              <SelectItem value='agent'>Agent</SelectItem>
                              <SelectItem value='merchant'>Merchant</SelectItem>
                              <SelectItem value='production'>Production (PGW)</SelectItem>
                              <SelectItem value='sandbox'>Sandbox (PGW)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className='space-y-2'>
                          <Label className='text-xs font-semibold flex items-center gap-1.5'>
                            <Phone className='h-3 w-3' /> Phone Number
                          </Label>
                          <Input
                            className='h-9'
                            value={d.phoneNumber}
                            onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, phoneNumber: e.target.value } }))}
                            placeholder='01XXXXXXXXX'
                          />
                        </div>
                      </div>

                      <div className='space-y-2'>
                        <Label className='text-xs font-semibold'>Credentials (JSON)</Label>
                        <Textarea
                          className='min-h-[120px] font-mono text-[11px] bg-background'
                          value={d.credentials}
                          onChange={e => setEditData(prev => ({ ...prev, [g.gateway]: { ...d, credentials: e.target.value } }))}
                          placeholder='{\n  "appKey": "...",\n  "secretKey": "..."\n}'
                        />
                      </div>
                    </div>

                    <div className='md:col-span-5 space-y-4'>
                      <div className='rounded-lg bg-background border p-4 space-y-2'>
                        <div className='flex items-center gap-2 font-semibold text-xs text-primary'>
                          <Settings2 className='h-3.5 w-3.5' />
                          <span>Quick Guide</span>
                        </div>
                        <ul className='text-[11px] space-y-2 text-muted-foreground'>
                          <li className='flex gap-2'><Info className='h-3 w-3 shrink-0 mt-0.5' /> Manual accounts need phone numbers only.</li>
                          <li className='flex gap-2'><Info className='h-3 w-3 shrink-0 mt-0.5' /> PGW requires API credentials.</li>
                        </ul>
                        <Separator className='my-2' />
                        <div className='flex justify-end pt-2'>
                          <Button 
                            size='sm' 
                            className='w-full' 
                            onClick={() => handleSave(g.gateway)} 
                            disabled={updateMut.isPending}
                          >
                            {updateMut.isPending ? (
                              <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' />
                            ) : (
                              <Save className='h-3.5 w-3.5 mr-2' />
                            )}
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

