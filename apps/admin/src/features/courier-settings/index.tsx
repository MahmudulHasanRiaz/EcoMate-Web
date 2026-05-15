import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, ChevronDown, ChevronUp } from 'lucide-react'

const courierApi = {
  listCreds: () => apiClient.get('/couriers/credentials'),
  updateCreds: (courier: string, d: any) => apiClient.put(`/couriers/credentials/${courier}`, d),
}

const courierLabels: Record<string, string> = {
  steadfast: 'Steadfast', pathao: 'Pathao', redx: 'RedX', carrybee: 'Carrybee',
}

export function CourierSettings() {
  const queryClient = useQueryClient()
  const { data: creds, isLoading } = useQuery({ queryKey: ['courier-creds'], queryFn: () => courierApi.listCreds().then(r => r.data) })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const updateMut = useMutation({
    mutationFn: ({ courier, data }: { courier: string; data: any }) => courierApi.updateCreds(courier, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['courier-creds'] }); toast.success('Saved') },
  })

  const list = Array.isArray(creds) ? creds : (creds as any)?.data || []

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  return (
    <div>
      <h2 className='text-2xl font-bold tracking-tight mb-6'>Courier Settings</h2>
      <p className='text-sm text-muted-foreground mb-6'>Configure API credentials for each courier service.</p>
      <div className='space-y-4'>
        {list.map((c: any) => {
          const isOpen = expanded[c.courier]
          const [enabled, setEnabled] = useState(c.enabled)
          const [apiKey, setApiKey] = useState(c.apiKey || c.credentials?.apiKey || '')
          const [secretKey, setSecretKey] = useState(c.secretKey || c.credentials?.secretKey || '')
          const [username, setUsername] = useState(c.username || c.credentials?.username || '')
          const [password, setPassword] = useState(c.password || c.credentials?.password || '')
          const [clientId, setClientId] = useState(c.clientId || c.credentials?.clientId || '')
          const [clientSecret, setClientSecret] = useState(c.clientSecret || c.credentials?.clientSecret || '')
          const [storeId, setStoreId] = useState(c.storeId || c.credentials?.storeId || '')

          return (
            <Card key={c.id}>
              <CardHeader className='pb-2 cursor-pointer flex flex-row items-center justify-between' onClick={() => setExpanded(prev => ({ ...prev, [c.courier]: !prev[c.courier] }))}>
                <div className='flex items-center gap-3'>
                  <div className='h-8 w-8 rounded-full bg-muted flex items-center justify-center font-bold text-sm'>{courierLabels[c.courier]?.[0] || c.courier[0]?.toUpperCase()}</div>
                  <CardTitle className='text-sm'>{courierLabels[c.courier] || c.courier}</CardTitle>
                </div>
                <div className='flex items-center gap-2'>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.enabled ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>{c.enabled ? 'Active' : 'Inactive'}</span>
                  {isOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className='space-y-3 pt-4 border-t' onClick={e => e.stopPropagation()}>
                  <div className='flex items-center gap-3'><Switch checked={enabled} onCheckedChange={setEnabled} /><Label>{enabled ? 'Enabled' : 'Disabled'}</Label></div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div><Label>API Key</Label><Input value={apiKey} onChange={e => setApiKey(e.target.value)} /></div>
                    <div><Label>Secret Key</Label><Input type='password' value={secretKey} onChange={e => setSecretKey(e.target.value)} /></div>
                    <div><Label>Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} /></div>
                    <div><Label>Password</Label><Input type='password' value={password} onChange={e => setPassword(e.target.value)} /></div>
                    <div><Label>Client ID</Label><Input value={clientId} onChange={e => setClientId(e.target.value)} /></div>
                    <div><Label>Client Secret</Label><Input type='password' value={clientSecret} onChange={e => setClientSecret(e.target.value)} /></div>
                    <div><Label>Store ID (Pathao)</Label><Input value={storeId} onChange={e => setStoreId(e.target.value)} /></div>
                  </div>
                  <Button size='sm' onClick={() => updateMut.mutate({ courier: c.courier, data: { enabled, apiKey, secretKey, username, password, clientId, clientSecret, storeId } })} disabled={updateMut.isPending}><Save className='h-4 w-4 mr-1' /> Save</Button>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
