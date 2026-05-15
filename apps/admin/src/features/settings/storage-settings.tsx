import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from './storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Cloud, HardDrive, ShieldCheck, Truck, Save } from 'lucide-react'

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
    
    // Use a single promise.all for better tracking if api supported bulk, 
    // but here we follow existing pattern with feedback
    Promise.all(updates.map(u => setMut.mutateAsync(u)))
      .then(() => toast.success('Settings saved successfully'))
      .catch(() => toast.error('Failed to save some settings'))
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Media Storage</h2>
        <p className='text-muted-foreground'>
          Choose where your product images and other assets are hosted.
        </p>
      </div>
      <Separator className='my-6' />
      <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-2 mb-1'>
            <Cloud className='h-5 w-5 text-primary' />
            <CardTitle className='text-xl'>Media Storage</CardTitle>
          </div>
          <CardDescription>
            Choose where your product images and other assets are hosted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={provider} onValueChange={setProvider} className='w-full'>
            <TabsList className='grid w-full grid-cols-2 mb-6'>
              <TabsTrigger value='local' className='flex items-center gap-2'>
                <HardDrive className='h-4 w-4' />
                Local Server
              </TabsTrigger>
              <TabsTrigger value='r2' className='flex items-center gap-2'>
                <Cloud className='h-4 w-4' />
                Cloudflare R2
              </TabsTrigger>
            </TabsList>

            <TabsContent value='local' className='space-y-4 py-2 animate-in fade-in slide-in-from-left-2 duration-300'>
              <div className='rounded-lg border bg-muted/30 p-4 flex gap-4 items-start'>
                <div className='p-2 bg-primary/10 rounded-full'>
                  <ShieldCheck className='h-5 w-5 text-primary' />
                </div>
                <div className='space-y-1'>
                  <p className='font-medium'>Local storage is active</p>
                  <p className='text-sm text-muted-foreground'>
                    Your assets are being stored on your local disk. This is great for development but consider a CDN/Cloud storage for production scalability.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value='r2' className='space-y-6 animate-in fade-in slide-in-from-right-2 duration-300'>
              <div className='grid gap-6 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='r2-endpoint'>Endpoint URL</Label>
                  <Input 
                    id='r2-endpoint'
                    value={r2Endpoint} 
                    onChange={e => setR2Endpoint(e.target.value)} 
                    placeholder='https://<accountid>.r2.cloudflarestorage.com' 
                    className='bg-background/50'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='r2-bucket'>Bucket Name</Label>
                  <Input 
                    id='r2-bucket'
                    value={r2Bucket} 
                    onChange={e => setR2Bucket(e.target.value)} 
                    placeholder='ecomate-assets' 
                    className='bg-background/50'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='r2-access'>Access Key ID</Label>
                  <Input 
                    id='r2-access'
                    value={r2AccessKey} 
                    onChange={e => setR2AccessKey(e.target.value)} 
                    placeholder='Enter Access Key' 
                    className='bg-background/50'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='r2-secret'>Secret Access Key</Label>
                  <Input 
                    id='r2-secret'
                    type='password' 
                    value={r2SecretKey} 
                    onChange={e => setR2SecretKey(e.target.value)} 
                    placeholder='••••••••••••••••' 
                    className='bg-background/50'
                  />
                </div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='r2-public'>Custom Public URL (Recommended)</Label>
                <Input 
                  id='r2-public'
                  value={r2PublicUrl} 
                  onChange={e => setR2PublicUrl(e.target.value)} 
                  placeholder='https://assets.ecomate.com or R2.dev URL' 
                  className='bg-background/50'
                />
                <p className='text-[11px] text-muted-foreground italic px-1'>
                  If provided, this URL will be used to serve your images.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className='border-none shadow-md'>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-2 mb-1'>
            <Truck className='h-5 w-5 text-primary' />
            <CardTitle className='text-xl'>Logistics Integration</CardTitle>
          </div>
          <CardDescription>
            Configure third-party courier services for tracking and history.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='hoorin-key'>Hoorin Courier API Key</Label>
            <div className='relative'>
              <Input 
                id='hoorin-key'
                type='password' 
                value={hoorinKey} 
                onChange={e => setHoorinKey(e.target.value)} 
                placeholder='Enter Hoorin API key' 
                className='bg-background/50'
              />
            </div>
            <p className='text-xs text-muted-foreground flex items-center gap-1.5 mt-1 px-1'>
              <span>Used for fetching delivery history. Get yours at <a href='https://dash.hoorin.com' target='_blank' className='text-primary hover:underline'>dash.hoorin.com</a></span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>
          Changes will take effect immediately upon saving.
        </div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}

