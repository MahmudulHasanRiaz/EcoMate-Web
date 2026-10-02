import { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi, mediaUrl } from './api'
import {
  ACQUISITION_OPTIONS,
  CHANNEL_OPTIONS,
  type AcquisitionType,
  type ChannelV2,
  type SourcePlatformView,
} from './sales-channel-options'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { SafeImage } from '@/components/safe-image'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { normalizePhone } from '@/lib/phone-utils'
import { variantLabel, variantThumbUrl } from '@/lib/product-variant'
import { byExactMatchFirst } from '@/lib/search-products'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ArrowLeft, Package, Barcode, Plus, Trash2, X, User, Phone, Mail, MapPin, CreditCard, ShoppingCart, Tag, Minus, Search, FileText, Receipt, Layers } from 'lucide-react'
const nn = (v: number | string) => Number(v)

const fmt = (v: number | string) => nn(v).toFixed(2)

const ep = (p: any) => {
  if (p.type === 'variable' && p.variants?.length) {
    return Math.min(...p.variants.map((v: any) => nn(v.salePrice ?? v.price ?? 0)))
  }
  return nn(p.salePrice ?? p.basePrice ?? 0)
}

export function CreateOrder() {
  const navigate = useNavigate()

  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerCityId, setCustomerCityId] = useState('')
  const [customerZoneId, setCustomerZoneId] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerMatched, setCustomerMatched] = useState(false)
  const [searchingCustomer, setSearchingCustomer] = useState(false)
  const [customerResults, setCustomerResults] = useState<any[]>([])
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)

  const [cities, setCities] = useState<any[]>([])
  const [zones, setZones] = useState<any[]>([])
  const [shipZones, setShipZones] = useState<any[]>([])
  const [useDiffShipping, setUseDiffShipping] = useState(false)
  const [shipAddress, setShipAddress] = useState('')
  const [shipCityId, setShipCityId] = useState('')
  const [shipZoneId, setShipZoneId] = useState('')

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiClient.get('/system-settings').then(r => r.data),
    staleTime: 5 * 60_000,
  })

  const { data: shippingZones } = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: () => apiClient.get('/shipping-zones').then(r => (r.data as any[]) || []),
    staleTime: 5 * 60_000,
  })

  const [shippingChargeManuallyEdited, setShippingChargeManuallyEdited] = useState(false)

  const cityOptions = useMemo(() => {
    return (cities || []).map((c: any) => ({
      id: c.id,
      label: c.name,
    }))
  }, [cities])

  const zoneOptions = useMemo(() => {
    return (zones || []).map((z: any) => ({
      id: z.id,
      label: z.name,
    }))
  }, [zones])

  const shipZoneOptions = useMemo(() => {
    return (shipZones || []).map((z: any) => ({
      id: z.id,
      label: z.name,
    }))
  }, [shipZones])

  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const [cartItems, setCartItems] = useState<any[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productInputRef = useRef<HTMLInputElement>(null)

  const [shippingCharge, setShippingCharge] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [discountType, setDiscountType] = useState<'flat' | 'percentage'>('flat')

  // NOTE: the POS showroom is resolved server-side from the POS session, so
  // this form no longer loads or asks for it — the user is never asked for
  // something the system already knows.

  // ── Canonical sales-attribution dimensions ──────────────────────────────
  // Four INDEPENDENT facts. Every one is optional: an order is created even
  // when all four are left empty. Vocabulary comes from the backend registry,
  // so a new platform appears without a client change.
  const [channel, setChannel] = useState<ChannelV2>('MESSAGING')
  const [channelEntity, setChannelEntity] = useState('')
  const [sourceSlug, setSourceSlug] = useState('facebook')
  const [acquisitionType, setAcquisitionType] = useState<AcquisitionType | ''>('')

  // Messaging may only offer messaging-capable platforms. This is a
  // convenience; the backend re-validates and clears anything incompatible.
  const { data: messagingSources } = useQuery({
    queryKey: ['sales-channel', 'sources', 'MESSAGING'],
    queryFn: () =>
      apiClient
        .get<SourcePlatformView[]>('/sales-channel/sources', { params: { capability: 'MESSAGING' } })
        .then(r => r.data),
    staleTime: 5 * 60_000,
  })
  const { data: allSources } = useQuery({
    queryKey: ['sales-channel', 'sources'],
    queryFn: () =>
      apiClient.get<SourcePlatformView[]>('/sales-channel/sources').then(r => r.data),
    staleTime: 5 * 60_000,
  })

  const sourceOptions = channel === 'MESSAGING' ? (messagingSources ?? []) : (allSources ?? [])

  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentMode, setPaymentMode] = useState<'cod' | 'full' | 'partial'>('cod')
  const [partialAmount, setPartialAmount] = useState('')

  const [customerNotes, setCustomerNotes] = useState('')
  const [officeNotes, setOfficeNotes] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)

  const productSearchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const productDropdownRef = useRef<HTMLDivElement>(null)
  const customerDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiClient.get('/couriers/cities').then(r => setCities(r.data as any[])).catch(() => toast.error('Failed to fetch cities'))
  }, [])

  useEffect(() => {
    if (customerCityId) {
      apiClient.get(`/couriers/zones?cityId=${customerCityId}`).then(r => setZones(r.data as any[])).catch(() => {})
    } else {
      setZones([])
    }
  }, [customerCityId])

  useEffect(() => {
    if (shipCityId) {
      apiClient.get(`/couriers/zones?cityId=${shipCityId}`).then(r => setShipZones(r.data as any[])).catch(() => {})
    } else {
      setShipZones([])
    }
  }, [shipCityId])

  const activeCityId = useDiffShipping ? shipCityId : customerCityId
  useEffect(() => {
    if (!activeCityId || cities.length === 0) return
    const selectedCity = cities.find((c: any) => String(c.id) === String(activeCityId))
    if (!selectedCity) return

    let defaultCharge = 60
    if (sysSettings?.['delivery_charge']) {
      defaultCharge = Number(sysSettings['delivery_charge']) || 60
    }

    const cityName = (selectedCity.name || '').trim()
    const matchingZone = shippingZones?.find((z: any) =>
      z.isActive !== false && Array.isArray(z.districts) && z.districts.some((d: string) => d.toLowerCase() === cityName.toLowerCase())
    )

    if (matchingZone) {
      if (matchingZone.type === 'free_delivery') {
        defaultCharge = 0
      } else if (matchingZone.type === 'custom_amount' && matchingZone.amount != null) {
        defaultCharge = Number(matchingZone.amount)
      }
    } else if (sysSettings?.['district_charges']) {
      try {
        const dc = typeof sysSettings['district_charges'] === 'string'
          ? JSON.parse(sysSettings['district_charges'])
          : sysSettings['district_charges']
        if (dc && dc[cityName] !== undefined) {
          defaultCharge = Number(dc[cityName])
        }
      } catch {
        // ignore JSON parse error
      }
    }

    // Automatically populate delivery charge from default settings for this city
    setShippingCharge(String(defaultCharge))
    setShippingChargeManuallyEdited(false)
  }, [activeCityId, cities, sysSettings, shippingZones])

  useEffect(() => {
    const normalized = normalizePhone(customerPhone)
    if (!normalized || customerPhone.length < 11) {
      setSearchingCustomer(false)
      setCustomerMatched(false)
      setSelectedCustomerId(null)
      setCustomerResults([])
      setCustomerDropdownOpen(false)
      return
    }
    setSearchingCustomer(true)
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.get('/customers', { params: { search: normalized, perPage: 8 } })
        const customers = (res.data as any)?.data || []
        const matches = customers.filter((c: any) => {
          const cNormalized = normalizePhone(c.phoneNumber || '')
          return cNormalized === normalized
        })
        setCustomerResults(matches)
        setCustomerDropdownOpen(matches.length > 0)
        // Changing the phone invalidates any previously selected customer.
        setSelectedCustomerId(null)
        setCustomerMatched(false)
      } catch {
        setCustomerResults([])
        setCustomerDropdownOpen(false)
        setSelectedCustomerId(null)
        setCustomerMatched(false)
      } finally {
        setSearchingCustomer(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [customerPhone])

  const selectCustomer = (c: any) => {
    setSelectedCustomerId(c.id)
    setCustomerName(`${c.firstName || ''} ${c.lastName || ''}`.trim())
    setCustomerEmail(c.email || '')
    setCustomerAddress(c.address || '')
    if (c.cityId) {
      setCustomerCityId(String(c.cityId))
      if (c.zoneId) setCustomerZoneId(String(c.zoneId))
    } else if (c.city || c.district) {
      const match = cities.find((city: any) =>
        city.name?.toLowerCase() === (c.city || c.district || '').trim().toLowerCase()
      )
      if (match) setCustomerCityId(String(match.id))
    }
    setCustomerMatched(true)
    setCustomerDropdownOpen(false)
  }

  useEffect(() => {
    if (!productSearch || productSearch.length < 1) { setProductResults([]); setShowProductDropdown(false); return }
    setProductSearching(true)
    clearTimeout(productSearchRef.current)
    productSearchRef.current = setTimeout(() => {
      const params: any = { search: productSearch, perPage: 50 }
      apiClient.get('/products', { params })
        .then(r => { setProductResults(byExactMatchFirst<any>(r.data?.data || r.data || [], productSearch)); setShowProductDropdown(true) })
        .catch(() => {})
        .finally(() => setProductSearching(false))
    }, 300)
    return () => clearTimeout(productSearchRef.current)
  }, [productSearch])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleBarcodeSearch = (sku: string) => {
    const q = sku.trim()
    if (!q) return
    apiClient.get('/products', { params: { search: q, perPage: 50 } })
      .then(r => {
        const results = byExactMatchFirst<any>(r.data?.data || r.data || [], q)
        const exact = results.find((p: any) =>
          p.sku?.toLowerCase() === q.toLowerCase() ||
          p.variants?.some((v: any) => v.sku?.toLowerCase() === q.toLowerCase())
        )
        const target = exact || (results.length > 0 ? results[0] : null)
        if (target) {
          const matchedVariant = target.variants?.find((v: any) => v.sku?.toLowerCase() === q.toLowerCase())
          if (matchedVariant) {
            addToCart(target, matchedVariant)
            toast.success(`${target.name} (${matchedVariant.name || matchedVariant.sku}) added`)
          } else if (target.type === 'variable' || target.variants?.length > 0) {
            setSelectedProductForVariants(target)
          } else {
            addToCart(target)
            toast.success(`${target.name} added to cart`)
          }
          setProductSearch('')
          setShowProductDropdown(false)
        } else {
          toast.error('Product not found with this SKU/barcode')
        }
      })
      .catch(() => toast.error('Failed to search by barcode'))
  }

  const addToCart = (product: any, variant?: any) => {
    setCartItems(prev => {
      const existing = prev.findIndex(
        (i: any) => i.productId === product.id && (i.variantId || null) === (variant?.id || null)
      )
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + 1 }
        return updated
      }
      return [...prev, {
        productId: product.id,
        variantId: variant?.id || null,
        product: { ...product, name: variant ? `${product.name} (${variant.name || variant.sku})` : product.name },
        quantity: 1,
        price: parseFloat(variant?.salePrice ?? variant?.price ?? product.salePrice ?? product.basePrice ?? 0) || 0,
        variant: variant || null,
      }]
    })
  }

  const removeFromCart = (index: number) => {
    setCartItems(prev => prev.filter((_, i) => i !== index))
  }

  const updateCartQty = (index: number, qty: number) => {
    if (qty < 1) return
    setCartItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], quantity: qty }
      return updated
    })
  }

  const updateCartPrice = (index: number, price: number) => {
    const safePrice = Math.max(0, isNaN(price) ? 0 : price)
    setCartItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], price: safePrice }
      return updated
    })
  }

  const calculateSubtotal = () => cartItems.reduce((sum, item) => sum + nn(item.price) * item.quantity, 0)

  const calculateDiscountValue = () => {
    const subtotal = calculateSubtotal()
    const rawDiscount = parseFloat(discount) || 0
    if (rawDiscount <= 0) return 0
    if (discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, rawDiscount))
      return subtotal * (pct / 100)
    }
    return Math.min(subtotal, Math.max(0, rawDiscount))
  }

  const calculateTotal = () => {
    const subtotal = calculateSubtotal()
    const shipping = parseFloat(shippingCharge) || 0
    const disc = calculateDiscountValue()
    return Math.max(0, subtotal + shipping - disc)
  }

  const buildPayload = () => {
    const payload: any = {
      items: cartItems.map(item => ({
        productId: item.productId,
        quantity: parseInt(item.quantity as any) || 1,
        price: parseFloat(item.price as any) || 0,
        ...(item.variantId ? { variantId: item.variantId } : {}),
      })),
      shippingCharge: parseFloat(shippingCharge) || 0,
      discount: parseFloat(discount) || 0,
      discountType,
      // Canonical dimensions. Legacy salesChannel/sourcePlatform/sourceType/
      // sourceEntity are intentionally NOT sent by the manual form any more:
      // the canonical model supersedes them, and the backend still writes the
      // legacy columns from the canonical values.
      channel,
      ...(channelEntity ? { channelEntity } : {}),
      ...(sourceSlug ? { sourceSlug } : {}),
      ...(acquisitionType ? { acquisitionType } : {}),
      customerNotes: customerNotes || null,
      officeNotes: officeNotes || null,
      paymentOptionType: paymentMode === 'cod' ? 'CASH_ON_DELIVERY' : paymentMode === 'full' ? 'FULL_PAYMENT' : paymentMode === 'partial' ? 'PARTIAL_PAYMENT' : undefined,
      gatewayCode: paymentMethod || undefined,
    }

    if (paymentMode === 'partial' && partialAmount) {
      payload.partialAmount = parseFloat(partialAmount)
    }

    const normalizedPhone = normalizePhone(customerPhone)
    if (customerName) payload.guestName = customerName
    if (normalizedPhone) payload.guestPhone = normalizedPhone
    if (customerEmail) payload.guestEmail = customerEmail
    if (selectedCustomerId) {
      payload.customerId = selectedCustomerId
    }

    const shipAddr = useDiffShipping ? shipAddress : customerAddress
    const shipCity = useDiffShipping ? shipCityId : customerCityId
    const shipZone = useDiffShipping ? shipZoneId : customerZoneId
    const selectedCity = cities.find((c: any) => String(c.id) === String(shipCity))
    if (selectedCity?.name) {
      payload.district = selectedCity.name
    }
    if (shipAddr || shipCity) {
      payload.shippingAddress = {
        address: shipAddr,
        cityId: shipCity || undefined,
        zoneId: shipZone || undefined,
        district: selectedCity?.name || undefined,
        city: selectedCity?.name || undefined,
      }
    }

    return payload
  }

  const createMut = useMutation({
    mutationFn: (data: any) => ordersApi.create(data),
    onSuccess: (res: any) => {
      const orderId = res.data?.id || res.id
      const warnings: string[] = res.data?.warnings || res.warnings || []
      if (warnings.length > 0) {
        toast.warning(
          warnings.join('\n'),
          { duration: 8000 },
        )
      }
      toast.success('Order created successfully')
      navigate({ to: '/op/orders/$id', params: { id: orderId } })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to create order')
    },
  })

  const handleSubmit = async () => {
    if (cartItems.length === 0) {
      toast.error('Add at least one item to the cart')
      return
    }
    const normalizedPhone = normalizePhone(customerPhone)
    if (!normalizedPhone || normalizedPhone.length < 11) {
      toast.error('Enter a valid 11-digit phone number (e.g. 01712345678)')
      return
    }
    if (!customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    if (paymentMode === 'partial') {
      const pAmt = parseFloat(partialAmount) || 0
      if (!partialAmount || pAmt <= 0) {
        toast.error('Enter a valid partial advance amount')
        return
      }
      if (pAmt >= total) {
        toast.error('Advance amount must be less than order total (use Full Payment instead)')
        return
      }
    }
    createMut.mutate(buildPayload())
  }

  const subtotal = calculateSubtotal()
  const discountValue = calculateDiscountValue()
  const total = calculateTotal()

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' className='h-8 px-2 sm:px-3 text-xs sm:text-sm' onClick={() => navigate({ to: '/op/orders' })}>
            <ArrowLeft className='h-4 w-4 mr-1 shrink-0' />
            <span className='hidden sm:inline'>Back to </span>Orders
          </Button>
        </div>
        <div className='ml-auto flex items-center gap-2'>
          <ThemeSwitch /><ProfileDropdown />
        </div>
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 p-3 sm:p-6 max-w-7xl mx-auto w-full pb-24 sm:pb-8'>
        {/* Page Header */}
        <div className='flex items-center justify-between gap-3 pb-1 border-b border-border/40'>
          <div>
            <h1 className='text-xl sm:text-2xl font-bold tracking-tight text-foreground'>Create New Order</h1>
            <p className='text-xs sm:text-sm text-muted-foreground mt-0.5'>
              Add customer details, select products, configure shipping and payment options
            </p>
          </div>
          <div className='hidden sm:flex items-center gap-2'>
            <Button
              size='sm'
              className='h-9 px-4 font-semibold text-xs shadow-xs'
              onClick={handleSubmit}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1.5' /> : <Plus className='h-3.5 w-3.5 mr-1.5' />}
              Create Order
            </Button>
          </div>
        </div>

        {/* ── Main Grid ── */}
        <div className='grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-6 items-start'>

          {/* ════ LEFT COLUMN (Customer, Items, Notes) ════ */}
          <div className='xl:col-span-7 2xl:col-span-8 space-y-4 sm:space-y-6'>

            {/* Customer Information Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2.5'>
                    <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                      <Phone className='h-4 w-4' />
                    </div>
                    <div>
                      <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground flex items-center gap-2'>
                        Customer Information
                        {customerMatched && (
                          <Badge variant='secondary' className='text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium'>
                            Existing Customer
                          </Badge>
                        )}
                      </CardTitle>
                      <p className='text-xs text-muted-foreground mt-0.5'>Search by phone or type new customer details</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-4'>
                <div className='relative' ref={customerDropdownRef}>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Customer Phone *</Label>
                  <div className='relative'>
                    <Phone className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                    <Input
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      onFocus={() => { if (customerResults.length > 0) setCustomerDropdownOpen(true) }}
                      placeholder='Phone number (e.g. 01712345678)'
                      className='pl-9 h-10 text-sm'
                    />
                    {searchingCustomer && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
                  </div>
                  {customerDropdownOpen && customerResults.length > 0 && (
                    <div className='absolute z-30 mt-1.5 w-full bg-background border rounded-xl shadow-xl overflow-hidden'>
                      <div className='px-3.5 py-1.5 bg-muted/40 border-b text-[11px] text-muted-foreground font-medium'>
                        Matching Customers ({customerResults.length})
                      </div>
                      <div className='max-h-60 overflow-y-auto divide-y divide-border/50'>
                        {customerResults.map(c => (
                          <button
                            key={c.id}
                            type='button'
                            className='w-full text-left px-3.5 py-2.5 text-sm hover:bg-muted/70 flex items-center gap-2 transition-colors'
                            onClick={() => selectCustomer(c)}
                          >
                            <div className='min-w-0 flex-1'>
                              <p className='text-sm font-semibold truncate'>{(c.firstName || c.lastName) ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : 'Customer'}</p>
                              <p className='text-xs text-muted-foreground truncate'>{c.phoneNumber}{c.address ? ` · ${c.address}` : ''}</p>
                            </div>
                            <User className='h-4 w-4 text-muted-foreground shrink-0' />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {customerMatched && (
                    <p className='text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium'>
                      ✓ Auto-filled information for {customerName}
                    </p>
                  )}
                  {customerPhone.length >= 11 && !customerMatched && !searchingCustomer && !customerDropdownOpen && (
                    <p className='text-xs text-muted-foreground mt-1'>
                      No existing record found. A new customer profile will be created with this number.
                    </p>
                  )}
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Full Name *</Label>
                    <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder='Customer name' className='h-9.5 text-sm' />
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Email (Optional)</Label>
                    <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder='customer@example.com' className='h-9.5 text-sm' />
                  </div>
                </div>

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Delivery Address</Label>
                  <Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} rows={2} placeholder='House/Road, Village/Area...' className='text-sm resize-none' />
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>City / District</Label>
                    <SearchableSelect
                      options={cityOptions}
                      value={customerCityId}
                      onChange={val => { setCustomerCityId(val); setCustomerZoneId('') }}
                      placeholder='Select city...'
                      searchPlaceholder='Search cities...'
                    />
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Courier Delivery Zone</Label>
                    <SearchableSelect
                      options={zoneOptions}
                      value={customerZoneId}
                      onChange={setCustomerZoneId}
                      placeholder='Select zone...'
                      searchPlaceholder='Search zones...'
                      disabled={!customerCityId}
                    />
                  </div>
                </div>

                <div className='pt-1'>
                  <label htmlFor='diffShipping' className='inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground'>
                    <input
                      type='checkbox'
                      id='diffShipping'
                      checked={useDiffShipping}
                      onChange={e => setUseDiffShipping(e.target.checked)}
                      className='h-4 w-4 rounded border-border text-primary focus:ring-primary/20'
                    />
                    Deliver to a different shipping address
                  </label>
                </div>

                {useDiffShipping && (
                  <div className='p-3.5 bg-muted/30 border border-border/60 rounded-xl space-y-3 pt-3'>
                    <div className='flex items-center gap-1.5 text-xs font-semibold text-foreground'>
                      <MapPin className='h-3.5 w-3.5 text-primary' />
                      Alternative Shipping Destination
                    </div>
                    <div>
                      <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping Address</Label>
                      <Textarea value={shipAddress} onChange={e => setShipAddress(e.target.value)} rows={2} placeholder='Different recipient address...' className='text-sm resize-none' />
                    </div>
                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                      <div>
                        <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping City</Label>
                        <SearchableSelect
                          options={cityOptions}
                          value={shipCityId}
                          onChange={val => { setShipCityId(val); setShipZoneId('') }}
                          placeholder='Select city...'
                          searchPlaceholder='Search cities...'
                        />
                      </div>
                      <div>
                        <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping Zone</Label>
                        <SearchableSelect
                          options={shipZoneOptions}
                          value={shipZoneId}
                          onChange={setShipZoneId}
                          placeholder='Select zone...'
                          searchPlaceholder='Search zones...'
                          disabled={!shipCityId}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ordered Items Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2.5'>
                    <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                      <Package className='h-4 w-4' />
                    </div>
                    <div>
                      <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground flex items-center gap-2'>
                        Ordered Items
                        <Badge variant='secondary' className='text-[11px] font-medium px-2 py-0.5 rounded-full'>
                          {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} ({cartItems.reduce((acc, i) => acc + i.quantity, 0)} units)
                        </Badge>
                      </CardTitle>
                      <p className='text-xs text-muted-foreground mt-0.5'>Search products, adjust unit prices and quantities</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-4'>
                {/* Unified Smart Search Bar */}
                <div className='relative' ref={productDropdownRef}>
                  <div className='relative flex items-center'>
                    <Search className='absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10' />
                    <input
                      ref={productInputRef}
                      type='text'
                      value={productSearch}
                      onChange={e => {
                        setProductSearch(e.target.value)
                        if (!e.target.value) setShowProductDropdown(false)
                      }}
                      onFocus={() => {
                        if (productResults.length > 0) setShowProductDropdown(true)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && productSearch.trim()) {
                          const localExact = productResults.find((p: any) =>
                            p.sku?.toLowerCase() === productSearch.trim().toLowerCase() ||
                            p.variants?.some((v: any) => v.sku?.toLowerCase() === productSearch.trim().toLowerCase())
                          )
                          if (localExact) {
                            const matchedVariant = localExact.variants?.find((v: any) => v.sku?.toLowerCase() === productSearch.trim().toLowerCase())
                            if (matchedVariant) {
                              addToCart(localExact, matchedVariant)
                              toast.success(`${localExact.name} (${matchedVariant.name || matchedVariant.sku}) added`)
                              setProductSearch('')
                              setShowProductDropdown(false)
                            } else if (localExact.type === 'variable' || localExact.variants?.length > 0) {
                              setSelectedProductForVariants(localExact)
                              setProductSearch('')
                              setShowProductDropdown(false)
                            } else {
                              addToCart(localExact)
                              toast.success(`${localExact.name} added`)
                              setProductSearch('')
                              setShowProductDropdown(false)
                            }
                          } else {
                            handleBarcodeSearch(productSearch.trim())
                          }
                        }
                        if (e.key === 'Escape') setShowProductDropdown(false)
                      }}
                      placeholder='Search by product name, SKU or scan barcode...'
                      className='w-full h-11 pl-10 pr-10 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring shadow-2xs'
                      autoComplete='off'
                    />
                    {productSearching ? (
                      <Loader2 className='absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />
                    ) : productSearch ? (
                      <button
                        type='button'
                        onClick={() => { setProductSearch(''); setShowProductDropdown(false) }}
                        className='absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    ) : null}
                  </div>

                  {/* Dropdown Menu */}
                  {showProductDropdown && productResults.length > 0 && (
                    <div className='absolute z-30 mt-1.5 w-full bg-background border rounded-xl shadow-xl overflow-hidden'>
                      <div className='px-3.5 py-2 bg-muted/40 border-b flex items-center justify-between text-xs text-muted-foreground'>
                        <span>{productResults.length} product{productResults.length > 1 ? 's' : ''} found</span>
                        <span className='text-[11px] hidden sm:inline'>Tap product to add or select variant</span>
                      </div>
                      <div className='max-h-72 sm:max-h-80 overflow-y-auto divide-y divide-border/50'>
                        {productResults.map((p: any) => {
                          const isVariable = p.type === 'variable' || (p.variants && p.variants.length > 0)
                          return (
                            <div
                              key={p.id}
                              className='w-full p-2.5 sm:p-3 hover:bg-muted/60 transition-colors flex items-center gap-3 cursor-pointer'
                              onClick={() => {
                                if (isVariable) {
                                  setSelectedProductForVariants(p)
                                } else {
                                  addToCart(p)
                                  toast.success(`${p.name} added to cart`)
                                }
                                setProductSearch('')
                                setShowProductDropdown(false)
                              }}
                            >
                              {p.images && Array.isArray(p.images) && p.images[0] ? (
                                <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-11 w-11 rounded-lg border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                              ) : (
                                <div className='h-11 w-11 rounded-lg border bg-muted flex items-center justify-center shrink-0'>
                                  <Package className='h-5 w-5 text-muted-foreground' />
                                </div>
                              )}
                              <div className='min-w-0 flex-1'>
                                <p className='text-sm font-semibold text-foreground line-clamp-2 leading-snug'>{p.name}</p>
                                <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
                                  {p.sku && (
                                    <span className='text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                                      {p.sku}
                                    </span>
                                  )}
                                  {isVariable && (
                                    <Badge variant='outline' className='text-[10px] h-4.5 font-normal border-primary/30 text-primary'>
                                      {p.variants?.length} options
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className='text-right shrink-0'>
                                <div className='text-sm font-bold text-primary'>৳{fmt(ep(p))}</div>
                                <Button
                                  size='sm'
                                  variant={isVariable ? 'outline' : 'secondary'}
                                  className='h-7 text-xs px-2.5 mt-1'
                                >
                                  {isVariable ? 'Choose' : '+ Add'}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Cart Area */}
                {cartItems.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-12 border border-dashed rounded-xl text-muted-foreground bg-muted/10'>
                    <ShoppingCart className='h-12 w-12 mb-2 opacity-20' />
                    <p className='text-sm font-medium'>No products in this order</p>
                    <p className='text-xs text-muted-foreground mt-0.5'>Search and select items above to add to cart</p>
                  </div>
                ) : (
                  <div className='border border-border/70 rounded-xl overflow-hidden'>
                    {/* Desktop Table View */}
                    <div className='hidden md:block overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow className='bg-muted/20 border-b border-border/50'>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 px-4'>Product</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9'>Variant</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 text-right w-28'>Unit Price (৳)</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 text-right w-28'>Quantity</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 text-right w-28'>Total</TableHead>
                            <TableHead className='w-10'></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cartItems.map((item, index) => (
                            <TableRow key={`${item.productId}-${item.variantId || ''}-${index}`} className='hover:bg-muted/30 transition-colors'>
                              <TableCell className='px-4 py-3'>
                                <div className='flex items-center gap-2.5'>
                                  {item.product.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                                    <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-9 w-9 rounded-md border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                                  ) : (
                                    <div className='h-9 w-9 rounded-md border bg-muted flex items-center justify-center shrink-0'><Package className='h-4 w-4 text-muted-foreground' /></div>
                                  )}
                                  <span className='text-sm font-semibold truncate max-w-[200px] text-foreground'>{item.product.name}</span>
                                </div>
                              </TableCell>
                              <TableCell className='text-sm text-muted-foreground'>
                                {item.variant?.name || (item.variantId ? item.variant?.sku || '—' : '—')}
                              </TableCell>
                              <TableCell className='text-right'>
                                <Input
                                  type='number'
                                  value={item.price}
                                  onChange={e => updateCartPrice(index, parseFloat(e.target.value) || 0)}
                                  className='w-20 text-right h-8 text-sm ml-auto'
                                  step='0.01'
                                />
                              </TableCell>
                              <TableCell className='text-right'>
                                <div className='flex items-center justify-end gap-1'>
                                  <Button variant='outline' size='icon' className='h-7 w-7' onClick={() => updateCartQty(index, item.quantity - 1)}>
                                    <Minus className='h-3 w-3' />
                                  </Button>
                                  <span className='w-8 text-center text-sm font-bold'>{item.quantity}</span>
                                  <Button variant='outline' size='icon' className='h-7 w-7' onClick={() => updateCartQty(index, item.quantity + 1)}>
                                    <Plus className='h-3 w-3' />
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell className='text-right text-sm font-bold text-foreground'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                              <TableCell>
                                <Button variant='ghost' size='icon' className='h-8 w-8 text-destructive hover:bg-destructive/10' onClick={() => removeFromCart(index)}>
                                  <Trash2 className='h-4 w-4' />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile Cart Cards View */}
                    <div className='block md:hidden divide-y divide-border/60'>
                      {cartItems.map((item, index) => (
                        <div key={`${item.productId}-${item.variantId || ''}-${index}`} className='p-3 space-y-2.5'>
                          <div className='flex items-start justify-between gap-2'>
                            <div className='flex items-center gap-2.5 min-w-0 flex-1'>
                              {item.product.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                                <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-11 w-11 rounded-lg border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                              ) : (
                                <div className='h-11 w-11 rounded-lg border bg-muted flex items-center justify-center shrink-0'>
                                  <Package className='h-5 w-5 text-muted-foreground' />
                                </div>
                              )}
                              <div className='min-w-0 flex-1'>
                                <p className='text-xs font-semibold text-foreground line-clamp-1'>{item.product.name}</p>
                                {(item.variant?.name || item.variantId) && (
                                  <Badge variant='outline' className='text-[10px] mt-0.5 font-normal'>
                                    {item.variant?.name || item.variant?.sku || 'Variant'}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0'
                              onClick={() => removeFromCart(index)}
                            >
                              <Trash2 className='h-4 w-4' />
                            </Button>
                          </div>

                          <div className='flex items-center justify-between gap-2 pt-1 border-t border-border/40 text-xs'>
                            <div className='flex items-center gap-1.5'>
                              <span className='text-muted-foreground'>৳</span>
                              <Input
                                type='number'
                                value={item.price}
                                onChange={e => updateCartPrice(index, parseFloat(e.target.value) || 0)}
                                className='w-20 text-right h-8 text-xs font-medium'
                                step='0.01'
                              />
                            </div>

                            <div className='flex items-center gap-1'>
                              <Button
                                variant='outline'
                                size='icon'
                                className='h-8 w-8'
                                onClick={() => updateCartQty(index, item.quantity - 1)}
                              >
                                <Minus className='h-3.5 w-3.5' />
                              </Button>
                              <span className='w-7 text-center text-xs font-bold'>{item.quantity}</span>
                              <Button
                                variant='outline'
                                size='icon'
                                className='h-8 w-8'
                                onClick={() => updateCartQty(index, item.quantity + 1)}
                              >
                                <Plus className='h-3.5 w-3.5' />
                              </Button>
                            </div>

                            <div className='text-right'>
                              <span className='font-bold text-sm text-foreground'>৳{fmt(nn(item.price) * item.quantity)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Order Notes Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <FileText className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Order Notes
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Invoice instructions and internal staff notes</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-3.5'>
                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Customer Notes (Printed on Customer Invoice)</Label>
                  <Textarea
                    value={customerNotes}
                    onChange={e => setCustomerNotes(e.target.value)}
                    rows={2}
                    className='text-sm resize-none'
                    placeholder='Special delivery instructions, timing or customer requests...'
                  />
                </div>
                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Office Notes (Internal Staff Only)</Label>
                  <Textarea
                    value={officeNotes}
                    onChange={e => setOfficeNotes(e.target.value)}
                    rows={2}
                    className='text-sm resize-none'
                    placeholder='Internal remarks, confirmation details, packaging notes...'
                  />
                  <p className='text-[11px] text-muted-foreground mt-1'>
                    Internal note will be automatically combined with the system default office note.
                  </p>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* ════ RIGHT COLUMN (Sidebar: Summary, Payment, Attribution) ════ */}
          <div className='xl:col-span-5 2xl:col-span-4 space-y-4 sm:space-y-6'>

            {/* Order Summary Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <Receipt className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Order Summary
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Pricing, delivery charges, and discounts</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-4'>
                <div className='bg-muted/50 rounded-xl p-3.5 space-y-2 text-sm border border-border/40'>
                  <div className='flex justify-between items-center'>
                    <span className='text-muted-foreground'>Subtotal</span>
                    <span className='font-medium text-foreground'>৳{fmt(subtotal)}</span>
                  </div>
                  <div className='flex justify-between items-center'>
                    <span className='text-muted-foreground'>Delivery Charge</span>
                    <span className='font-medium text-foreground'>+৳{fmt(parseFloat(shippingCharge) || 0)}</span>
                  </div>
                  {discountValue > 0 && (
                    <div className='flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-medium'>
                      <span>Discount {discountType === 'percentage' ? `(${parseFloat(discount) || 0}%)` : '(Flat)'}</span>
                      <span>-৳{fmt(discountValue)}</span>
                    </div>
                  )}
                  <div className='flex justify-between items-center font-bold text-base pt-2.5 border-t border-border/60'>
                    <span>Total Amount</span>
                    <span className='text-primary text-lg font-extrabold'>৳{fmt(total)}</span>
                  </div>
                  {paymentMode === 'partial' && parseFloat(partialAmount) > 0 && (
                    <div className='pt-2 border-t border-dashed border-border/60 space-y-1.5'>
                      <div className='flex justify-between items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium'>
                        <span>Advance Paid (Now)</span>
                        <span>-৳{fmt(parseFloat(partialAmount) || 0)}</span>
                      </div>
                      <div className='flex justify-between items-center text-sm font-bold text-amber-600 dark:text-amber-500 bg-amber-500/10 dark:bg-amber-500/15 p-2 rounded-lg border border-amber-500/20'>
                        <span>Due on Delivery (COD)</span>
                        <span className='text-base font-extrabold'>
                          ৳{fmt(Math.max(0, total - (parseFloat(partialAmount) || 0)))}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping Charge (৳)</Label>
                    <Input
                      type='number'
                      step='0.01'
                      value={shippingCharge}
                      onChange={e => {
                        setShippingChargeManuallyEdited(true)
                        setShippingCharge(e.target.value)
                      }}
                      className='h-9.5 text-sm'
                    />
                    <p className='text-[11px] text-muted-foreground mt-1'>
                      {shippingChargeManuallyEdited ? 'Custom rate applied' : 'Auto-calculated from city'}
                    </p>
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Discount</Label>
                    <div className='flex gap-1.5'>
                      <Input
                        type='number'
                        step='0.01'
                        value={discount}
                        onChange={e => setDiscount(e.target.value)}
                        className='h-9.5 text-sm flex-1'
                        placeholder='0.00'
                      />
                      <div className='flex border rounded-lg p-0.5 bg-muted/40 shrink-0'>
                        <Button
                          type='button'
                          variant={discountType === 'flat' ? 'default' : 'ghost'}
                          size='sm'
                          className='h-8 px-2.5 text-xs'
                          onClick={() => setDiscountType('flat')}
                        >
                          Flat
                        </Button>
                        <Button
                          type='button'
                          variant={discountType === 'percentage' ? 'default' : 'ghost'}
                          size='sm'
                          className='h-8 px-2.5 text-xs'
                          onClick={() => setDiscountType('percentage')}
                        >
                          %
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment Details Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <CreditCard className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Payment Details
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Select payment gateway and payment mode</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-3.5'>
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Payment Method</Label>
                    <select
                      className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                      value={paymentMethod}
                      onChange={e => setPaymentMethod(e.target.value)}
                    >
                      <option value='cash'>Cash</option>
                      <option value='bkash'>bKash</option>
                      <option value='nagad'>Nagad</option>
                      <option value='bank'>Bank Transfer</option>
                      <option value='card'>Card</option>
                    </select>
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Payment Mode</Label>
                    <select
                      className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                      value={paymentMode}
                      onChange={e => setPaymentMode(e.target.value as any)}
                    >
                      <option value='cod'>Cash on Delivery (COD)</option>
                      <option value='full'>Full Payment</option>
                      <option value='partial'>Partial Payment (Advance)</option>
                    </select>
                  </div>
                </div>
                {paymentMode === 'partial' && (
                  <div className='p-3.5 bg-muted/40 rounded-xl border border-border/60 space-y-2'>
                    <div>
                      <Label className='text-xs font-semibold block text-foreground mb-1'>Advance Paid Amount (৳) *</Label>
                      <Input
                        type='number'
                        step='0.01'
                        value={partialAmount}
                        onChange={e => setPartialAmount(e.target.value)}
                        className='h-9.5 text-sm bg-background'
                        placeholder='Amount collected in advance'
                      />
                    </div>
                    <p className='text-xs text-muted-foreground leading-relaxed'>
                      Advance of ৳{fmt(parseFloat(partialAmount) || 0)} will be recorded as paid now. Balance of ৳{fmt(Math.max(0, total - (parseFloat(partialAmount) || 0)))} will be assigned to courier collection.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sales Channel & Attribution Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <Layers className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Sales Attribution
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Order origin channel and acquisition source</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-3.5'>
                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Channel</Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={channel}
                    onChange={e => {
                      const val = e.target.value as ChannelV2
                      setChannel(val)
                      if (val === 'MESSAGING') setSourceSlug('facebook')
                      else setSourceSlug('')
                      if (val === 'POS') setAcquisitionType('')
                    }}
                  >
                    {CHANNEL_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {channel !== 'POS' && (
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                      Channel Entity <span className='text-muted-foreground/70 font-normal'>(optional)</span>
                    </Label>
                    <Input
                      value={channelEntity}
                      onChange={e => setChannelEntity(e.target.value)}
                      className='h-9.5 text-sm'
                      placeholder={
                        channel === 'WEBSITE' ? 'Auto-filled from connected store'
                        : channel === 'MESSAGING' ? 'Page or account'
                        : 'Office'
                      }
                    />
                  </div>
                )}

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Source <span className='text-muted-foreground/70 font-normal'>(optional)</span>
                  </Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={sourceSlug}
                    onChange={e => setSourceSlug(e.target.value)}
                  >
                    <option value=''>— none —</option>
                    {sourceOptions.map(s => (
                      <option key={s.slug} value={s.slug}>{s.displayName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Acquisition Type <span className='text-muted-foreground/70 font-normal'>(optional)</span>
                  </Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={acquisitionType}
                    onChange={e =>
                      setAcquisitionType(e.target.value as AcquisitionType | '')
                    }
                  >
                    <option value=''>— not set —</option>
                    {ACQUISITION_OPTIONS.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Desktop Create Order CTA */}
            <div className='hidden sm:block pt-1'>
              <Button
                className='w-full h-11 text-sm font-semibold shadow-xs'
                size='lg'
                onClick={handleSubmit}
                disabled={createMut.isPending}
              >
                {createMut.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-2' /> : <Plus className='h-4 w-4 mr-2' />}
                Create Order
              </Button>
            </div>

          </div>
        </div>
      </Main>

      {/* ── Mobile Sticky Bottom Action Bar ── */}
      <div className='fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-t border-border/70 p-3 sm:hidden shadow-lg flex items-center justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <span className='text-[10px] uppercase font-semibold text-muted-foreground block tracking-wider leading-none'>Total</span>
          <span className='text-base font-extrabold text-primary leading-tight block mt-0.5'>৳{fmt(total)}</span>
          {paymentMode === 'partial' && parseFloat(partialAmount) > 0 && (
            <span className='text-[10px] text-amber-600 dark:text-amber-500 font-semibold block leading-none truncate'>
              Due: ৳{fmt(Math.max(0, total - (parseFloat(partialAmount) || 0)))}
            </span>
          )}
        </div>
        <Button
          className='h-11 px-6 font-semibold text-sm shadow-sm shrink-0'
          onClick={handleSubmit}
          disabled={createMut.isPending}
        >
          {createMut.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-1.5' /> : <Plus className='h-4 w-4 mr-1.5' />}
          Create Order
        </Button>
      </div>

      <Dialog open={!!selectedProductForVariants} onOpenChange={() => setSelectedProductForVariants(null)}>
        <DialogContent className='max-w-md w-[95vw] sm:w-full max-h-[85vh] flex flex-col p-4 sm:p-6'>
          <DialogHeader className='pb-2 text-left'>
            <DialogTitle className='text-base sm:text-lg'>Select Variant</DialogTitle>
            <DialogDescription className='text-xs'>
              {selectedProductForVariants?.name}
            </DialogDescription>
          </DialogHeader>
          <div className='flex-1 overflow-y-auto space-y-2 py-2 -mx-1 px-1 max-h-[55vh] divide-y divide-border/40'>
            {selectedProductForVariants?.variants?.map((v: any) => {
              const label = variantLabel(v)
              const price = v.salePrice ?? v.price ?? ep(selectedProductForVariants)
              const thumb = variantThumbUrl(v, selectedProductForVariants)
              return (
                <div
                  key={v.id}
                  className='flex items-center justify-between p-2.5 sm:p-3 border rounded-lg hover:bg-muted/70 active:bg-muted transition-colors cursor-pointer gap-2.5 min-h-[52px]'
                  onClick={() => {
                    addToCart(selectedProductForVariants, v)
                    setSelectedProductForVariants(null)
                    toast.success(`${selectedProductForVariants.name} (${label}) added to cart`)
                  }}
                >
                  <div className='flex items-center gap-2.5 min-w-0 flex-1'>
                    {thumb ? (
                      <SafeImage src={mediaUrl(thumb)} alt='' className='h-10 w-10 rounded-md border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                    ) : (
                      <div className='h-10 w-10 rounded-md border bg-muted flex items-center justify-center shrink-0'>
                        <Package className='h-5 w-5 text-muted-foreground' />
                      </div>
                    )}
                    <div className='min-w-0 flex-1'>
                      <p className='text-sm font-semibold text-foreground truncate'>{label}</p>
                      <p className='text-xs font-mono text-muted-foreground truncate'>{v.sku || 'No SKU'}</p>
                    </div>
                  </div>
                  <div className='text-right shrink-0'>
                    <div className='text-sm font-bold text-primary'>৳{fmt(price)}</div>
                    <Button size='sm' variant='secondary' className='h-6 text-[11px] px-2 mt-1'>
                      + Select
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <DialogFooter className='pt-2 border-t flex flex-row justify-end'>
            <Button variant='outline' size='sm' className='w-full sm:w-auto' onClick={() => setSelectedProductForVariants(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
