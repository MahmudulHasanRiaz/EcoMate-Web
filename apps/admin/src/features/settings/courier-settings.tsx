import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from './storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Truck, Save } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export function CourierSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [hoorinKey, setHoorinKey] = useState('')

  useEffect(() => {
    if (settings) {
      setHoorinKey(settings.courier_hoorin_api_key || '')
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    setMut.mutate({ key: 'courier_hoorin_api_key', value: hoorinKey }, {
      onSuccess: () => toast.success('Courier settings saved successfully'),
      onError: () => toast.error('Failed to save settings'),
    })
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Logistics Integration</h2>
        <p className='text-muted-foreground'>
          Configure third-party courier services for tracking and history.
        </p>
      </div>
      <Separator className='my-6' />
      
      <Card className='border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-2 mb-1'>
            <Truck className='h-5 w-5 text-primary' />
            <CardTitle className='text-xl'>Hoorin Courier</CardTitle>
          </div>
          <CardDescription>
            Connect your Hoorin account to fetch delivery history and track packages.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='hoorin-key'>API Key</Label>
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
          Changes will take effect immediately.
        </div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
