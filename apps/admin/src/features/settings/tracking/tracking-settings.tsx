import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { orderStatusApi } from '@/features/order-statuses/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Radio, Save, ExternalLink } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

export function TrackingSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const { data: statusList } = useQuery({
    queryKey: ['order-statuses'],
    queryFn: () => orderStatusApi.list().then(r => r.data),
    staleTime: 300000,
  })

  const [metaEnabled, setMetaEnabled] = useState(false)
  const [metaPixelId, setMetaPixelId] = useState('')
  const [metaAccessToken, setMetaAccessToken] = useState('')
  const [metaTestCode, setMetaTestCode] = useState('')
  const [tiktokEnabled, setTiktokEnabled] = useState(false)
  const [tiktokPixelCode, setTiktokPixelCode] = useState('')
  const [tiktokAccessToken, setTiktokAccessToken] = useState('')
  const [metaPurchaseMode, setMetaPurchaseMode] = useState('instant')
  const [metaValidatedStatus, setMetaValidatedStatus] = useState('')
  const [tiktokPurchaseMode, setTiktokPurchaseMode] = useState('instant')
  const [tiktokValidatedStatus, setTiktokValidatedStatus] = useState('')

  useEffect(() => {
    if (settings) {
      setMetaEnabled(settings.tracking_meta_enabled === 'true')
      setMetaPixelId(settings.tracking_meta_pixel_id || '')
      setMetaAccessToken(settings.tracking_meta_access_token || '')
      setMetaTestCode(settings.tracking_meta_test_code || '')
      setMetaPurchaseMode(settings.tracking_meta_purchase_mode || 'instant')
      setMetaValidatedStatus(settings.tracking_meta_validated_status || '')
      setTiktokEnabled(settings.tracking_tiktok_enabled === 'true')
      setTiktokPixelCode(settings.tracking_tiktok_pixel_code || '')
      setTiktokAccessToken(settings.tracking_tiktok_access_token || '')
      setTiktokPurchaseMode(settings.tracking_tiktok_purchase_mode || 'instant')
      setTiktokValidatedStatus(settings.tracking_tiktok_validated_status || '')
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    if (metaPurchaseMode === 'validated' && !metaValidatedStatus) {
      toast.error('Please select a trigger status for Meta Purchase event');
      return;
    }
    if (tiktokPurchaseMode === 'validated' && !tiktokValidatedStatus) {
      toast.error('Please select a trigger status for TikTok Purchase event');
      return;
    }
    const updates = [
      { key: 'tracking_meta_enabled', value: String(metaEnabled) },
      { key: 'tracking_meta_pixel_id', value: metaPixelId },
      { key: 'tracking_meta_access_token', value: metaAccessToken },
      { key: 'tracking_meta_test_code', value: metaTestCode },
      { key: 'tracking_meta_purchase_mode', value: metaPurchaseMode },
      { key: 'tracking_meta_validated_status', value: metaValidatedStatus },
      { key: 'tracking_tiktok_enabled', value: String(tiktokEnabled) },
      { key: 'tracking_tiktok_pixel_code', value: tiktokPixelCode },
      { key: 'tracking_tiktok_access_token', value: tiktokAccessToken },
      { key: 'tracking_tiktok_purchase_mode', value: tiktokPurchaseMode },
      { key: 'tracking_tiktok_validated_status', value: tiktokValidatedStatus },
    ]

    Promise.all(updates.map(u => setMut.mutateAsync(u)))
      .then(() => toast.success('Tracking settings saved successfully'))
      .catch(() => toast.error('Failed to save some settings'))
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Tracking Configuration</h2>
        <p className='text-muted-foreground'>
          Configure Meta (Facebook) Conversions API and TikTok Events API for server-side event tracking.
        </p>
      </div>
      <Separator className='my-6' />

      {/* Meta Card */}
      <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
        <CardHeader className='pb-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 mb-1'>
              <Radio className='h-5 w-5 text-primary' />
              <CardTitle className='text-xl'>Meta (Facebook) Conversions API</CardTitle>
            </div>
            <Switch checked={metaEnabled} onCheckedChange={setMetaEnabled} />
          </div>
          <CardDescription>
            Server-side event tracking via Meta CAPI. Requires a Pixel ID and Access Token.
          </CardDescription>
        </CardHeader>
        <CardContent className={metaEnabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='meta-pixel-id'>Pixel ID</Label>
              <Input
                id='meta-pixel-id'
                value={metaPixelId}
                onChange={e => setMetaPixelId(e.target.value)}
                placeholder='123456789012345'
                className='bg-background/50'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='meta-access-token'>Access Token</Label>
              <Input
                id='meta-access-token'
                type='password'
                value={metaAccessToken}
                onChange={e => setMetaAccessToken(e.target.value)}
                placeholder='EAA...'
                className='bg-background/50'
              />
            </div>
          </div>
          
          <div className='grid gap-6 sm:grid-cols-2 mt-4'>
            <div className='space-y-2'>
              <Label htmlFor='meta-test-code'>Test Event Code (Optional)</Label>
              <Input
                id='meta-test-code'
                value={metaTestCode}
                onChange={e => setMetaTestCode(e.target.value)}
                placeholder='TEST12345'
                className='bg-background/50'
              />
              <p className='text-xs text-muted-foreground'>
                Use this to test server-side events in Meta Events Manager. Leave empty for production.
              </p>
            </div>
          </div>

          <div className='space-y-2 sm:col-span-2 mt-4'>
            <Label htmlFor='meta-purchase-mode'>Purchase Event Mode</Label>
            <Select value={metaPurchaseMode} onValueChange={(v) => { setMetaPurchaseMode(v); if (v === 'instant') setMetaValidatedStatus(''); }}>
              <SelectTrigger id='meta-purchase-mode' className='bg-background/50 w-full sm:w-72'>
                <SelectValue placeholder='Select mode' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='instant'>Instant — Send immediately (client + server)</SelectItem>
                <SelectItem value='validated'>Validated — Send when status is reached (server only)</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              Choose "Instant" for immediate purchase tracking, or "Validated" to delay until the order reaches a specific status.
            </p>
          </div>

          {metaPurchaseMode === 'validated' && (
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='meta-validated-status'>Trigger on Status</Label>
              <Select value={metaValidatedStatus} onValueChange={setMetaValidatedStatus}>
                <SelectTrigger id='meta-validated-status' className='bg-background/50 w-full sm:w-72'>
                  <SelectValue placeholder='Select order status' />
                </SelectTrigger>
                <SelectContent>
                  {(statusList || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                The Purchase event will be sent (server-side only) when the order reaches this status. Client identifiers (fbp, fbc) are saved at checkout and included.
              </p>
            </div>
          )}

          <div className='mt-4'>
            <a
              href='https://developers.facebook.com/docs/marketing-api/conversions-api/get-started'
              target='_blank'
              rel='noreferrer'
              className='text-sm text-primary hover:underline inline-flex items-center gap-1'
            >
              How to get Meta CAPI credentials <ExternalLink className='h-3 w-3' />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* TikTok Card */}
      <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
        <CardHeader className='pb-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 mb-1'>
              <Radio className='h-5 w-5 text-primary' />
              <CardTitle className='text-xl'>TikTok Events API</CardTitle>
            </div>
            <Switch checked={tiktokEnabled} onCheckedChange={setTiktokEnabled} />
          </div>
          <CardDescription>
            Server-side event tracking via TikTok Events API. Requires a Pixel Code and Access Token.
          </CardDescription>
        </CardHeader>
        <CardContent className={tiktokEnabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='tiktok-pixel-code'>Pixel Code</Label>
              <Input
                id='tiktok-pixel-code'
                value={tiktokPixelCode}
                onChange={e => setTiktokPixelCode(e.target.value)}
                placeholder='CABC12345'
                className='bg-background/50'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='tiktok-access-token'>Access Token</Label>
              <Input
                id='tiktok-access-token'
                type='password'
                value={tiktokAccessToken}
                onChange={e => setTiktokAccessToken(e.target.value)}
                placeholder='tt...'
                className='bg-background/50'
              />
            </div>
          </div>
          <div className='space-y-2 sm:col-span-2'>
            <Label htmlFor='tiktok-purchase-mode'>Purchase Event Mode</Label>
            <Select value={tiktokPurchaseMode} onValueChange={(v) => { setTiktokPurchaseMode(v); if (v === 'instant') setTiktokValidatedStatus(''); }}>
              <SelectTrigger id='tiktok-purchase-mode' className='bg-background/50 w-full sm:w-72'>
                <SelectValue placeholder='Select mode' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='instant'>Instant — Send immediately (client + server)</SelectItem>
                <SelectItem value='validated'>Validated — Send when status is reached (server only)</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>
              Choose "Instant" for immediate purchase tracking, or "Validated" to delay until the order reaches a specific status.
            </p>
          </div>

          {tiktokPurchaseMode === 'validated' && (
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='tiktok-validated-status'>Trigger on Status</Label>
              <Select value={tiktokValidatedStatus} onValueChange={setTiktokValidatedStatus}>
                <SelectTrigger id='tiktok-validated-status' className='bg-background/50 w-full sm:w-72'>
                  <SelectValue placeholder='Select order status' />
                </SelectTrigger>
                <SelectContent>
                  {(statusList || []).map((s: any) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                The Purchase event will be sent (server-side only) when the order reaches this status. Client identifiers (fbp, fbc) are saved at checkout and included.
              </p>
            </div>
          )}

          <div className='mt-4'>
            <a
              href='https://ads.tiktok.com/help/article/evnts-api-get-started'
              target='_blank'
              rel='noreferrer'
              className='text-sm text-primary hover:inline-flex items-center gap-1'
            >
              How to get TikTok Events API credentials <ExternalLink className='h-3 w-3' />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* GA4 Card */}
      <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
        <CardHeader className='pb-4'>
          <div className='flex items-center gap-2 mb-1'>
            <Radio className='h-5 w-5 text-primary' />
            <CardTitle className='text-xl'>Google Analytics 4 (GA4)</CardTitle>
          </div>
          <CardDescription>
            Client-side tracking via gtag.js. Configure via env vars: <code>NEXT_PUBLIC_GA_MEASUREMENT_ID</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='ga-measurement-id'>Measurement ID</Label>
              <Input
                id='ga-measurement-id'
                value=''
                readOnly
                placeholder='Set via NEXT_PUBLIC_GA_MEASUREMENT_ID env var'
                className='bg-background/50 text-muted-foreground'
              />
              <p className='text-xs text-muted-foreground'>
                Configured server-side via <code>GA_MEASUREMENT_ID</code> and <code>GA_API_SECRET</code>.
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ga-ads-id'>Google Ads Conversion ID</Label>
              <Input
                id='ga-ads-id'
                value=''
                readOnly
                placeholder='Set via GA_ADS_CONVERSION_ID env var'
                className='bg-background/50 text-muted-foreground'
              />
            </div>
          </div>
          <div className='mt-4'>
            <a
              href='https://developers.google.com/analytics/devguides/collection/ga4'
              target='_blank'
              rel='noreferrer'
              className='text-sm text-primary hover:underline inline-flex items-center gap-1'
            >
              GA4 setup guide <ExternalLink className='h-3 w-3' />
            </a>
          </div>
        </CardContent>
      </Card>

      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>
          Changes will take effect immediately. Tracked events include PageView, AddToCart, Purchase, and more.
        </div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
