import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from './storage-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save, Store, Image as ImageIcon, Share2, Search, Layout, Truck, Info, List, HelpCircle, Clock, ShoppingCart, MapPin, X, Plus, Palette, GripVertical } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MediaPicker } from '@/components/media-picker'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'

const bdDistricts = [
  { name: 'Bagerhat', slug: 'bagerhat' }, { name: 'Bandarban', slug: 'bandarban' }, { name: 'Barguna', slug: 'barguna' },
  { name: 'Barishal', slug: 'barishal' }, { name: 'Bhola', slug: 'bhola' }, { name: 'Bogura', slug: 'bogura' },
  { name: 'Brahmanbaria', slug: 'brahmanbaria' }, { name: 'Chandpur', slug: 'chandpur' }, { name: 'Chapainawabganj', slug: 'chapainawabganj' },
  { name: 'Chattogram', slug: 'chattogram' }, { name: 'Chuadanga', slug: 'chuadanga' }, { name: 'Cox\'s Bazar', slug: 'coxs-bazar' },
  { name: 'Cumilla', slug: 'cumilla' }, { name: 'Dhaka', slug: 'dhaka' }, { name: 'Dinajpur', slug: 'dinajpur' },
  { name: 'Faridpur', slug: 'faridpur' }, { name: 'Feni', slug: 'feni' }, { name: 'Gaibandha', slug: 'gaibandha' },
  { name: 'Gazipur', slug: 'gazipur' }, { name: 'Gopalganj', slug: 'gopalganj' }, { name: 'Habiganj', slug: 'habiganj' },
  { name: 'Jamalpur', slug: 'jamalpur' }, { name: 'Jashore', slug: 'jashore' }, { name: 'Jhalokati', slug: 'jhalokati' },
  { name: 'Jhenaidah', slug: 'jhenaidah' }, { name: 'Joypurhat', slug: 'joypurhat' }, { name: 'Khagrachhari', slug: 'khagrachhari' },
  { name: 'Kushtia', slug: 'kushtia' }, { name: 'Khulna', slug: 'khulna' }, { name: 'Kishoreganj', slug: 'kishoreganj' },
  { name: 'Lakshmipur', slug: 'lakshmipur' }, { name: 'Lalmonirhat', slug: 'lalmonirhat' }, { name: 'Madaripur', slug: 'madaripur' },
  { name: 'Magura', slug: 'magura' }, { name: 'Manikganj', slug: 'manikganj' }, { name: 'Meherpur', slug: 'meherpur' },
  { name: 'Moulvibazar', slug: 'moulvibazar' }, { name: 'Munshiganj', slug: 'munshiganj' }, { name: 'Mymensingh', slug: 'mymensingh' },
  { name: 'Naogaon', slug: 'naogaon' }, { name: 'Narail', slug: 'narail' }, { name: 'Narayanganj', slug: 'narayanganj' },
  { name: 'Narsingdi', slug: 'narsingdi' }, { name: 'Natore', slug: 'natore' }, { name: 'Netrokona', slug: 'netrokona' },
  { name: 'Nilphamari', slug: 'nilphamari' }, { name: 'Noakhali', slug: 'noakhali' }, { name: 'Pabna', slug: 'pabna' },
  { name: 'Panchagarh', slug: 'panchagarh' }, { name: 'Patuakhali', slug: 'patuakhali' }, { name: 'Pirojpur', slug: 'pirojpur' },
  { name: 'Rajbari', slug: 'rajbari' }, { name: 'Rajshahi', slug: 'rajshahi' }, { name: 'Rangamati', slug: 'rangamati' },
  { name: 'Rangpur', slug: 'rangpur' }, { name: 'Satkhira', slug: 'satkhira' }, { name: 'Shariatpur', slug: 'shariatpur' },
  { name: 'Sherpur', slug: 'sherpur' }, { name: 'Sirajganj', slug: 'sirajganj' }, { name: 'Sunamganj', slug: 'sunamganj' },
  { name: 'Sylhet', slug: 'sylhet' }, { name: 'Tangail', slug: 'tangail' }, { name: 'Thakurgaon', slug: 'thakurgaon' },
]

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
  const [heroSlides, setHeroSlides] = useState<{ image: string; link?: string; alt?: string }[]>([])
  const [secondaryBanner, setSecondaryBanner] = useState('')
  const [secondaryBannerAlt, setSecondaryBannerAlt] = useState('')
  const [slidePickerOpen, setSlidePickerOpen] = useState(false)
  const [activeSlideIndex, setActiveSlideIndex] = useState<number | null>(null)
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false)
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
  const [navItems, setNavItems] = useState<{ name: string; href: string }[]>([])
  const [faqItems, setFaqItems] = useState<{ question: string; answer: string }[]>([])
  const [hoursLabel, setHoursLabel] = useState('')
  const [hoursDetails, setHoursDetails] = useState<{ day: string; time: string }[]>([])
  const [companyName, setCompanyName] = useState('')
  const [companyRegistration, setCompanyRegistration] = useState('')
  const [companyCertifications, setCompanyCertifications] = useState('')
  const [companyTeamSize, setCompanyTeamSize] = useState('')
  const [companyCeoName, setCompanyCeoName] = useState('')
  const [checkoutDistrictEnabled, setCheckoutDistrictEnabled] = useState(true)
  const [checkoutThanaEnabled, setCheckoutThanaEnabled] = useState(true)
  const [checkoutDistrictRequired, setCheckoutDistrictRequired] = useState(false)
  const [checkoutThanaRequired, setCheckoutThanaRequired] = useState(false)
  const [checkoutPaymentModes, setCheckoutPaymentModes] = useState<string[]>(['cod', 'full', 'partial'])
  const [districtCharges, setDistrictCharges] = useState<Record<string, string>>({})
  const [districtSearch, setDistrictSearch] = useState('')
  const [storeSystems, setStoreSystems] = useState<{ id: string; name: string; logo: string; display: 'name' | 'logo' | 'name+logo' }[]>([])
  const [systemPickerOpen, setSystemPickerOpen] = useState(false)
  const [activeSystemIdx, setActiveSystemIdx] = useState<number | null>(null)

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
      try { setHeroSlides(JSON.parse(settings.hero_slides || '[]')); } catch { setHeroSlides([]); }
      setSecondaryBanner(settings.hero_secondary_banner || '')
      setSecondaryBannerAlt(settings.hero_secondary_banner_alt || '')
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
      try { setNavItems(JSON.parse(settings.navigation_items || '[]')); } catch { setNavItems([]); }
      try { setFaqItems(JSON.parse(settings.faq_items || '[]')); } catch { setFaqItems([]); }
      setHoursLabel(settings.hours_label || '')
      try { setHoursDetails(JSON.parse(settings.hours_details || '[]')); } catch { setHoursDetails([]); }
      setCompanyName(settings.company_name || '')
      setCompanyRegistration(settings.company_registration || '')
      setCompanyCertifications(settings.company_certifications || '')
      setCompanyTeamSize(settings.company_team_size || '')
      setCompanyCeoName(settings.company_ceo_name || '')
      setCheckoutDistrictEnabled(settings.checkout_district_enabled !== 'false')
      setCheckoutThanaEnabled(settings.checkout_thana_enabled !== 'false')
      setCheckoutDistrictRequired(settings.checkout_district_required === 'true')
      setCheckoutThanaRequired(settings.checkout_thana_required === 'true')
      try { setCheckoutPaymentModes(JSON.parse(settings.checkout_payment_modes || '["cod","full","partial"]')); } catch { setCheckoutPaymentModes(['cod', 'full', 'partial']); }
      try { setDistrictCharges(JSON.parse(settings.district_charges || '{}')); } catch { setDistrictCharges({}); }
      try { setStoreSystems(JSON.parse(settings.store_systems || '[]')); } catch { setStoreSystems([]); }
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
      { key: 'hero_slides', value: JSON.stringify(heroSlides) },
      { key: 'hero_secondary_banner', value: secondaryBanner },
      { key: 'hero_secondary_banner_alt', value: secondaryBannerAlt },
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
      { key: 'navigation_items', value: JSON.stringify(navItems) },
      { key: 'faq_items', value: JSON.stringify(faqItems) },
      { key: 'hours_label', value: hoursLabel },
      { key: 'hours_details', value: JSON.stringify(hoursDetails) },
      { key: 'company_name', value: companyName },
      { key: 'company_registration', value: companyRegistration },
      { key: 'company_certifications', value: companyCertifications },
      { key: 'company_team_size', value: companyTeamSize },
      { key: 'company_ceo_name', value: companyCeoName },
      { key: 'store_systems', value: JSON.stringify(storeSystems) },
      { key: 'checkout_district_enabled', value: String(checkoutDistrictEnabled) },
      { key: 'checkout_thana_enabled', value: String(checkoutThanaEnabled) },
      { key: 'checkout_district_required', value: String(checkoutDistrictRequired) },
      { key: 'checkout_thana_required', value: String(checkoutThanaRequired) },
      { key: 'checkout_payment_modes', value: JSON.stringify(checkoutPaymentModes) },
      { key: 'district_charges', value: JSON.stringify(districtCharges) },
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
        <TabsList className='grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 mb-6'>
          <TabsTrigger value="store" className='gap-2'><Store className='h-4 w-4' /> Store</TabsTrigger>
          <TabsTrigger value="hero" className='gap-2'><ImageIcon className='h-4 w-4' /> Hero</TabsTrigger>
          <TabsTrigger value="social" className='gap-2'><Share2 className='h-4 w-4' /> Social</TabsTrigger>
          <TabsTrigger value="seo" className='gap-2'><Search className='h-4 w-4' /> SEO</TabsTrigger>
          <TabsTrigger value="footer" className='gap-2'><Layout className='h-4 w-4' /> Footer</TabsTrigger>
          <TabsTrigger value="delivery" className='gap-2'><Truck className='h-4 w-4' /> Delivery</TabsTrigger>
          <TabsTrigger value="checkout" className='gap-2'><ShoppingCart className='h-4 w-4' /> Checkout</TabsTrigger>
          <TabsTrigger value="districts" className='gap-2'><MapPin className='h-4 w-4' /> Districts</TabsTrigger>
          <TabsTrigger value="nav" className='gap-2'><List className='h-4 w-4' /> Nav</TabsTrigger>
          <TabsTrigger value="faq" className='gap-2'><HelpCircle className='h-4 w-4' /> FAQ</TabsTrigger>
          <TabsTrigger value="hours" className='gap-2'><Clock className='h-4 w-4' /> Hours</TabsTrigger>
          <TabsTrigger value="brands" className='gap-2'><Palette className='h-4 w-4' /> Brands</TabsTrigger>
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
          <div className='space-y-4'>
            <Card>
              <CardHeader>
                <CardTitle>Hero Banner Slides</CardTitle>
                <CardDescription>Banner images shown on the homepage slider. Add, edit, or remove slides below.</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                {heroSlides.map((slide, i) => (
                  <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
                    <div className='h-20 w-32 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                      {slide.image
                        ? <SafeImage src={mediaUrl(slide.image)} alt={slide.alt || ''} className='h-full w-full object-cover' />
                        : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
                    </div>
                    <div className='flex-1 space-y-3'>
                      <div className='space-y-2'>
                        <Label>Image</Label>
                        <div className='flex gap-2'>
                          <Input value={slide.image} onChange={e => {
                            const next = [...heroSlides];
                            next[i] = { ...next[i], image: e.target.value };
                            setHeroSlides(next);
                          }} placeholder='https://example.com/banner.jpg' />
                          <Button type='button' variant='outline' size='sm' onClick={() => { setActiveSlideIndex(i); setSlidePickerOpen(true) }}>
                            Pick
                          </Button>
                        </div>
                      </div>
                      <div className='grid grid-cols-2 gap-3'>
                        <div className='space-y-2'>
                          <Label>Link (optional)</Label>
                          <Input value={slide.link || ''} onChange={e => {
                            const next = [...heroSlides];
                            next[i] = { ...next[i], link: e.target.value };
                            setHeroSlides(next);
                          }} placeholder='/products' />
                        </div>
                        <div className='space-y-2'>
                          <Label>Alt text</Label>
                          <Input value={slide.alt || ''} onChange={e => {
                            const next = [...heroSlides];
                            next[i] = { ...next[i], alt: e.target.value };
                            setHeroSlides(next);
                          }} placeholder='Slide description' />
                        </div>
                      </div>
                    </div>
                    <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setHeroSlides(heroSlides.filter((_, j) => j !== i))}>
                      <X className='h-4 w-4' />
                    </Button>
                  </div>
                ))}
                <Button variant='outline' size='sm' onClick={() => setHeroSlides([...heroSlides, { image: '', link: '', alt: '' }])}>
                  <Plus className='h-4 w-4 mr-1' /> Add Slide
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Secondary Banner</CardTitle>
                <CardDescription>Single static banner displayed below the hero slider.</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex items-start gap-3'>
                  <div className='h-32 w-full max-w-md rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                    {secondaryBanner
                      ? <SafeImage src={mediaUrl(secondaryBanner)} alt={secondaryBannerAlt || ''} className='h-full w-full object-cover' />
                      : <ImageIcon className='h-8 w-8 text-muted-foreground' />}
                  </div>
                </div>
                <div className='grid gap-3 md:grid-cols-2 max-w-2xl'>
                  <div className='space-y-2'>
                    <Label>Image URL</Label>
                    <div className='flex gap-2'>
                      <Input value={secondaryBanner} onChange={e => setSecondaryBanner(e.target.value)} placeholder='https://example.com/banner.jpg' />
                      <Button type='button' variant='outline' size='sm' onClick={() => setSecondaryPickerOpen(true)}>
                        Pick
                      </Button>
                      {secondaryBanner && (
                        <Button type='button' variant='ghost' size='icon' onClick={() => setSecondaryBanner('')}>
                          <X className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <Label>Alt text</Label>
                    <Input value={secondaryBannerAlt} onChange={e => setSecondaryBannerAlt(e.target.value)} placeholder='Banner description' />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
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

        <TabsContent value="checkout">
          <Card>
            <CardHeader><CardTitle>Checkout Configuration</CardTitle><CardDescription>Control the checkout form fields and payment options available to customers.</CardDescription></CardHeader>
            <CardContent className='space-y-6'>
              <div className='space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Delivery Location Fields</h3>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='flex items-center justify-between p-4 border rounded-lg'>
                    <div>
                      <Label className='text-sm font-medium'>District Field</Label>
                      <p className='text-xs text-muted-foreground mt-1'>Show district dropdown in checkout</p>
                    </div>
                    <Switch checked={checkoutDistrictEnabled} onCheckedChange={setCheckoutDistrictEnabled} />
                  </div>
                  <div className='flex items-center justify-between p-4 border rounded-lg'>
                    <div>
                      <Label className='text-sm font-medium'>Thana/Upazila Field</Label>
                      <p className='text-xs text-muted-foreground mt-1'>Show thana dropdown in checkout</p>
                    </div>
                    <Switch checked={checkoutThanaEnabled} onCheckedChange={setCheckoutThanaEnabled} />
                  </div>
                  <div className='flex items-center justify-between p-4 border rounded-lg'>
                    <div>
                      <Label className='text-sm font-medium'>District Required</Label>
                      <p className='text-xs text-muted-foreground mt-1'>Customer must select a district</p>
                    </div>
                    <Switch checked={checkoutDistrictRequired} onCheckedChange={setCheckoutDistrictRequired} disabled={!checkoutDistrictEnabled} />
                  </div>
                  <div className='flex items-center justify-between p-4 border rounded-lg'>
                    <div>
                      <Label className='text-sm font-medium'>Thana/Upazila Required</Label>
                      <p className='text-xs text-muted-foreground mt-1'>Customer must select a thana</p>
                    </div>
                    <Switch checked={checkoutThanaRequired} onCheckedChange={setCheckoutThanaRequired} disabled={!checkoutThanaEnabled} />
                  </div>
                </div>
              </div>
              <Separator />
              <div className='space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Payment Modes</h3>
                <p className='text-xs text-muted-foreground'>Choose which payment options customers can use during checkout.</p>
                <div className='flex flex-wrap gap-4'>
                  <label className='flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors'>
                    <input type='checkbox' className='h-4 w-4 accent-primary' checked={checkoutPaymentModes.includes('cod')} onChange={e => {
                      setCheckoutPaymentModes(e.target.checked ? [...checkoutPaymentModes, 'cod'] : checkoutPaymentModes.filter(m => m !== 'cod'))
                    }} />
                    <div>
                      <span className='text-sm font-medium'>Cash on Delivery</span>
                      <p className='text-xs text-muted-foreground'>Pay when order is delivered</p>
                    </div>
                  </label>
                  <label className='flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors'>
                    <input type='checkbox' className='h-4 w-4 accent-primary' checked={checkoutPaymentModes.includes('full')} onChange={e => {
                      setCheckoutPaymentModes(e.target.checked ? [...checkoutPaymentModes, 'full'] : checkoutPaymentModes.filter(m => m !== 'full'))
                    }} />
                    <div>
                      <span className='text-sm font-medium'>Full Payment Online</span>
                      <p className='text-xs text-muted-foreground'>Pay full amount via online gateway</p>
                    </div>
                  </label>
                  <label className='flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors'>
                    <input type='checkbox' className='h-4 w-4 accent-primary' checked={checkoutPaymentModes.includes('partial')} onChange={e => {
                      setCheckoutPaymentModes(e.target.checked ? [...checkoutPaymentModes, 'partial'] : checkoutPaymentModes.filter(m => m !== 'partial'))
                    }} />
                    <div>
                      <span className='text-sm font-medium'>Partial Payment</span>
                      <p className='text-xs text-muted-foreground'>Pay a partial amount now, rest on delivery</p>
                    </div>
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="districts">
          <Card>
            <CardHeader>
              <CardTitle>District-wise Delivery Charges</CardTitle>
              <CardDescription>Set custom delivery charges for each district. Leave blank to use the default delivery charge.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <Input
                placeholder='Search districts...'
                value={districtSearch}
                onChange={e => setDistrictSearch(e.target.value)}
                className='max-w-sm'
              />
              <div className='grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 max-h-[500px] overflow-y-auto pr-2'>
                {bdDistricts
                  .filter(d => d.name.toLowerCase().includes(districtSearch.toLowerCase()))
                  .map(d => (
                    <div key={d.slug} className='flex items-center gap-2 p-2 border rounded-lg hover:bg-muted/20'>
                      <span className='text-xs font-medium w-28 truncate shrink-0' title={d.name}>{d.name}</span>
                      <div className='flex items-center gap-1'>
                        <span className='text-xs text-muted-foreground'>৳</span>
                        <Input
                          className='h-8 w-20 text-xs'
                          type='number'
                          value={districtCharges[d.slug] ?? ''}
                          onChange={e => setDistrictCharges(prev => ({ ...prev, [d.slug]: e.target.value }))}
                          placeholder='60'
                        />
                      </div>
                    </div>
                  ))}
              </div>
              <p className='text-xs text-muted-foreground'>
                Showing {bdDistricts.filter(d => d.name.toLowerCase().includes(districtSearch.toLowerCase())).length} of {bdDistricts.length} districts.
                Empty fields will use the default delivery charge.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nav">
          <Card>
            <CardHeader>
              <CardTitle>Navigation Menu</CardTitle>
              <CardDescription>Header navigation items shown in the top bar. Add, edit, or reorder items below.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {navItems.map((item, i) => (
                <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
                  <div className='flex-1 grid grid-cols-1 md:grid-cols-2 gap-3'>
                    <div className='space-y-2'>
                      <Label>Label</Label>
                      <Input value={item.name} onChange={e => {
                        const next = [...navItems];
                        next[i] = { ...next[i], name: e.target.value };
                        setNavItems(next);
                      }} placeholder='New Arrivals' />
                    </div>
                    <div className='space-y-2'>
                      <Label>Link</Label>
                      <Input value={item.href} onChange={e => {
                        const next = [...navItems];
                        next[i] = { ...next[i], href: e.target.value };
                        setNavItems(next);
                      }} placeholder='/products?category=new' />
                    </div>
                  </div>
                  <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setNavItems(navItems.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button variant='outline' size='sm' onClick={() => setNavItems([...navItems, { name: '', href: '' }])}>
                + Add Item
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faq">
          <Card>
            <CardHeader>
              <CardTitle>FAQ Items</CardTitle>
              <CardDescription>Frequently asked questions shown on the FAQ page. Add, edit, or remove items below.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {faqItems.map((item, i) => (
                <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
                  <div className='flex-1 space-y-3'>
                    <div className='space-y-2'>
                      <Label>Question</Label>
                      <Input value={item.question} onChange={e => {
                        const next = [...faqItems];
                        next[i] = { ...next[i], question: e.target.value };
                        setFaqItems(next);
                      }} placeholder='How do I place an order?' />
                    </div>
                    <div className='space-y-2'>
                      <Label>Answer</Label>
                      <Textarea value={item.answer} onChange={e => {
                        const next = [...faqItems];
                        next[i] = { ...next[i], answer: e.target.value };
                        setFaqItems(next);
                      }} rows={3} placeholder='You can place an order through our website...' />
                    </div>
                  </div>
                  <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setFaqItems(faqItems.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button variant='outline' size='sm' onClick={() => setFaqItems([...faqItems, { question: '', answer: '' }])}>
                + Add FAQ
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hours">
          <Card>
            <CardHeader>
              <CardTitle>Operating Hours</CardTitle>
              <CardDescription>Store hours displayed on the support and stores pages.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='hours-label'>Hours Summary (shown as text)</Label>
                <Input id='hours-label' value={hoursLabel} onChange={e => setHoursLabel(e.target.value)} placeholder='Sat-Thu 10AM-10PM, Fri 3PM-10PM' />
              </div>
              <Separator />
              <h4 className='text-sm font-medium'>Daily Schedule</h4>
              {hoursDetails.map((h, i) => (
                <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
                  <div className='flex-1 grid grid-cols-1 md:grid-cols-2 gap-3'>
                    <div className='space-y-2'>
                      <Label>Day(s)</Label>
                      <Input value={h.day} onChange={e => {
                        const next = [...hoursDetails];
                        next[i] = { ...next[i], day: e.target.value };
                        setHoursDetails(next);
                      }} placeholder='Saturday - Thursday' />
                    </div>
                    <div className='space-y-2'>
                      <Label>Time</Label>
                      <Input value={h.time} onChange={e => {
                        const next = [...hoursDetails];
                        next[i] = { ...next[i], time: e.target.value };
                        setHoursDetails(next);
                      }} placeholder='10:00 AM - 10:00 PM' />
                    </div>
                  </div>
                  <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setHoursDetails(hoursDetails.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button variant='outline' size='sm' onClick={() => setHoursDetails([...hoursDetails, { day: '', time: '' }])}>
                + Add Schedule
              </Button>
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
              <Separator />
              <h3 className='text-lg font-semibold'>Company Information</h3>
              <div className='grid gap-6 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='company-name'>Company Name</Label>
                  <Input id='company-name' value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='company-registration'>Registration Number</Label>
                  <Input id='company-registration' value={companyRegistration} onChange={e => setCompanyRegistration(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='company-certifications'>Certifications</Label>
                  <Input id='company-certifications' value={companyCertifications} onChange={e => setCompanyCertifications(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='company-team-size'>Team Size</Label>
                  <Input id='company-team-size' value={companyTeamSize} onChange={e => setCompanyTeamSize(e.target.value)} />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='company-ceo-name'>CEO/Founder Name</Label>
                  <Input id='company-ceo-name' value={companyCeoName} onChange={e => setCompanyCeoName(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="brands">
          <Card>
            <CardHeader>
              <CardTitle>Store Brands / Systems</CardTitle>
              <CardDescription>Manage brand systems shown in the storefront header and footer. Each system can display a name, logo, or both.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {storeSystems.map((sys, idx) => (
                <div key={sys.id} className='flex items-start gap-3 rounded-lg border p-4 bg-muted/10'>
                  <div className='flex items-center gap-3 flex-1 flex-wrap'>
                    <div className='w-10 h-10 rounded border bg-background flex items-center justify-center overflow-hidden shrink-0'>
                      {sys.logo ? (
                        <SafeImage src={sys.logo} alt='' className='w-full h-full object-contain' />
                      ) : (
                        <Palette className='h-5 w-5 text-muted-foreground' />
                      )}
                    </div>
                    <div className='space-y-1.5 min-w-0 flex-1'>
                      <Input
                        value={sys.name}
                        onChange={e => {
                          const next = [...storeSystems]
                          next[idx] = { ...next[idx], name: e.target.value }
                          setStoreSystems(next)
                        }}
                        placeholder='System name'
                        className='h-8 text-sm'
                      />
                      <div className='flex items-center gap-2 flex-wrap'>
                        <select
                          value={sys.display}
                          onChange={e => {
                            const next = [...storeSystems]
                            next[idx] = { ...next[idx], display: e.target.value as 'name' | 'logo' | 'name+logo' }
                            setStoreSystems(next)
                          }}
                          className='h-8 rounded-md border border-input bg-background px-2 text-xs'
                        >
                          <option value='name'>Name only</option>
                          <option value='logo'>Logo only</option>
                          <option value='name+logo'>Name + Logo</option>
                        </select>
                        <Button
                          variant='outline' size='sm' className='h-8 text-xs'
                          onClick={() => {
                            setActiveSystemIdx(idx)
                            setSystemPickerOpen(true)
                          }}
                        >
                          {sys.logo ? 'Change Logo' : 'Add Logo'}
                        </Button>
                        {sys.logo && (
                          <Button
                            variant='ghost' size='sm' className='h-8 text-xs text-muted-foreground'
                            onClick={() => {
                              const next = [...storeSystems]
                              next[idx] = { ...next[idx], logo: '' }
                              setStoreSystems(next)
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                    <Button
                      variant='ghost' size='icon' className='h-8 w-8 shrink-0 text-destructive'
                      onClick={() => setStoreSystems(storeSystems.filter((_, i) => i !== idx))}
                    >
                      <X className='h-4 w-4' />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant='outline' size='sm' className='mt-2'
                onClick={() => setStoreSystems([...storeSystems, { id: crypto.randomUUID(), name: '', logo: '', display: 'name' }])}
              >
                <Plus className='h-4 w-4 mr-1' /> Add System
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <MediaPicker
        open={systemPickerOpen && activeSystemIdx !== null}
        onOpenChange={(v) => { setSystemPickerOpen(v); if (!v) setActiveSystemIdx(null) }}
        selected={activeSystemIdx !== null && storeSystems[activeSystemIdx]?.logo ? [storeSystems[activeSystemIdx].logo] : []}
        multiple={false}
        onSelect={(urls) => {
          if (activeSystemIdx === null) return
          const url = urls[urls.length - 1] || ''
          const next = [...storeSystems]
          next[activeSystemIdx] = { ...next[activeSystemIdx], logo: url }
          setStoreSystems(next)
          setSystemPickerOpen(false)
          setActiveSystemIdx(null)
        }}
      />

      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>
          Changes take effect immediately on the storefront. Refresh the storefront page to see updates.
        </div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Changes
        </Button>
      </div>

      <MediaPicker
        open={slidePickerOpen && activeSlideIndex !== null}
        onOpenChange={(v) => { setSlidePickerOpen(v); if (!v) setActiveSlideIndex(null) }}
        selected={activeSlideIndex !== null && heroSlides[activeSlideIndex]?.image ? [heroSlides[activeSlideIndex].image] : []}
        multiple={false}
        onSelect={(urls) => {
          if (activeSlideIndex === null) return
          const url = urls[urls.length - 1] || ''
          const next = [...heroSlides]
          next[activeSlideIndex] = { ...next[activeSlideIndex], image: url }
          setHeroSlides(next)
          setSlidePickerOpen(false)
          setActiveSlideIndex(null)
        }}
      />
      <MediaPicker
        open={secondaryPickerOpen}
        onOpenChange={setSecondaryPickerOpen}
        selected={secondaryBanner ? [secondaryBanner] : []}
        multiple={false}
        onSelect={(urls) => {
          setSecondaryBanner(urls[urls.length - 1] || '')
          setSecondaryPickerOpen(false)
        }}
      />
    </div>
  )
}
