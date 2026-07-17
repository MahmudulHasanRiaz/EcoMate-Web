import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Loader2, Printer, Save } from 'lucide-react'

const DEFAULT_WIDTH = 50
const DEFAULT_HEIGHT = 30
const MIN_WIDTH = 20
const MIN_HEIGHT = 15
const MAX_WIDTH = 100
const MAX_HEIGHT = 75

export function PriceLabelSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  useEffect(() => {
    if (settings?.price_label) {
      try {
        const parsed = JSON.parse(settings.price_label)
        if (parsed.width) setWidth(parsed.width)
        if (parsed.height) setHeight(parsed.height)
      } catch {}
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    const value = JSON.stringify({ width, height })
    setMut.mutateAsync({ key: 'price_label', value })
      .then(() => toast.success('Price label settings saved'))
      .catch(() => toast.error('Failed to save settings'))
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Price Label</h2>
        <p className='text-muted-foreground'>Configure thermal price label sticker dimensions.</p>
      </div>
      <Separator className='my-6' />
      <Card>
        <CardHeader>
          <div className='flex items-center gap-2 mb-1'>
            <Printer className='h-5 w-5 text-primary' />
            <CardTitle>Sticker Dimensions</CardTitle>
          </div>
          <CardDescription>Set the width and height for price label stickers (thermal printer).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='pl-width'>Width (mm)</Label>
              <Input
                id='pl-width'
                type='number'
                min={MIN_WIDTH}
                max={MAX_WIDTH}
                value={width}
                onChange={e => setWidth(Number(e.target.value))}
              />
              <p className='text-[11px] text-muted-foreground'>Min {MIN_WIDTH}mm, Max {MAX_WIDTH}mm</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='pl-height'>Height (mm)</Label>
              <Input
                id='pl-height'
                type='number'
                min={MIN_HEIGHT}
                max={MAX_HEIGHT}
                value={height}
                onChange={e => setHeight(Number(e.target.value))}
              />
              <p className='text-[11px] text-muted-foreground'>Min {MIN_HEIGHT}mm, Max {MAX_HEIGHT}mm</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>Default: {DEFAULT_WIDTH}mm x {DEFAULT_HEIGHT}mm</div>
        <Button onClick={handleSave} size='lg' className='px-8' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
