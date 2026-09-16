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
import { Loader2, Radio, Save, ExternalLink, ChevronsUpDown } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { TrackingTabs } from './tracking-nav'
import { MetaDestinationsCard, hasConfiguredDestinations } from './meta-destinations-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProviderHeader, PurchaseTimingFields } from './tracking-ui'

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
  const [metaTestMode, setMetaTestMode] = useState(false)
  const [tiktokEnabled, setTiktokEnabled] = useState(false)
  const [tiktokPixelCode, setTiktokPixelCode] = useState('')
  const [tiktokAccessToken, setTiktokAccessToken] = useState('')
  const [tiktokTestCode, setTiktokTestCode] = useState('')
  const [tiktokTestMode, setTiktokTestMode] = useState(false)
  const [metaPurchaseMode, setMetaPurchaseMode] = useState('instant')
  const [metaValidatedStatus, setMetaValidatedStatus] = useState('')
  const [tiktokPurchaseMode, setTiktokPurchaseMode] = useState('instant')
  const [tiktokValidatedStatus, setTiktokValidatedStatus] = useState('')
  const [relayEnabled, setRelayEnabled] = useState(false)
  // Step 3 — the destination array is edited as a raw JSON string by the card and
  // written back verbatim (the server validates it).
  const [metaDestinations, setMetaDestinations] = useState('')
  // Legacy fallback visibility: collapsed once destinations exist (their values
  // are then ignored for delivery), expanded while legacy is the active path.
  // null = follow hasDestinations; a user toggle overrides until it flips again.
  const [legacyOpen, setLegacyOpen] = useState<boolean | null>(null)
  const hasDestinations = hasConfiguredDestinations(metaDestinations)
  const isLegacyOpen = legacyOpen ?? !hasDestinations

  useEffect(() => {
    if (settings) {
      setMetaEnabled(settings.tracking_meta_enabled === 'true')
      setMetaPixelId(settings.tracking_meta_pixel_id || '')
      setMetaAccessToken(settings.tracking_meta_access_token || '')
      setMetaTestCode(settings.tracking_meta_test_code || '')
      setMetaTestMode(settings.tracking_meta_test_mode === 'true')
      setMetaPurchaseMode(settings.tracking_meta_purchase_mode || 'instant')
      setMetaValidatedStatus(settings.tracking_meta_validated_status || '')
      setTiktokEnabled(settings.tracking_tiktok_enabled === 'true')
      setTiktokPixelCode(settings.tracking_tiktok_pixel_code || '')
      setTiktokAccessToken(settings.tracking_tiktok_access_token || '')
      setTiktokTestCode(settings.tracking_tiktok_test_code || '')
      setTiktokTestMode(settings.tracking_tiktok_test_mode === 'true')
      setTiktokPurchaseMode(settings.tracking_tiktok_purchase_mode || 'instant')
      setTiktokValidatedStatus(settings.tracking_tiktok_validated_status || '')
      setRelayEnabled(settings.tracking_relay_enabled === 'true')
      setMetaDestinations(settings.tracking_meta_destinations || '')
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
      { key: 'tracking_meta_test_mode', value: String(metaTestMode) },
      { key: 'tracking_meta_purchase_mode', value: metaPurchaseMode },
      { key: 'tracking_meta_validated_status', value: metaValidatedStatus },
      { key: 'tracking_tiktok_enabled', value: String(tiktokEnabled) },
      { key: 'tracking_tiktok_pixel_code', value: tiktokPixelCode },
      { key: 'tracking_tiktok_access_token', value: tiktokAccessToken },
      { key: 'tracking_tiktok_test_code', value: tiktokTestCode },
      { key: 'tracking_tiktok_test_mode', value: String(tiktokTestMode) },
      { key: 'tracking_tiktok_purchase_mode', value: tiktokPurchaseMode },
      { key: 'tracking_tiktok_validated_status', value: tiktokValidatedStatus },
      { key: 'tracking_relay_enabled', value: String(relayEnabled) },
      { key: 'tracking_meta_destinations', value: metaDestinations },
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
      <TrackingTabs />
      <Separator className='my-6' />

      {/* Tracking pipeline relay — global kill switch for every provider. */}
      <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
        <CardContent className='flex items-center justify-between gap-4 py-4'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 font-medium'>
              <Radio className='h-4 w-4 shrink-0 text-primary' />
              Tracking Pipeline (Relay)
            </div>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              When OFF, events are captured but <span className='font-medium'>not sent</span> to any provider.
            </p>
          </div>
          <Switch checked={relayEnabled} onCheckedChange={setRelayEnabled} aria-label='Tracking pipeline relay enabled' />
        </CardContent>
      </Card>

      {/* Provider navigation — one provider's configuration visible at a time. */}
      <Tabs defaultValue='meta' className='w-full'>
        <TabsList className='grid w-full grid-cols-3 sm:w-auto sm:min-w-[24rem]' aria-label='Tracking providers'>
          <TabsTrigger value='meta' className='gap-2'>
            <span className={metaEnabled ? 'h-1.5 w-1.5 rounded-full bg-emerald-500' : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/40'} aria-hidden />
            Meta
          </TabsTrigger>
          <TabsTrigger value='tiktok' className='gap-2'>
            <span className={tiktokEnabled ? 'h-1.5 w-1.5 rounded-full bg-emerald-500' : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/40'} aria-hidden />
            TikTok
          </TabsTrigger>
          <TabsTrigger value='ga4' className='gap-2'>GA4</TabsTrigger>
        </TabsList>

        <TabsContent value='meta' className='mt-6 space-y-6'>
          {/* Provider-level Meta delivery settings — always visible. These apply
              whether delivery runs through destinations or the legacy fallback:
              tracking_meta_enabled, tracking_meta_purchase_mode,
              tracking_meta_validated_status. No per-destination purchase mode. */}
          <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
            <CardHeader className='pb-4'>
              <ProviderHeader title='Meta (Facebook)' enabled={metaEnabled} onToggle={setMetaEnabled} />
              <CardDescription>
                Delivery settings apply to every Meta destination.
              </CardDescription>
            </CardHeader>
            <CardContent className={metaEnabled ? '' : 'opacity-50 pointer-events-none'}>
              <PurchaseTimingFields
                idPrefix='meta'
                mode={metaPurchaseMode}
                onModeChange={(v) => { setMetaPurchaseMode(v); if (v === 'instant') setMetaValidatedStatus(''); }}
                status={metaValidatedStatus}
                onStatusChange={setMetaValidatedStatus}
                statusList={statusList}
              />
            </CardContent>
          </Card>

          {/* Step 3 — Meta destinations (multi-pixel + multi-CAPI) */}
          <MetaDestinationsCard
            raw={metaDestinations}
            onChange={setMetaDestinations}
            disabled={setMut.isPending}
          />

      {/* Legacy single-pixel credentials — fallback only. Collapsed while a
          destination exists (these values are then ignored for delivery);
          expanded while legacy is the active delivery path. Backend keys are
          unchanged; this is a presentation change only. */}
      <Collapsible open={isLegacyOpen} onOpenChange={setLegacyOpen}>
        <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
          <CardHeader className='pb-4'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2 mb-1'>
                <Radio className='h-5 w-5 text-primary' />
                <CardTitle className='text-xl'>Legacy Meta Configuration</CardTitle>
                <Badge variant='secondary'>Fallback only</Badge>
              </div>
              <CollapsibleTrigger asChild>
                <Button type='button' variant='ghost' size='sm'>
                  {isLegacyOpen ? 'Hide' : 'Show'}
                  <ChevronsUpDown className='h-4 w-4 ml-1' />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CardDescription>
              {hasDestinations
                ? 'Not used while Meta destinations exist above — delivery uses the destinations. Kept for reference and rollback.'
                : 'Used only when no Meta destination is configured above. Add a destination to switch to multi-pixel delivery.'}
            </CardDescription>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
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
                <div className='flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2'>
                  <div className='space-y-0.5'>
                    <Label htmlFor='meta-test-mode'>Enable Test Mode</Label>
                    <p className='text-xs text-muted-foreground'>
                      Route events to the Meta Test Events tool (must be on with a test code to see server events).
                    </p>
                  </div>
                  <Switch id='meta-test-mode' checked={metaTestMode} onCheckedChange={setMetaTestMode} />
                </div>
              </div>

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
          </CollapsibleContent>
        </Card>
      </Collapsible>
        </TabsContent>

        {/* TikTok — same visual language as Meta (header + purchase timing +
            connection), but a SINGLE pixel connection: the backend and browser
            currently support one TikTok destination only, so there is no Add
            Destination control here. */}
        <TabsContent value='tiktok' className='mt-6 space-y-6'>
          <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
            <CardHeader className='pb-4'>
              <ProviderHeader title='TikTok Events API' enabled={tiktokEnabled} onToggle={setTiktokEnabled} />
              <CardDescription>
                Server-side event tracking via TikTok Events API. Single pixel connection.
              </CardDescription>
            </CardHeader>
            <CardContent className={tiktokEnabled ? 'space-y-6' : 'space-y-6 opacity-50 pointer-events-none'}>
              <PurchaseTimingFields
                idPrefix='tiktok'
                mode={tiktokPurchaseMode}
                onModeChange={(v) => { setTiktokPurchaseMode(v); if (v === 'instant') setTiktokValidatedStatus(''); }}
                status={tiktokValidatedStatus}
                onStatusChange={setTiktokValidatedStatus}
                statusList={statusList}
              />
              <div className='grid gap-4 sm:grid-cols-2'>
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
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='tiktok-test-code'>Test Event Code (Optional)</Label>
                  <Input
                    id='tiktok-test-code'
                    value={tiktokTestCode}
                    onChange={e => setTiktokTestCode(e.target.value)}
                    placeholder='Test event UUID from TikTok'
                    className='bg-background/50'
                  />
                  <p className='text-xs text-muted-foreground'>
                    TikTok Events Manager → Test Events gives a test code UUID. Leave empty for production.
                  </p>
                </div>
                <div className='flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2'>
                  <div className='space-y-0.5'>
                    <Label htmlFor='tiktok-test-mode'>Enable Test Mode</Label>
                    <p className='text-xs text-muted-foreground'>
                      Route events to the TikTok Test Events tool.
                    </p>
                  </div>
                  <Switch id='tiktok-test-mode' checked={tiktokTestMode} onCheckedChange={setTiktokTestMode} />
                </div>
              </div>
              <div>
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
        </TabsContent>

        {/* GA4 — env-driven, no destinations. Compact read-only panel. */}
        <TabsContent value='ga4' className='mt-6 space-y-6'>
          <Card className='overflow-hidden border-none shadow-md bg-gradient-to-br from-background to-muted/20'>
            <CardHeader className='pb-4'>
              <div className='flex items-center gap-2 mb-1'>
                <h3 className='text-base font-semibold'>Google Analytics 4 (GA4)</h3>
                <Badge variant='secondary'>Managed via environment</Badge>
              </div>
              <CardDescription>
                Client-side tracking via gtag.js. Configure via env vars: <code>NEXT_PUBLIC_GA_MEASUREMENT_ID</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='grid gap-4 sm:grid-cols-2'>
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
        </TabsContent>
      </Tabs>

      <div className='sticky bottom-4 flex items-center justify-between gap-4 p-4 bg-muted/80 backdrop-blur rounded-xl border border-dashed border-muted-foreground/20 shadow-lg'>
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
