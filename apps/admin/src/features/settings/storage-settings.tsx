import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from './storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

export function StorageSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [provider, setProvider] = useState('local')
  const [r2Endpoint, setR2Endpoint] = useState('')
  const [r2AccessKey, setR2AccessKey] = useState('')
  const [r2SecretKey, setR2SecretKey] = useState('')
  const [r2Bucket, setR2Bucket] = useState('')
  const [r2PublicUrl, setR2PublicUrl] = useState('')
  const [hoorinKey, setHoorinKey] = useState('')

  useEffect(() => {
    if (settings) {
      setProvider(settings.storage_provider || 'local')
      setR2Endpoint(settings.storage_r2_endpoint || '')
      setR2AccessKey(settings.storage_r2_access_key || '')
      setR2SecretKey(settings.storage_r2_secret_key || '')
      setR2Bucket(settings.storage_r2_bucket || '')
      setR2PublicUrl(settings.storage_r2_public_url || '')
      setHoorinKey(settings.courier_hoorin_api_key || '')
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    const updates = [
      { key: 'storage_provider', value: provider },
      { key: 'storage_r2_endpoint', value: r2Endpoint },
      { key: 'storage_r2_access_key', value: r2AccessKey },
      { key: 'storage_r2_secret_key', value: r2SecretKey },
      { key: 'storage_r2_bucket', value: r2Bucket },
      { key: 'storage_r2_public_url', value: r2PublicUrl },
      { key: 'courier_hoorin_api_key', value: hoorinKey },
    ]
    updates.forEach(u => setMut.mutate(u))
    toast.success('Storage settings saved')
  }

  if (isLoading) return <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6' /></div>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage Configuration</CardTitle>
        <p className='text-sm text-muted-foreground'>Configure where product images are stored. Local by default, or connect Cloudflare R2.</p>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center gap-3'>
          <Switch checked={provider === 'r2'} onCheckedChange={(v) => setProvider(v ? 'r2' : 'local')} />
          <Label>Use Cloudflare R2</Label>
          <span className='text-xs text-muted-foreground ml-2'>(currently: {provider})</span>
        </div>

        {provider === 'r2' && (
          <div className='space-y-3 pl-2 border-l-2'>
            <div className='space-y-1.5'>
              <Label>R2 Endpoint</Label>
              <Input value={r2Endpoint} onChange={e => setR2Endpoint(e.target.value)} placeholder='https://<accountid>.r2.cloudflarestorage.com' />
            </div>
            <div className='space-y-1.5'>
              <Label>Access Key ID</Label>
              <Input value={r2AccessKey} onChange={e => setR2AccessKey(e.target.value)} placeholder='Access key' />
            </div>
            <div className='space-y-1.5'>
              <Label>Secret Access Key</Label>
              <Input type='password' value={r2SecretKey} onChange={e => setR2SecretKey(e.target.value)} placeholder='Secret key' />
            </div>
            <div className='space-y-1.5'>
              <Label>Bucket Name</Label>
              <Input value={r2Bucket} onChange={e => setR2Bucket(e.target.value)} placeholder='my-bucket' />
            </div>
            <div className='space-y-1.5'>
              <Label>Public URL (optional)</Label>
              <Input value={r2PublicUrl} onChange={e => setR2PublicUrl(e.target.value)} placeholder='https://pub-xxx.r2.dev or custom domain' />
              <p className='text-xs text-muted-foreground'>If set, images use this URL. Otherwise falls back to R2 endpoint.</p>
            </div>
          </div>
        )}

        <div className='border-t pt-4 mt-2 space-y-3'>
          <div className='space-y-1.5'>
            <Label>Hoorin Courier API Key</Label>
            <Input type='password' value={hoorinKey} onChange={e => setHoorinKey(e.target.value)} placeholder='Enter your Hoorin API key' />
            <p className='text-xs text-muted-foreground'>Used to fetch courier delivery history per phone number. Get key at dash.hoorin.com</p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : null}
          Save Settings
        </Button>
      </CardContent>
    </Card>
  )
}
