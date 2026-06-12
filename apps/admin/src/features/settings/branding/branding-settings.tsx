import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, ImageIcon, Globe, Shield, X } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { MediaPicker } from '@/components/media-picker'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'

export function BrandingSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [adminTitle, setAdminTitle] = useState('')
  const [adminFavicon, setAdminFavicon] = useState('')
  const [adminTagline, setAdminTagline] = useState('')
  const [storefrontFavicon, setStorefrontFavicon] = useState('')
  const [storefrontOgImage, setStorefrontOgImage] = useState('')
  const [storeLogo, setStoreLogo] = useState('')
  const [adminFaviconPickerOpen, setAdminFaviconPickerOpen] = useState(false)
  const [storefrontFaviconPickerOpen, setStorefrontFaviconPickerOpen] = useState(false)
  const [ogImagePickerOpen, setOgImagePickerOpen] = useState(false)
  const [storeLogoPickerOpen, setStoreLogoPickerOpen] = useState(false)

  useEffect(() => {
    if (settings) {
      setAdminTitle(settings.admin_title || '')
      setAdminFavicon(settings.admin_favicon || '')
      setAdminTagline(settings.admin_tagline || 'Admin Dashboard')
      setStorefrontFavicon(settings.storefront_favicon || '')
      setStorefrontOgImage(settings.storefront_og_image || '')
      setStoreLogo(settings.store_logo || '')
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    const updates = [
      { key: 'admin_title', value: adminTitle },
      { key: 'admin_favicon', value: adminFavicon },
      { key: 'admin_tagline', value: adminTagline },
      { key: 'storefront_favicon', value: storefrontFavicon },
      { key: 'storefront_og_image', value: storefrontOgImage },
      { key: 'store_logo', value: storeLogo },
    ]
    Promise.all(updates.map(u => setMut.mutateAsync(u)))
      .then(() => toast.success('Branding settings saved. Refresh the storefront/admin to see changes.'))
      .catch(() => toast.error('Failed to save branding settings'))
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Branding</h2>
        <p className='text-muted-foreground'>
          Control the visual identity, title, and favicon for both the admin panel and the storefront. All changes apply on next page load.
        </p>
      </div>
      <Separator className='my-6' />

      <Card>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <Shield className='h-5 w-5 text-primary' />
            <div>
              <CardTitle>Admin Panel Identity</CardTitle>
              <CardDescription>Browser tab title, favicon, and meta description for /admin.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid gap-6 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='admin-title'>Browser Tab Title</Label>
              <Input
                id='admin-title'
                value={adminTitle}
                onChange={e => setAdminTitle(e.target.value)}
                placeholder='EcoMate Admin'
              />
              <p className='text-xs text-muted-foreground'>Shown in the browser tab. Leave blank to use the default.</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='admin-tagline'>Admin Tagline</Label>
              <Input
                id='admin-tagline'
                value={adminTagline}
                onChange={e => setAdminTagline(e.target.value)}
                placeholder='Admin Dashboard'
              />
              <p className='text-xs text-muted-foreground'>Used in meta description and SEO tags.</p>
            </div>
          </div>
          <div className='space-y-2'>
            <Label>Admin Favicon</Label>
            <div className='flex items-start gap-3'>
              <div className='h-16 w-16 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                {adminFavicon
                  ? <SafeImage src={mediaUrl(adminFavicon)} alt='Admin favicon' className='h-full w-full object-contain' />
                  : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='flex gap-2'>
                  <Input
                    value={adminFavicon}
                    onChange={e => setAdminFavicon(e.target.value)}
                    placeholder='https://example.com/favicon.ico'
                  />
                  <Button type='button' variant='outline' size='sm' onClick={() => setAdminFaviconPickerOpen(true)}>
                    Pick
                  </Button>
                  {adminFavicon && (
                    <Button type='button' variant='ghost' size='icon' onClick={() => setAdminFavicon('')}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>Use a square image (PNG, ICO, or SVG) at least 32×32 px.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <Globe className='h-5 w-5 text-primary' />
            <div>
              <CardTitle>Storefront Identity</CardTitle>
              <CardDescription>Favicon and Open Graph image for the customer-facing storefront.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='space-y-2'>
            <Label>Storefront Favicon</Label>
            <div className='flex items-start gap-3'>
              <div className='h-16 w-16 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                {storefrontFavicon
                  ? <SafeImage src={mediaUrl(storefrontFavicon)} alt='Storefront favicon' className='h-full w-full object-contain' />
                  : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='flex gap-2'>
                  <Input
                    value={storefrontFavicon}
                    onChange={e => setStorefrontFavicon(e.target.value)}
                    placeholder='https://example.com/favicon.ico'
                  />
                  <Button type='button' variant='outline' size='sm' onClick={() => setStorefrontFaviconPickerOpen(true)}>
                    Pick
                  </Button>
                  {storefrontFavicon && (
                    <Button type='button' variant='ghost' size='icon' onClick={() => setStorefrontFavicon('')}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>Used in the browser tab and as the storefront app icon.</p>
              </div>
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Store Logo</Label>
            <div className='flex items-start gap-3'>
              <div className='h-16 w-40 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                {storeLogo
                  ? <SafeImage src={mediaUrl(storeLogo)} alt='Store logo' className='h-full w-full object-contain' />
                  : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='flex gap-2'>
                  <Input
                    value={storeLogo}
                    onChange={e => setStoreLogo(e.target.value)}
                    placeholder='https://example.com/logo.png'
                  />
                  <Button type='button' variant='outline' size='sm' onClick={() => setStoreLogoPickerOpen(true)}>
                    Pick
                  </Button>
                  {storeLogo && (
                    <Button type='button' variant='ghost' size='icon' onClick={() => setStoreLogo('')}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>Shown in the storefront header when no brand systems are configured. Use a horizontal logo for best results.</p>
              </div>
            </div>
          </div>

          <Separator className='my-4' />

          <div className='space-y-2'>
            <Label>Default Social Share Image (Open Graph)</Label>
            <div className='flex items-start gap-3'>
              <div className='h-24 w-40 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                {storefrontOgImage
                  ? <SafeImage src={mediaUrl(storefrontOgImage)} alt='OG image' className='h-full w-full object-cover' />
                  : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
              </div>
              <div className='flex-1 flex flex-col gap-2'>
                <div className='flex gap-2'>
                  <Input
                    value={storefrontOgImage}
                    onChange={e => setStorefrontOgImage(e.target.value)}
                    placeholder='https://example.com/og.jpg'
                  />
                  <Button type='button' variant='outline' size='sm' onClick={() => setOgImagePickerOpen(true)}>
                    Pick
                  </Button>
                  {storefrontOgImage && (
                    <Button type='button' variant='ghost' size='icon' onClick={() => setStorefrontOgImage('')}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>Recommended size 1200×630 px. Used when sharing links on Facebook, Messenger, etc.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>
          Branding changes take effect after refreshing the affected pages.
        </div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Branding
        </Button>
      </div>

      <MediaPicker
        open={adminFaviconPickerOpen}
        onOpenChange={setAdminFaviconPickerOpen}
        selected={adminFavicon ? [adminFavicon] : []}
        multiple={false}
        onSelect={(urls) => {
          setAdminFavicon(urls[urls.length - 1] || '')
          setAdminFaviconPickerOpen(false)
        }}
      />
      <MediaPicker
        open={storefrontFaviconPickerOpen}
        onOpenChange={setStorefrontFaviconPickerOpen}
        selected={storefrontFavicon ? [storefrontFavicon] : []}
        multiple={false}
        onSelect={(urls) => {
          setStorefrontFavicon(urls[urls.length - 1] || '')
          setStorefrontFaviconPickerOpen(false)
        }}
      />
      <MediaPicker
        open={ogImagePickerOpen}
        onOpenChange={setOgImagePickerOpen}
        selected={storefrontOgImage ? [storefrontOgImage] : []}
        multiple={false}
        onSelect={(urls) => {
          setStorefrontOgImage(urls[urls.length - 1] || '')
          setOgImagePickerOpen(false)
        }}
      />
      <MediaPicker
        open={storeLogoPickerOpen}
        onOpenChange={setStoreLogoPickerOpen}
        selected={storeLogo ? [storeLogo] : []}
        multiple={false}
        onSelect={(urls) => {
          setStoreLogo(urls[urls.length - 1] || '')
          setStoreLogoPickerOpen(false)
        }}
      />
    </div>
  )
}
