import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from './storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, Store, Image, Share2, Search, Layout, Truck, CreditCard, Info, Phone } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function StorefrontSettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [storeName, setStoreName] = useState('')
  const [storeTagline, setStoreTagline] = useState('')
  const [storeEmail, setStoreEmail] = useState('')
  const [storePhone, setStorePhone] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [currency, setCurrency] = useState('BDT')
  const [currencySymbol, setCurrencySymbol] = useState('৳')
  const [deliveryCharge, setDeliveryCharge] = useState('60')
  const [freeDeliveryMin, setFreeDeliveryMin] = useState('1000')
  const [heroSlides, setHeroSlides] = useState('')
  const [facebook, setFacebook] = useState('')
  const [instagram, setInstagram] = useState('')
  const [youtube, setYoutube] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')
  const [footerDescription, setFooterDescription] = useState('')
  const [footerCopyright, setFooterCopyright] = useState('')
  const [aboutText, setAboutText] = useState('')
  const [shippingInfo, setShippingInfo] = useState('')
  const [paymentInfo, setPaymentInfo] = useState('')

  useEffect(() => {
    if (settings) {
      setStoreName(settings.store_name || '')
      setStoreTagline(settings.store_tagline || '')
      setStoreEmail(settings.store_email || '')
      setStorePhone(settings.store_phone || '')
      setStoreAddress(settings.store_address || '')
      setCurrency(settings.currency || 'BDT')
      setCurrencySymbol(settings.currency_symbol || '৳')
      setDeliveryCharge(settings.delivery_charge || '60')
      setFreeDeliveryMin(settings.free_delivery_min || '1000')
      setHeroSlides(settings.hero_slides || '[]')
      setFacebook(settings.social_facebook || '')
      setInstagram(settings.social_instagram || '')
      setYoutube(settings.social_youtube || '')
      setWhatsapp(settings.social_whatsapp || '')
      setSeoTitle(settings.seo_title || '')
      setSeoDescription(settings.seo_description || '')
      setSeoKeywords(settings.seo_keywords || '')
      setFooterDescription(settings.footer_description || '')
      setFooterCopyright(settings.footer_copyright || '')
      setAboutText(settings.about_us_text || '')
      setShippingInfo(settings.shipping_info || '')
      setPaymentInfo(settings.payment_info || '')
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const handleSave = () => {
    const updates = [
      { key: 'store_name', value: storeName },
      { key: 'store_tagline', value: storeTagline },
      { key: 'store_email', value: storeEmail },
      { key: 'store_phone', value: storePhone },
      { key: 'store_address', value: storeAddress },
      { key: 'currency', value: currency },
      { key: 'currency_symbol', value: currencySymbol },
      { key: 'delivery_charge', value: deliveryCharge },
      { key: 'free_delivery_min', value: freeDeliveryMin },
      { key: 'hero_slides', value: heroSlides },
      { key: 'social_facebook', value: facebook },
      { key: 'social_instagram', value: instagram },
      { key: 'social_youtube', value: youtube },
      { key: 'social_whatsapp', value: whatsapp },
      { key: 'seo_title', value: seoTitle },
      { key: 'seo_description', value: seoDescription },
      { key: 'seo_keywords', value: seoKeywords },
      { key: 'footer_description', value: footerDescription },
      { key: 'footer_copyright', value: footerCopyright },
      { key: 'about_us_text', value: aboutText },
      { key: 'shipping_info', value: shippingInfo },
      { key: 'payment_info', value: paymentInfo },
    ]

    Promise.all(updates.map(u => setMut.mutateAsync(u)))
      .then(() => toast.success('Storefront settings saved successfully'))
      .catch(() => toast.error('Failed to save some settings'))
  }

  if (isLoading) return <div className='flex items-center justify-center min-h-[400px]'><Loader2 className='animate-spin h-8 w-8 text-primary' /></div>

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Storefront Settings</h2>
        <p className='text-muted-foreground'>
          Customize your storefront appearance, content, and behavior. All changes take effect immediately.
        </p>
      </div>
      <Separator className='my-6' />

      <Tabs defaultValue="store" className='w-full'>
        <TabsList className='grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 mb-6'>
          <TabsTrigger value="store" className='gap-2'><Store className='h-4 w-4' /> Store</TabsTrigger>
          <TabsTrigger value="hero" className='gap-2'><Image className='h-4 w-4' /> Hero</TabsTrigger>
          <TabsTrigger value="social" className='gap-2'><Share2 className='h-4 w-4' /> Social</TabsTrigger>
          <TabsTrigger value="seo" className='gap-2'><Search className='h-4 w-4' /> SEO</TabsTrigger>
          <TabsTrigger value="footer" className='gap-2'><Layout className='h-4 w-4' /> Footer</TabsTrigger>
          <TabsTrigger value="delivery" className='gap-2'><Truck className='h-4 w-4' /> Delivery</TabsTrigger>
          <TabsTrigger value="misc" className='gap-2'><Info className='h-4 w-4' /> Other</TabsTrigger>
        </TabsList>

        <TabsContent value="store">
          <Card>
            <CardHeader><CardTitle>Store Information</CardTitle><CardDescription>Basic details about your store.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='grid gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='store-name'>Store Name</Label>
                  <Input id='store-name' value={storeName} onChange={e => setStoreName(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='store-tagline'>Tagline</Label>
                  <Input id='store-tagline' value={storeTagline} onChange={e => setStoreTagline(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='store-email'>Email</Label>
                  <Input id='store-email' type='email' value={storeEmail} onChange={e => setStoreEmail(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='store-phone'>Phone</Label>
                  <Input id='store-phone' value={storePhone} onChange={e => setStorePhone(e.target.value)} />
                </div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='store-address'>Address</Label>
                <Textarea id='store-address' value={storeAddress} onChange={e => setStoreAddress(e.target.value)} rows={2} />
              </div>
              <div className='grid gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='currency'>Currency Code</Label>
                  <Input id='currency' value={currency} onChange={e => setCurrency(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='currency-symbol'>Currency Symbol</Label>
                  <Input id='currency-symbol' value={currencySymbol} onChange={e => setCurrencySymbol(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hero">
          <Card>
            <CardHeader><CardTitle>Hero Banner Slides</CardTitle><CardDescription>Configure the hero slider images and links. Enter as a JSON array.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='space-y-2'>
                <Label htmlFor='hero-slides'>Hero Slides (JSON)</Label>
                <Textarea id='hero-slides' value={heroSlides} onChange={e => setHeroSlides(e.target.value)} rows={8}
                  placeholder='[{&quot;image&quot;: &quot;https://...&quot;, &quot;link&quot;: &quot;/products&quot;}]'
                  className='font-mono text-xs' />
              </div>
              <p className='text-sm text-muted-foreground'>
                Each slide requires an <code>image</code> URL and optional <code>link</code> path. Must be valid JSON array.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="social">
          <Card>
            <CardHeader><CardTitle>Social Media Links</CardTitle><CardDescription>Links displayed in the storefront footer.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='grid gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='social-facebook'>Facebook URL</Label>
                  <Input id='social-facebook' value={facebook} onChange={e => setFacebook(e.target.value)} placeholder='https://facebook.com/...' />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='social-instagram'>Instagram URL</Label>
                  <Input id='social-instagram' value={instagram} onChange={e => setInstagram(e.target.value)} placeholder='https://instagram.com/...' />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='social-youtube'>YouTube URL</Label>
                  <Input id='social-youtube' value={youtube} onChange={e => setYoutube(e.target.value)} placeholder='https://youtube.com/...' />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='social-whatsapp'>WhatsApp Number</Label>
                  <Input id='social-whatsapp' value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder='+8801700000000' />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo">
          <Card>
            <CardHeader><CardTitle>SEO Settings</CardTitle><CardDescription>Meta tags for search engine optimization.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='space-y-2'>
                <Label htmlFor='seo-title'>Default Page Title</Label>
                <Input id='seo-title' value={seoTitle} onChange={e => setSeoTitle(e.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='seo-description'>Meta Description</Label>
                <Textarea id='seo-description' value={seoDescription} onChange={e => setSeoDescription(e.target.value)} rows={3} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='seo-keywords'>Keywords (comma-separated)</Label>
                <Input id='seo-keywords' value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="footer">
          <Card>
            <CardHeader><CardTitle>Footer Content</CardTitle><CardDescription>Text displayed in the storefront footer.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='space-y-2'>
                <Label htmlFor='footer-description'>Footer Description</Label>
                <Textarea id='footer-description' value={footerDescription} onChange={e => setFooterDescription(e.target.value)} rows={4} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='footer-copyright'>Copyright Text</Label>
                <Input id='footer-copyright' value={footerCopyright} onChange={e => setFooterCopyright(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delivery">
          <Card>
            <CardHeader><CardTitle>Delivery Settings</CardTitle><CardDescription>Shipping and delivery configuration.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='grid gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='delivery-charge'>Delivery Charge</Label>
                  <Input id='delivery-charge' type='number' value={deliveryCharge} onChange={e => setDeliveryCharge(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='free-delivery-min'>Free Delivery Minimum (subtotal)</Label>
                  <Input id='free-delivery-min' type='number' value={freeDeliveryMin} onChange={e => setFreeDeliveryMin(e.target.value)} />
                </div>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='shipping-info'>Shipping Information</Label>
                <Textarea id='shipping-info' value={shippingInfo} onChange={e => setShippingInfo(e.target.value)} rows={3} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="misc">
          <Card>
            <CardHeader><CardTitle>Additional Content</CardTitle><CardDescription>About us, payment info, and other storefront content.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='space-y-2'>
                <Label htmlFor='about-text'>About Us Text</Label>
                <Textarea id='about-text' value={aboutText} onChange={e => setAboutText(e.target.value)} rows={4} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='payment-info'>Payment Information</Label>
                <Textarea id='payment-info' value={paymentInfo} onChange={e => setPaymentInfo(e.target.value)} rows={3} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>
          Changes take effect immediately on the storefront. Refresh the storefront page to see updates.
        </div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
