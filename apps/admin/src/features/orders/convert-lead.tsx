import { Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SafeImage } from '@/components/safe-image'
import { mediaUrl } from '@/features/orders/api'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Loader2, ArrowLeft, Package, DollarSign, Percent } from 'lucide-react'

const statusColors: Record<string, string> = { PENDING: '#F59E0B', CONVERTED: '#22C55E', NOT_CONVERTED: '#6B7280', DELETED: '#EF4444' }
const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

export function ConvertLead({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: lead, isLoading } = useQuery({
    queryKey: ['checkout-lead', id],
    queryFn: () => apiClient.get(`/checkout-leads/${id}`).then(r => r.data),
  })

  const [orderItems, setOrderItems] = useState<any[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [shippingCharge, setShippingCharge] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState('flat')
  const [paymentMethod, setPaymentMethod] = useState('cod')
  const [paymentMode, setPaymentMode] = useState('cod')
  const [partialAmount, setPartialAmount] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')
  const [officeNotes, setOfficeNotes] = useState('')
  const [address, setAddress] = useState('')
  const [district, setDistrict] = useState('')
  const [thana, setThana] = useState('')
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [districts, setDistricts] = useState<any[]>([])
  const [thanas, setThanas] = useState<any[]>([])
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (lead) {
      setCustomerName(lead.name || '')
      setCustomerPhone(lead.phone || '')
      setCustomerEmail(lead.email || '')
      setPaymentMethod(lead.paymentMethod || 'cod')
      setPaymentMode(lead.paymentMode || 'cod')
      setPartialAmount(lead.partialAmount || '')
      setOrderItems((lead.items || []).map((i: any) => ({
        productId: i.productId,
        variantId: i.variantId,
        product: i.product || { name: i.name, images: i.image ? [i.image] : [] },
        quantity: i.quantity || 1,
        price: i.price || 0,
      })))
      if (lead.address) {
        setAddress(lead.address.address || '')
        setDistrict(lead.address.district || '')
        setThana(lead.address.thana || '')
      }
    }
  }, [lead])

  useEffect(() => {
    apiClient.get('/products', { params: { perPage: 500 } })
      .then(r => setAllProducts(r.data?.data || r.data || []))
      .catch(() => toast.error('Failed to load products'))
  }, [])

  useEffect(() => {
    apiClient.get('/delivery-areas/districts')
      .then(r => setDistricts(r.data as any[]))
      .catch(() => toast.error('Failed to load districts'))
  }, [])

  useEffect(() => {
    if (district) {
      apiClient.get(`/delivery-areas/districts/${encodeURIComponent(district)}/thanas`)
        .then(r => setThanas(r.data as any[]))
        .catch(() => toast.error('Failed to load thanas'))
    } else {
      setThanas([])
    }
  }, [district])

  const convertMut = useMutation({
    mutationFn: (data: any) => apiClient.post(`/checkout-leads/${id}/convert`, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      toast.success('Order created from lead')
      navigate({ to: '/op/orders/$id', params: { id: (res as any).data.id } })
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Conversion failed')
    },
  })

  const validate = () => {
    const errors: Record<string, string> = {}
    if (orderItems.length === 0) errors.items = 'Add at least one item'
    if (!customerName.trim()) errors.customerName = 'Customer name is required'
    if (!customerPhone.trim()) errors.customerPhone = 'Phone is required'
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleConvert = () => {
    if (!validate()) return
    convertMut.mutate({
      items: orderItems.map(i => ({
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
        price: i.price,
      })),
      guestName: customerName,
      guestPhone: customerPhone,
      paymentMethod: paymentMethod,
      paymentMode: paymentMode,
      ...(paymentMode === 'partial' && partialAmount ? { partialAmount: parseFloat(partialAmount) } : {}),
      shippingAddress: { address, district, thana },
      shippingCharge: parseFloat(shippingCharge) || 0,
      discount: parseFloat(discount) || 0,
      discountType: discountType,
      customerNotes: customerNotes || undefined,
      officeNotes: officeNotes || undefined,
    })
  }

  const rawDiscount = parseFloat(discount) || 0
  const itemSubtotal = orderItems.reduce((s: number, i: any) => s + nn(i.price) * i.quantity, 0)
  const effectiveDiscount = discountType === 'percentage' ? itemSubtotal * (rawDiscount / 100) : rawDiscount
  const calculatedTotal = Math.max(0, itemSubtotal + (parseFloat(shippingCharge) || 0) - effectiveDiscount)

  if (isLoading) {
    return (
      <>
        <Header fixed><Link to='/op/orders/incomplete-leads' className='me-auto'><Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button></Link><ThemeSwitch /><ProfileDropdown /></Header>
        <Main><div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div></Main>
      </>
    )
  }

  if (!lead) {
    return (
      <>
        <Header fixed><Link to='/op/orders/incomplete-leads' className='me-auto'><Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button></Link><ThemeSwitch /><ProfileDropdown /></Header>
        <Main><div className='p-6 text-muted-foreground'>Lead not found</div></Main>
      </>
    )
  }

  if (lead.status === 'CONVERTED') {
    return (
      <>
        <Header fixed><Link to='/op/orders/incomplete-leads' className='me-auto'><Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button></Link><ThemeSwitch /><ProfileDropdown /></Header>
        <Main>
          <div className='p-6 text-center'>
            <p className='text-lg font-medium mb-2'>This lead has already been converted</p>
            {lead.convertedOrder && (
              <Link to='/op/orders/$id' params={{ id: lead.convertedOrder.id }}>
                <Button variant='outline'>View Order</Button>
              </Link>
            )}
          </div>
        </Main>
      </>
    )
  }

  return (
    <>
      <Header fixed>
        <Link to='/op/orders/incomplete-leads' className='me-auto'>
          <Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Incomplete Leads</Button>
        </Link>
        <ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <h2 className='text-2xl font-bold tracking-tight'>{lead.displayId}</h2>
            <p className='text-muted-foreground'>{customerName}</p>
            <Badge style={{ backgroundColor: statusColors.PENDING, color: '#fff' }}>{lead.status}</Badge>
          </div>
          <Button size='sm' onClick={handleConvert} disabled={convertMut.isPending || orderItems.length === 0}>
            {convertMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            Convert to Order
          </Button>
        </div>

        {validationErrors.items && <p className='text-sm text-destructive'>{validationErrors.items}</p>}

        <div className='grid grid-cols-3 gap-6'>
          <div className='col-span-2 space-y-6'>
            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Items</CardTitle></CardHeader>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className='text-right'>Price</TableHead>
                      <TableHead className='text-right'>Qty</TableHead>
                      <TableHead className='text-right'>Total</TableHead>
                      <TableHead className='text-right'></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderItems.map((item: any, index: number) => (
                      <TableRow key={item.productId + (item.variantId || '') + index}>
                        <TableCell>
                          <div className='flex items-center gap-3'>
                            {item.product?.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                              <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-10 w-10 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                            ) : (
                              <div className='h-10 w-10 rounded border bg-muted flex items-center justify-center'><Package className='h-5 w-5 text-muted-foreground' /></div>
                            )}
                            <span className='text-sm font-medium'>{item.product?.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className='text-right'>
                          <Input type='number' value={item.price} onChange={e => {
                            const newItems = [...orderItems]
                            newItems[index].price = parseFloat(e.target.value) || 0
                            setOrderItems(newItems)
                          }} className='w-24 text-right h-8 text-sm' />
                        </TableCell>
                        <TableCell className='text-right'>
                          <Input type='number' value={item.quantity} onChange={e => {
                            const newItems = [...orderItems]
                            newItems[index].quantity = parseInt(e.target.value) || 1
                            setOrderItems(newItems)
                          }} className='w-20 text-right h-8 text-sm' min={1} />
                        </TableCell>
                        <TableCell className='text-right text-sm font-medium'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                        <TableCell className='text-right'>
                          <Button variant='ghost' size='sm' className='h-7 text-xs text-destructive hover:text-destructive' onClick={() => setOrderItems(orderItems.filter((_, i) => i !== index))}>
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Command className='border rounded-md shadow-sm' shouldFilter={false}>
                          <CommandInput
                            placeholder='Search or scan product by name or SKU...'
                            value={productSearchQuery}
                            onValueChange={setProductSearchQuery}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const exact = allProducts.find((p: any) => p.sku === productSearchQuery || p.variants?.some((v: any) => v.sku === productSearchQuery))
                                if (exact) {
                                  const variant = exact.variants?.find((v: any) => v.sku === productSearchQuery)
                                  setOrderItems([...orderItems, { productId: exact.id, variantId: variant?.id, product: exact, quantity: 1, price: variant?.price || exact.price || 0 }])
                                  setProductSearchQuery('')
                                  toast.success('Product added')
                                } else {
                                  toast.error('Product not found with this SKU')
                                }
                              }
                            }}
                          />
                          {productSearchQuery && (
                            <CommandList className='max-h-48 overflow-y-auto'>
                              <CommandEmpty>No results found.</CommandEmpty>
                              <CommandGroup>
                                {allProducts
                                  .filter((p: any) => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || p.sku?.toLowerCase().includes(productSearchQuery.toLowerCase()))
                                  .map((p: any) => (
                                    <CommandItem
                                      key={p.id}
                                      value={p.name}
                                      onSelect={() => {
                                        if (p.type === 'variable' || p.variants?.length > 0) {
                                          setSelectedProductForVariants(p)
                                        } else {
                                          setOrderItems([...orderItems, { productId: p.id, product: p, quantity: 1, price: p.price || 0 }])
                                          setProductSearchQuery('')
                                        }
                                      }}
                                      className='flex items-center gap-2 p-2 cursor-pointer'
                                    >
                                      {p.images && Array.isArray(p.images) && p.images[0] ? (
                                        <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                                      ) : (
                                        <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                                      )}
                                      <div className='flex-1 min-w-0'>
                                        <p className='text-sm font-medium truncate'>{p.name}</p>
                                        <p className='text-xs text-muted-foreground'>{p.sku || 'No SKU'}</p>
                                      </div>
                                      <div className='text-sm font-medium'>৳{fmt(p.price || 0)}</div>
                                    </CommandItem>
                                  ))}
                              </CommandGroup>
                            </CommandList>
                          )}
                        </Command>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className='px-4 py-3 border-t'>
                  <div className='flex justify-between text-sm'><span>Subtotal</span><span>৳{fmt(itemSubtotal)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Notes</CardTitle></CardHeader>
              <CardContent className='space-y-3'>
                <div><Label className='text-xs'>Customer Notes</Label><Textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} rows={2} /></div>
                <div><Label className='text-xs'>Office Notes</Label><Textarea value={officeNotes} onChange={e => setOfficeNotes(e.target.value)} rows={2} /></div>
              </CardContent>
            </Card>
          </div>

          <div className='space-y-6'>
            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Customer Info</CardTitle></CardHeader>
              <CardContent className='space-y-3'>
                <div>
                  <Label className='text-xs'>Name</Label>
                  <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
                  {validationErrors.customerName && <p className='text-xs text-destructive mt-1'>{validationErrors.customerName}</p>}
                </div>
                <div>
                  <Label className='text-xs'>Phone</Label>
                  <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                  {validationErrors.customerPhone && <p className='text-xs text-destructive mt-1'>{validationErrors.customerPhone}</p>}
                </div>
                <div>
                  <Label className='text-xs'>Email</Label>
                  <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Shipping Address</CardTitle></CardHeader>
              <CardContent className='space-y-3'>
                <div>
                  <Label className='text-xs'>District</Label>
                  <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm' value={district} onChange={e => { setDistrict(e.target.value); setThana('') }}>
                    <option value=''>Select District...</option>
                    {districts.map((d: any) => <option key={d.name} value={d.name}>{d.nameBn ? `${d.name} - ${d.nameBn}` : d.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Thana / Zone</Label>
                  <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm' value={thana} onChange={e => setThana(e.target.value)}>
                    <option value=''>Select Thana...</option>
                    {thanas.map((t: any) => <option key={t.name} value={t.name}>{t.nameBn ? `${t.name} - ${t.nameBn}` : t.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Address</Label>
                  <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Pricing</CardTitle></CardHeader>
              <CardContent className='space-y-3'>
                <div><Label className='text-xs'>Shipping Charge</Label><Input type='number' step='0.01' value={shippingCharge} onChange={e => setShippingCharge(e.target.value)} /></div>
                <div><Label className='text-xs'>Discount</Label><Input type='number' step='0.01' value={discount} onChange={e => setDiscount(e.target.value)} /></div>
                <div className='flex gap-1 border rounded-md p-0.5 w-fit'>
                  <Button variant={discountType === 'flat' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('flat')}><DollarSign className='h-3 w-3 mr-1' />Flat (৳)</Button>
                  <Button variant={discountType === 'percentage' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('percentage')}><Percent className='h-3 w-3 mr-1' />%</Button>
                </div>
                <div className='bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm'>
                  <div className='flex justify-between'><span className='text-muted-foreground'>Subtotal</span><span>৳{fmt(itemSubtotal)}</span></div>
                  <div className='flex justify-between'><span className='text-muted-foreground'>Shipping</span><span>+৳{fmt(parseFloat(shippingCharge) || 0)}</span></div>
                  {rawDiscount > 0 && <div className='flex justify-between text-green-600'><span className='text-muted-foreground'>Discount {discountType === 'percentage' ? `(${rawDiscount}%)` : ''}</span><span>-৳{fmt(effectiveDiscount)}</span></div>}
                  <div className='flex justify-between font-bold text-base pt-1.5 border-t'><span>Total</span><span>৳{fmt(calculatedTotal)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Payment</CardTitle></CardHeader>
              <CardContent className='space-y-3'>
                <div>
                  <Label className='text-xs'>Method</Label>
                  <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1' value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                    <option value='cod'>COD</option>
                    <option value='bkash'>bKash</option>
                    <option value='nagad'>Nagad</option>
                    <option value='bank'>Bank</option>
                    <option value='card'>Card</option>
                    <option value='rocket'>Rocket</option>
                    <option value='bkash_pgw'>bKash PGW</option>
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
                <div key={v.id} className='flex items-center justify-between p-2 border rounded-md hover:bg-muted cursor-pointer' onClick={() => {
                  setOrderItems([...orderItems, { productId: selectedProductForVariants.id, variantId: v.id, product: { ...selectedProductForVariants, name: `${selectedProductForVariants.name} (${v.name || v.sku})` }, quantity: 1, price: v.price || selectedProductForVariants.price || 0 }])
                  setSelectedProductForVariants(null)
                  setProductSearchQuery('')
                }}>
                  <div className='flex items-center gap-2'>
                    {v.image ? <SafeImage src={mediaUrl(v.image)} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} /> : <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>}
                    <div><p className='text-sm font-medium'>{v.name || 'Default Variant'}</p><p className='text-xs text-muted-foreground'>{v.sku || 'No SKU'}</p></div>
                  </div>
                  <div className='text-sm font-medium'>৳{fmt(v.price || selectedProductForVariants.price || 0)}</div>
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
