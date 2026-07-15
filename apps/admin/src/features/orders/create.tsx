import { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi, mediaUrl } from './api'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { SafeImage } from '@/components/safe-image'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { normalizePhone } from '@/lib/phone-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ArrowLeft, Package, Barcode, Plus, Trash2, X, User, Phone, Mail, MapPin, CreditCard, ShoppingCart, Tag, Minus } from 'lucide-react'
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

  const [cities, setCities] = useState<any[]>([])
  const [zones, setZones] = useState<any[]>([])
  const [shipZones, setShipZones] = useState<any[]>([])
  const [useDiffShipping, setUseDiffShipping] = useState(false)
  const [shipAddress, setShipAddress] = useState('')
  const [shipCityId, setShipCityId] = useState('')
  const [shipZoneId, setShipZoneId] = useState('')

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
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [categories, setCategories] = useState<any[]>([])
  const [cartItems, setCartItems] = useState<any[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const productInputRef = useRef<HTMLInputElement>(null)

  const [shippingCharge, setShippingCharge] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [discountType, setDiscountType] = useState<'flat' | 'percentage'>('flat')
  const [salesChannel, setSalesChannel] = useState('WEBSITE')

  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentMode, setPaymentMode] = useState<'cod' | 'full' | 'partial'>('cod')
  const [partialAmount, setPartialAmount] = useState('')

  const [customerNotes, setCustomerNotes] = useState('')
  const [officeNotes, setOfficeNotes] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)

  const customerSearchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const productSearchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const productDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiClient.get('/categories').then(r => setCategories(r.data as any[])).catch(() => toast.error('Failed to load categories'))
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

  useEffect(() => {
    const normalized = normalizePhone(customerPhone)
    if (!normalized || customerPhone.length < 11) {
      setSearchingCustomer(false)
      setCustomerMatched(false)
      setSelectedCustomerId(null)
      return
    }
    setSearchingCustomer(true)
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.get('/customers', { params: { search: normalized, perPage: 5 } })
        const customers = (res.data as any)?.data || []
        const match = customers.find((c: any) => {
          const cNormalized = normalizePhone(c.phoneNumber || '')
          return cNormalized === normalized
        }) || null
        if (match) {
          setSelectedCustomerId(match.id)
          setCustomerName(`${match.firstName || ''} ${match.lastName || ''}`.trim())
          setCustomerEmail(match.email || '')
          setCustomerAddress(match.address || '')
          setCustomerMatched(true)
        } else {
          setSelectedCustomerId(null)
          setCustomerMatched(false)
        }
      } catch {
        setCustomerMatched(false)
        setSelectedCustomerId(null)
      } finally {
        setSearchingCustomer(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [customerPhone])

  useEffect(() => {
    if (!productSearch || productSearch.length < 1) { setProductResults([]); setShowProductDropdown(false); return }
    setProductSearching(true)
    clearTimeout(productSearchRef.current)
    productSearchRef.current = setTimeout(() => {
      const params: any = { search: productSearch, perPage: 12 }
      if (selectedCategoryId) params.categoryId = selectedCategoryId
      apiClient.get('/products', { params })
        .then(r => { setProductResults(r.data?.data || r.data || []); setShowProductDropdown(true) })
        .catch(() => {})
        .finally(() => setProductSearching(false))
    }, 300)
    return () => clearTimeout(productSearchRef.current)
  }, [productSearch, selectedCategoryId])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleBarcodeSearch = (sku: string) => {
    const q = sku.trim()
    if (!q) return
    apiClient.get('/products', { params: { search: q, perPage: 5 } })
      .then(r => {
        const results = r.data?.data || r.data || []
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
        price: variant?.salePrice ?? variant?.price ?? product.salePrice ?? product.basePrice ?? 0,
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
    setCartItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], price }
      return updated
    })
  }

  const calculateSubtotal = () => cartItems.reduce((sum, item) => sum + nn(item.price) * item.quantity, 0)

  const calculateDiscountValue = () => {
    const subtotal = calculateSubtotal()
    const rawDiscount = parseFloat(discount) || 0
    return discountType === 'percentage' ? subtotal * (rawDiscount / 100) : rawDiscount
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
        quantity: item.quantity,
        price: item.price,
        ...(item.variantId ? { variantId: item.variantId } : {}),
      })),
      shippingCharge: parseFloat(shippingCharge) || 0,
      discount: parseFloat(discount) || 0,
      discountType,
      salesChannel,
      customerNotes: customerNotes || null,
      officeNotes: officeNotes || null,
      paymentOptionType: paymentMode === 'cod' ? 'CASH_ON_DELIVERY' : paymentMode === 'full' ? 'FULL_PAYMENT' : paymentMode === 'partial' ? 'PARTIAL_PAYMENT' : undefined,
      gatewayCode: paymentMethod || undefined,
    }

    if (paymentMode === 'partial' && partialAmount) {
      payload.partialAmount = parseFloat(partialAmount)
    }

    if (selectedCustomerId) {
      payload.customerId = selectedCustomerId
    } else {
      const normalizedPhone = normalizePhone(customerPhone)
      if (customerName) payload.guestName = customerName
      if (normalizedPhone) payload.guestPhone = normalizedPhone
      if (customerEmail) payload.guestEmail = customerEmail
    }

    const shipAddr = useDiffShipping ? shipAddress : customerAddress
    const shipCity = useDiffShipping ? shipCityId : customerCityId
    const shipZone = useDiffShipping ? shipZoneId : customerZoneId
    if (shipAddr || shipCity) {
      payload.shippingAddress = {
        address: shipAddr,
        cityId: shipCity || undefined,
        zoneId: shipZone || undefined,
      }
    }

    return payload
  }

  const createMut = useMutation({
    mutationFn: (data: any) => ordersApi.create(data),
    onSuccess: (res: any) => {
      const orderId = res.data?.id || res.id
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
    if (!normalizedPhone) {
      toast.error('Enter a valid phone number')
      return
    }
    if (!customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    if (paymentMode === 'partial' && (!partialAmount || parseFloat(partialAmount) <= 0)) {
      toast.error('Enter a partial payment amount')
      return
    }
    createMut.mutate(buildPayload())
  }

  const subtotal = calculateSubtotal()
  const discountValue = calculateDiscountValue()
  const total = calculateTotal()

  return (
    <>
      <Header fixed>
        <Button variant='ghost' onClick={() => navigate({ to: '/op/orders' })}>
          <ArrowLeft className='h-4 w-4 mr-1' /> Back to Orders
        </Button>
        <ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <h2 className='text-2xl font-bold tracking-tight'>Create Order</h2>
        </div>

        <div className='grid grid-cols-3 gap-6'>
          <div className='col-span-2 space-y-6'>
            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <Phone className='h-4 w-4' /> Customer
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='relative'>
                  <Phone className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                  <Input
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder='Phone number (e.g. 01712345678)'
                    className='pl-9'
                  />
                  {searchingCustomer && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
                </div>
                {customerMatched && (
                  <Badge variant='default' className='bg-green-500'>Customer found: {customerName}</Badge>
                )}
                {customerPhone.length >= 11 && !customerMatched && !searchingCustomer && (
                  <p className='text-xs text-muted-foreground'>No existing customer found. A new customer will be created with this phone number.</p>
                )}
                <div className='grid grid-cols-2 gap-3'>
                  <div><Label className='text-xs'>Name</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder='Customer name' /></div>
                  <div><Label className='text-xs'>Email</Label><Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder='customer@example.com' /></div>
                </div>
                <div><Label className='text-xs'>Address</Label><Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} rows={2} placeholder='Customer address' /></div>
                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <Label className='text-xs'>City</Label>
                    <SearchableSelect
                      options={cityOptions}
                      value={customerCityId}
                      onChange={val => { setCustomerCityId(val); setCustomerZoneId('') }}
                      placeholder='Select city...'
                      searchPlaceholder='Search cities...'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Zone</Label>
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
              </CardContent>
            </Card>

            <div className='flex items-center gap-2'>
              <input type='checkbox' id='diffShipping' checked={useDiffShipping} onChange={e => setUseDiffShipping(e.target.checked)} className='h-4 w-4 rounded border-gray-300' />
              <Label htmlFor='diffShipping' className='text-xs cursor-pointer'>Use different shipping address</Label>
            </div>

            {useDiffShipping && (
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-base flex items-center gap-2'>
                    <MapPin className='h-4 w-4' /> Shipping Address
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div><Label className='text-xs'>Address</Label><Textarea value={shipAddress} onChange={e => setShipAddress(e.target.value)} rows={2} placeholder='Different shipping address' /></div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div>
                      <Label className='text-xs'>City</Label>
                      <SearchableSelect
                        options={cityOptions}
                        value={shipCityId}
                        onChange={val => { setShipCityId(val); setShipZoneId('') }}
                        placeholder='Select city...'
                        searchPlaceholder='Search cities...'
                      />
                    </div>
                    <div>
                      <Label className='text-xs'>Zone</Label>
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
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <Package className='h-4 w-4' /> Products
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                {/* ── Unified Smart Search Bar ── */}
                <div className='relative' ref={productDropdownRef}>
                  {/* Active category filter chip */}
                  {selectedCategoryId && (
                    <div className='mb-1.5 flex items-center gap-1'>
                      <span className='text-xs text-muted-foreground'>Filtered by:</span>
                      <button
                        type='button'
                        onClick={() => setSelectedCategoryId('')}
                        className='inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5 font-medium hover:bg-primary/20 transition-colors'
                      >
                        {categories.find((c: any) => c.id === selectedCategoryId)?.name || 'Category'}
                        <X className='h-3 w-3' />
                      </button>
                    </div>
                  )}

                  <div className='relative flex items-center'>
                    <Barcode className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10' />
                    <input
                      ref={productInputRef}
                      type='text'
                      value={productSearch}
                      onChange={e => {
                        setProductSearch(e.target.value)
                        if (!e.target.value) { setShowProductDropdown(false); setShowCategoryPicker(false) }
                      }}
                      onFocus={() => {
                        if (productResults.length > 0) setShowProductDropdown(true)
                        else if (!productSearch) setShowCategoryPicker(true)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && productSearch.trim()) {
                          // Try exact SKU match first; if none, do barcode search
                          const localExact = productResults.find((p: any) =>
                            p.sku?.toLowerCase() === productSearch.trim().toLowerCase() ||
                            p.variants?.some((v: any) => v.sku?.toLowerCase() === productSearch.trim().toLowerCase())
                          )
                          if (localExact) {
                            const matchedVariant = localExact.variants?.find((v: any) => v.sku?.toLowerCase() === productSearch.trim().toLowerCase())
                            if (matchedVariant) { addToCart(localExact, matchedVariant); toast.success(`${localExact.name} (${matchedVariant.name || matchedVariant.sku}) added`); setProductSearch(''); setShowProductDropdown(false) }
                            else if (localExact.type === 'variable' || localExact.variants?.length > 0) { setSelectedProductForVariants(localExact); setProductSearch(''); setShowProductDropdown(false) }
                            else { addToCart(localExact); toast.success(`${localExact.name} added`); setProductSearch(''); setShowProductDropdown(false) }
                          } else {
                            handleBarcodeSearch(productSearch.trim())
                          }
                        }
                        if (e.key === 'Escape') { setShowProductDropdown(false); setShowCategoryPicker(false) }
                      }}
                      placeholder='Search by name or SKU / scan barcode → Enter to add'
                      className='w-full h-10 pl-9 pr-9 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                      autoComplete='off'
                    />
                    {productSearching
                      ? <Loader2 className='absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />
                      : productSearch && <button type='button' onClick={() => { setProductSearch(''); setShowProductDropdown(false) }} className='absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'><X className='h-4 w-4' /></button>
                    }
                  </div>

                  {/* Category picker panel — shown on empty focus */}
                  {showCategoryPicker && !productSearch && categories.length > 0 && (
                    <div className='absolute z-20 mt-1 w-full bg-background border rounded-md shadow-lg p-2'>
                      <p className='text-xs text-muted-foreground mb-2 px-1'>Browse by category</p>
                      <div className='flex flex-wrap gap-1.5'>
                        {categories.map((c: any) => (
                          <button
                            key={c.id}
                            type='button'
                            onClick={() => { setSelectedCategoryId(c.id); setShowCategoryPicker(false); productInputRef.current?.focus() }}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                              selectedCategoryId === c.id
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'hover:bg-muted'
                            }`}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search results dropdown */}
                  {showProductDropdown && productResults.length > 0 && (
                    <div className='absolute z-20 mt-1 w-full bg-background border rounded-md shadow-lg overflow-hidden'>
                      <div className='max-h-56 overflow-y-auto'>
                        {productResults.map((p: any) => (
                          <button
                            key={p.id}
                            type='button'
                            className='w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 border-b last:border-0'
                            onClick={() => {
                              if (p.type === 'variable' || p.variants?.length > 0) {
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
                              <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-8 w-8 rounded border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                            ) : (
                              <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center shrink-0'><Package className='h-4 w-4 text-muted-foreground' /></div>
                            )}
                            <div className='min-w-0 flex-1'>
                              <p className='text-sm font-medium truncate'>{p.name}</p>
                              <p className='text-xs text-muted-foreground'>{p.sku || 'No SKU'}</p>
                            </div>
                            <div className='text-sm font-medium shrink-0'>৳{fmt(ep(p))}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <ShoppingCart className='h-4 w-4' /> Cart ({cartItems.length})
                </CardTitle>
              </CardHeader>
              <CardContent className='p-0'>
                {cartItems.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
                    <ShoppingCart className='h-12 w-12 mb-2 opacity-20' />
                    <p className='text-sm'>No items added yet. Search products above.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Variant</TableHead>
                        <TableHead className='text-right'>Price</TableHead>
                        <TableHead className='text-right'>Qty</TableHead>
                        <TableHead className='text-right'>Total</TableHead>
                        <TableHead className='w-10'></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cartItems.map((item, index) => (
                        <TableRow key={`${item.productId}-${item.variantId || ''}-${index}`}>
                          <TableCell>
                            <div className='flex items-center gap-2'>
                              {item.product.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                                <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-8 w-8 rounded border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                              ) : (
                                <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center shrink-0'><Package className='h-4 w-4 text-muted-foreground' /></div>
                              )}
                              <span className='text-sm font-medium truncate max-w-[200px]'>{item.product.name}</span>
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
                              <Button variant='outline' size='icon' className='h-6 w-6' onClick={() => updateCartQty(index, item.quantity - 1)}>
                                <Minus className='h-3 w-3' />
                              </Button>
                              <span className='w-8 text-center text-sm font-medium'>{item.quantity}</span>
                              <Button variant='outline' size='icon' className='h-6 w-6' onClick={() => updateCartQty(index, item.quantity + 1)}>
                                <Plus className='h-3 w-3' />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className='text-right text-sm font-medium'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                          <TableCell>
                            <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive hover:text-destructive' onClick={() => removeFromCart(index)}>
                              <Trash2 className='h-4 w-4' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

          </div>

          <div className='space-y-6'>
            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base'>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Subtotal</span>
                    <span>৳{fmt(subtotal)}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Shipping</span>
                    <span>+৳{fmt(parseFloat(shippingCharge) || 0)}</span>
                  </div>
                  {discountValue > 0 && (
                    <div className='flex justify-between text-green-600'>
                      <span className='text-muted-foreground'>Discount {discountType === 'percentage' ? `(${parseFloat(discount) || 0}%)` : ''}</span>
                      <span>-৳{fmt(discountValue)}</span>
                    </div>
                  )}
                  <div className='flex justify-between font-bold text-base pt-1.5 border-t'>
                    <span>Total</span>
                    <span>৳{fmt(total)}</span>
                  </div>
                </div>

                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <Label className='text-xs'>Shipping Charge</Label>
                    <Input type='number' step='0.01' value={shippingCharge} onChange={e => setShippingCharge(e.target.value)} className='h-9 text-sm mt-1' />
                  </div>
                  <div>
                    <Label className='text-xs'>Discount</Label>
                    <Input type='number' step='0.01' value={discount} onChange={e => setDiscount(e.target.value)} className='h-9 text-sm mt-1' />
                  </div>
                </div>
                <div className='flex gap-1 border rounded-md p-0.5 w-fit'>
                  <Button variant={discountType === 'flat' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('flat')}>
                    <Tag className='h-3 w-3 mr-1' />Flat
                  </Button>
                  <Button variant={discountType === 'percentage' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('percentage')}>
                                    %
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base flex items-center gap-2'>
                  <CreditCard className='h-4 w-4' /> Payment
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div>
                  <Label className='text-xs'>Method</Label>
                  <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1' value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                    <option value='cash'>Cash</option>
                    <option value='bkash'>bKash</option>
                    <option value='nagad'>Nagad</option>
                    <option value='bank'>Bank</option>
                    <option value='card'>Card</option>
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Mode</Label>
                  <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1' value={paymentMode} onChange={e => setPaymentMode(e.target.value as any)}>
                    <option value='cod'>COD</option>
                    <option value='full'>Full Payment</option>
                    <option value='partial'>Partial Payment</option>
                  </select>
                </div>
                {paymentMode === 'partial' && (
                  <div>
                    <Label className='text-xs'>Partial Amount</Label>
                    <Input type='number' step='0.01' value={partialAmount} onChange={e => setPartialAmount(e.target.value)} className='h-9 text-sm mt-1' placeholder='Amount to collect' />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base'>Sales Channel</CardTitle>
              </CardHeader>
              <CardContent>
                <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm' value={salesChannel} onChange={e => setSalesChannel(e.target.value)}>
                  <option value='WEBSITE'>Website</option>
                  <option value='WALK_IN'>Walk-in</option>
                  <option value='CALL'>Call</option>
                  <option value='FACEBOOK'>Facebook</option>
                  <option value='INSTAGRAM'>Instagram</option>
                  <option value='TIKTOK'>TikTok</option>
                  <option value='MESSENGER'>Messenger</option>
                  <option value='WHATSAPP'>WhatsApp</option>
                  <option value='THREADS'>Threads</option>
                  <option value='OTHER'>Other</option>
                </select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'>
                <CardTitle className='text-base'>Notes</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div>
                  <Label className='text-xs'>Customer Notes</Label>
                  <Textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} rows={2} className='mt-1 text-sm' placeholder='Note visible to customer on invoice...' />
                </div>
                <div>
                  <Label className='text-xs'>Office Notes</Label>
                  <Textarea value={officeNotes} onChange={e => setOfficeNotes(e.target.value)} rows={2} className='mt-1 text-sm' placeholder='Internal notes...' />
                </div>
              </CardContent>
            </Card>

            <Button className='w-full' size='lg' onClick={handleSubmit} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-2' /> : <Plus className='h-4 w-4 mr-2' />}
              Create Order
            </Button>
          </div>
        </div>
      </Main>

      <Dialog open={!!selectedProductForVariants} onOpenChange={() => setSelectedProductForVariants(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Select Variant</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <p className='text-sm font-medium'>{selectedProductForVariants?.name}</p>
            <div className='space-y-2 max-h-60 overflow-y-auto'>
              {selectedProductForVariants?.variants?.map((v: any) => (
                <div
                  key={v.id}
                  className='flex items-center justify-between p-2 border rounded-md hover:bg-muted cursor-pointer'
                  onClick={() => {
                    addToCart(selectedProductForVariants, v)
                    setSelectedProductForVariants(null)
                    toast.success(`${selectedProductForVariants.name} (${v.name || v.sku}) added to cart`)
                  }}
                >
                  <div className='flex items-center gap-2'>
                    {v.image ? (
                      <SafeImage src={mediaUrl(v.image)} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                    ) : (
                      <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                    )}
                    <div>
                      <p className='text-sm font-medium'>{v.name || 'Default Variant'}</p>
                      <p className='text-xs text-muted-foreground'>{v.sku || 'No SKU'}</p>
                    </div>
                  </div>
                  <div className='text-sm font-medium'>৳{fmt(v.salePrice ?? v.price ?? ep(selectedProductForVariants))}</div>
                </div>
              ))}
            </div>
          </div>
          <div className='flex justify-end'><Button variant='outline' onClick={() => setSelectedProductForVariants(null)}>Cancel</Button></div>
        </DialogContent>
      </Dialog>
    </>
  )
}
