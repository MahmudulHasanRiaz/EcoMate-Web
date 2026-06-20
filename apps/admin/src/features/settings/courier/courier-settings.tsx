import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import steadfastLogo from '@/assets/payment-logos/steadfast.png'
import pathaoLogo from '@/assets/payment-logos/pathao.png'
import redxLogo from '@/assets/payment-logos/redx.webp'
import carrybeeLogo from '@/assets/payment-logos/carrybee.jpg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, CheckCircle2, XCircle, ExternalLink, Webhook, Copy, RefreshCw, Eye, EyeOff, AlertCircle } from 'lucide-react'

const courierLogos: Record<string, string> = {
  steadfast: steadfastLogo, pathao: pathaoLogo, redx: redxLogo, carrybee: carrybeeLogo,
}

const webhookBase = (() => {
  if (import.meta.env.VITE_API_URL) return `${import.meta.env.VITE_API_URL}/webhooks/courier`
  if (typeof window !== 'undefined' && !window.location.hostname.includes('localhost')) {
    return `${window.location.origin}/api/webhooks/courier`
  }
  return 'http://localhost:4000/api/webhooks/courier'
})()

const courierApi = {
  listCreds: () => apiClient.get('/couriers/credentials'),
  updateCreds: (courier: string, d: Record<string, unknown>) => apiClient.put(`/couriers/credentials/${courier}`, d),
  generateWebhookSecret: (courier: string) => apiClient.post(`/couriers/credentials/${courier}/generate-webhook-secret`, {}),
}

interface CourierFormState {
  enabled: boolean; apiKey: string; secretKey: string; username: string
  password: string; clientId: string; clientSecret: string; storeId: string; mode: string
  webhookSecret?: string
}

interface CourierInfo {
  name: string; color: string; fields: (keyof CourierFormState)[]; guide: string; docUrl?: string
}

const courierInfo: Record<string, CourierInfo> = {
  steadfast: {
    name: 'Steadfast', color: '#0EA5E9',
    fields: ['apiKey', 'secretKey'],
    guide: 'Get your API Key and Secret Key from Steadfast Merchant Panel → Settings → API.',
    docUrl: 'https://portal.packzy.com',
  },
  pathao: {
    name: 'Pathao', color: '#F97316',
    fields: ['clientId', 'clientSecret', 'username', 'password', 'storeId'],
    guide: 'Get credentials from Pathao Merchant Portal. Store ID found in Store Settings.',
    docUrl: 'https://merchant.pathao.com',
  },
  redx: {
    name: 'RedX', color: '#EF4444',
    fields: ['apiKey'],
    guide: 'Get your API token from RedX Merchant Dashboard → API Settings. Use as API Key.',
    docUrl: 'https://redx.com.bd/developer-api/',
  },
  carrybee: {
    name: 'Carrybee', color: '#8B5CF6',
    fields: ['clientId', 'clientSecret'],
    guide: 'Get Client ID and Client Secret from Carrybee Developer Portal.',
    docUrl: 'https://developers.carrybee.com',
  },
}

const defaultForm: CourierFormState = {
  enabled: false, apiKey: '', secretKey: '', username: '',
  password: '', clientId: '', clientSecret: '', storeId: '', mode: 'sandbox',
  webhookSecret: '',
}

export function CourierSettings() {
  const queryClient = useQueryClient()
  const { data: creds, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['courier-creds'],
    queryFn: () => courierApi.listCreds().then(r => r.data),
  })

  const [forms, setForms] = useState<Record<string, CourierFormState>>({})

  const list = Array.isArray(creds) ? creds : (creds as Record<string, unknown>)?.data as unknown[] || []

  useEffect(() => {
    console.log('Courier credentials API response:', creds, 'Parsed list:', list)
  }, [creds, list])

  useEffect(() => {
    if (list.length > 0) {
      const f: Record<string, CourierFormState> = {}
      for (const c of list as Record<string, unknown>[]) {
        const courier = c['courier'] as string
        f[courier] = {
          enabled: c['enabled'] as boolean || false,
          apiKey: (c['apiKey'] as string) || (c['credentials'] as Record<string, string>)?.['apiKey'] || '',
          secretKey: (c['secretKey'] as string) || (c['credentials'] as Record<string, string>)?.['secretKey'] || '',
          username: (c['username'] as string) || (c['credentials'] as Record<string, string>)?.['username'] || '',
          password: (c['password'] as string) || (c['credentials'] as Record<string, string>)?.['password'] || '',
          clientId: (c['clientId'] as string) || (c['credentials'] as Record<string, string>)?.['clientId'] || '',
          clientSecret: (c['clientSecret'] as string) || (c['credentials'] as Record<string, string>)?.['clientSecret'] || '',
          storeId: (c['storeId'] as string) || (c['credentials'] as Record<string, string>)?.['storeId'] || '',
          mode: (c['mode'] as string) || 'sandbox',
          webhookSecret: (c['webhookSecret'] as string) || '',
        }
      }
      setForms(f)
    }
  }, [list.length])

  const updateMut = useMutation({
    mutationFn: ({ courier, data }: { courier: string; data: Record<string, unknown> }) => courierApi.updateCreds(courier, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['courier-creds'] }); toast.success('Credentials saved') },
    onError: (e: unknown) => { toast.error((e as Error).message || 'Failed to save') },
  })

  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})

  const generateWebhookMut = useMutation({
    mutationFn: (courier: string) => courierApi.generateWebhookSecret(courier),
    onSuccess: (res: unknown, courier) => {
      const response = res as { data?: { webhookSecret?: string }; webhookSecret?: string }
      const secret = response?.data?.webhookSecret || response?.webhookSecret
      if (secret) {
        setForms(prev => ({ ...prev, [courier]: { ...prev[courier], webhookSecret: secret } }))
        toast.success('Webhook secret generated')
      }
      queryClient.invalidateQueries({ queryKey: ['courier-creds'] })
    },
    onError: (e: unknown) => { toast.error((e as Error).message || 'Failed to generate secret') },
  })

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  if (isError) {
    return (
      <div>
        <div className='flex items-center justify-between mb-6'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Courier Integrations</h2>
            <p className='text-sm text-muted-foreground mt-1'>Configure API credentials for courier services.</p>
          </div>
        </div>
        <div className='flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-red-50/50 border-red-200 text-center max-w-lg mx-auto mt-8'>
          <XCircle className='h-10 w-10 text-red-500 mb-3' />
          <h3 className='text-base font-semibold text-red-900'>Failed to load courier credentials</h3>
          <p className='text-sm text-red-700 mt-1 mb-4 font-mono text-xs'>
            {(error as any)?.response?.data?.message || (error as any)?.message || 'An unknown error occurred while communicating with the backend API.'}
          </p>
          <Button size='sm' onClick={() => refetch()} className='gap-2'>
            <RefreshCw className='h-3.5 w-3.5' /> Retry Connection
          </Button>
        </div>
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div>
        <div className='flex items-center justify-between mb-6'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Courier Integrations</h2>
            <p className='text-sm text-muted-foreground mt-1'>Configure API credentials for courier services.</p>
          </div>
        </div>
        <div className='flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/30 text-center max-w-lg mx-auto mt-8'>
          <AlertCircle className='h-10 w-10 text-muted-foreground mb-3' />
          <h3 className='text-base font-semibold text-foreground'>No courier integrations found</h3>
          <p className='text-sm text-muted-foreground mt-1 mb-4'>
            The system could not find any couriers seeded in the database. Please ensure you have run the database seed script.
          </p>
          <Button size='sm' onClick={() => refetch()} variant='outline' className='gap-2'>
            <RefreshCw className='h-3.5 w-3.5' /> Refresh
          </Button>
        </div>
      </div>
    )
  }

  const handleSave = (courier: string) => {
    const f = forms[courier]
    if (!f) return
    updateMut.mutate({ courier, data: { ...f, credentials: {} } })
  }

  const fieldLabel: Record<string, string> = {
    apiKey: 'API Key', secretKey: 'Secret Key', username: 'Username',
    password: 'Password', clientId: 'Client ID', clientSecret: 'Client Secret',
    storeId: 'Store ID',
  }

  return (
    <div>
      <div className='flex items-center justify-between mb-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Courier Integrations</h2>
          <p className='text-sm text-muted-foreground mt-1'>Configure API credentials for courier services.</p>
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        {list.map((c: Record<string, unknown>) => {
          const courier = c['courier'] as string
          const info = courierInfo[courier]
          const form = forms[courier] || defaultForm
          if (!info) return null

          return (
            <Card key={courier} className={form.enabled ? 'border-l-4' : ''} style={form.enabled ? { borderLeftColor: info.color } : {}}>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <img src={courierLogos[courier]} alt={info.name} className='h-9 w-9 rounded-lg object-contain bg-muted p-1' />
                  <div>
                      <CardTitle className='text-base'>{info.name}</CardTitle>
                      <p className='text-xs text-muted-foreground'>
                        {form.enabled
                          ? <span className='text-green-600 flex items-center gap-1'><CheckCircle2 className='h-3 w-3' /> Connected</span>
                          : <span className='flex items-center gap-1'><XCircle className='h-3 w-3' /> Disabled</span>
                        }
                      </p>
                    </div>
                  </div>
                  <Switch checked={form.enabled} onCheckedChange={(v) => setForms(prev => ({ ...prev, [courier]: { ...prev[courier], enabled: v } }))} />
                </div>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='flex gap-2'>
                  <Badge variant='outline' className='text-xs'>{form.mode === 'production' ? 'Production' : 'Sandbox'}</Badge>
                  <button
                    className='text-xs text-muted-foreground hover:text-primary'
                    onClick={() => setForms(prev => ({ ...prev, [courier]: { ...prev[courier], mode: prev[courier].mode === 'sandbox' ? 'production' : 'sandbox' } }))}
                  >
                    Switch to {form.mode === 'sandbox' ? 'Production' : 'Sandbox'}
                  </button>
                </div>

                <div className='space-y-2'>
                  {info.fields.map(field => (
                    <div key={field}>
                      <Label className='text-xs'>{fieldLabel[field] || field}</Label>
                      <Input
                        className='h-8 text-sm'
                        type={field.includes('secret') || field === 'password' ? 'password' : 'text'}
                        value={String(form[field] || '')}
                        onChange={e => setForms(prev => ({ ...prev, [courier]: { ...prev[courier], [field]: e.target.value } }))}
                        placeholder={`Enter ${fieldLabel[field] || field}...`}
                      />
                    </div>
                  ))}
                </div>

                <p className='text-[11px] text-muted-foreground leading-relaxed'>
                  {info.guide}
                  {info.docUrl && (
                    <a href={info.docUrl} target='_blank' rel='noopener noreferrer' className='text-primary hover:underline ml-1 inline-flex items-center gap-0.5'>
                      Docs <ExternalLink className='h-2.5 w-2.5' />
                    </a>
                  )}
                </p>

                <div className='bg-muted/50 rounded-md p-2 space-y-1'>
                  <Label className='text-[10px] text-muted-foreground flex items-center gap-1'><Webhook className='h-3 w-3' /> Webhook URL</Label>
                  <div className='flex items-center gap-1'>
                    <code className='text-[11px] bg-background rounded px-1.5 py-0.5 flex-1 truncate'>{webhookBase}/{courier}</code>
                    <Button variant='ghost' size='icon' className='h-6 w-6 shrink-0' onClick={() => { navigator.clipboard.writeText(`${webhookBase}/${courier}`); toast.success('Copied') }}>
                      <Copy className='h-3 w-3' />
                    </Button>
                  </div>
                </div>

{courier === 'redx' ? (
                  <div className='bg-muted/50 rounded-md p-2 space-y-1'>
                    <Label className='text-[10px] text-muted-foreground flex items-center gap-1'><Webhook className='h-3 w-3' /> Webhook Auth</Label>
                    <p className='text-[10px] text-muted-foreground'>
                      RedX webhook authentication currently using tracking number + invoice verification.
                    </p>
                  </div>
                ) : (
                  <div className='bg-muted/50 rounded-md p-2 space-y-2'>
                    <div className='flex items-center justify-between'>
                      <Label className='text-[10px] text-muted-foreground flex items-center gap-1'><Webhook className='h-3 w-3' /> Bearer Token (Auth)</Label>
                      {form.webhookSecret ? (
                        <Button 
                          variant='ghost' 
                          size='sm' 
                          className='h-5 text-[10px]' 
                          onClick={() => setShowSecret(prev => ({ ...prev, [courier]: !prev[courier] }))}
                        >
                          {showSecret[courier] ? <EyeOff className='h-3 w-3 mr-1' /> : <Eye className='h-3 w-3 mr-1' />}
                          {showSecret[courier] ? 'Hide' : 'Show'}
                        </Button>
                      ) : null}
                    </div>
                    {form.webhookSecret ? (
                      <div className='flex items-center gap-1'>
                        <code className='text-[11px] bg-background rounded px-1.5 py-0.5 flex-1 truncate font-mono'>
                          {showSecret[courier] ? form.webhookSecret : '••••••••••••••••••••••••••••••••'}
                        </code>
                        <Button variant='ghost' size='icon' className='h-6 w-6 shrink-0' onClick={() => { navigator.clipboard.writeText(form.webhookSecret || ''); toast.success('Token copied') }}>
                          <Copy className='h-3 w-3' />
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        size='sm' 
                        variant='outline' 
                        className='w-full text-xs h-7' 
                        onClick={() => generateWebhookMut.mutate(courier)}
                        disabled={generateWebhookMut.isPending}
                      >
                        {generateWebhookMut.isPending ? <Loader2 className='h-3 w-3 animate-spin mr-1' /> : <RefreshCw className='h-3 w-3 mr-1' />}
                        Generate Bearer Token
                      </Button>
                    )}
                    <p className='text-[10px] text-muted-foreground'>
                      Use as <code className='text-[10px] bg-muted px-0.5 rounded'>Authorization: Bearer {'{token}'}</code> in webhook calls
                    </p>
                  </div>
                )}

                <Button size='sm' onClick={() => handleSave(courier)} disabled={updateMut.isPending} className='w-full'>
                  <Save className='h-3.5 w-3.5 mr-1' /> Save Credentials
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
