import { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Plus, Search, Gift, Loader2, Image as ImageIcon } from 'lucide-react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { combosApi, type ComboResponse } from '../api'
import { productsApi } from '@/features/products/api'
import { categoriesApi } from '@/features/categories/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MediaPicker } from '@/components/media-picker'

type Props = { open: boolean; onOpenChange: (v: boolean) => void; currentRow?: ComboResponse; mode: 'add' | 'edit' }

interface ComboItemForm {
  productId: string; productName: string; productImage?: string;
  productType?: 'simple' | 'variable';
  variantId?: string; variantLabel?: string;
  flexibleMode?: boolean;
  quantity: number; price?: number;
  attrSelections?: Record<string, string>;
  variants?: Array<{
    id: string; sku: string; price?: number | string | null;
    attributeValues: Array<{ attributeValue: { id: string; value: string; attribute: { id: string; name: string } } }>;
  }>;
}

export function ComboForm({ open, onOpenChange, currentRow, mode }: Props) {
  const queryClient = useQueryClient()
  const isEdit = mode === 'edit'
  const [tab, setTab] = useState('general')

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list().then(r => Array.isArray(r.data) ? r.data : []) })
  const [productSearch, setProductSearch] = useState('')
  const { data: searchResults } = useQuery({
    queryKey: ['products-search', productSearch],
    queryFn: () => productsApi.list({ search: productSearch, perPage: 10, isActive: true }).then(r => r.data),
    enabled: productSearch.length >= 2,
  })

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [desc, setDesc] = useState('')
  const [shortDesc, setShortDesc] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [image, setImage] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMulti, setPickerMulti] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  const categoryOptions = useMemo(() => {
    return [
      ...(Array.isArray(cats) ? cats : []).map((c: any) => ({
        id: c.id,
        label: c.name,
      })),
    ]
  }, [cats])
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDesc, setSeoDesc] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [items, setItems] = useState<ComboItemForm[]>([])

  const prevRowId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    const isSameRow = currentRow?.id === prevRowId.current
    if (isSameRow) return

    prevRowId.current = currentRow?.id

    if (isEdit && currentRow) {
      setName(currentRow.name || '')
      setSlug(currentRow.slug || '')
      setDesc(currentRow.description || '')
      setShortDesc(currentRow.shortDesc || '')
      setBasePrice(String(currentRow.basePrice ?? ''))
      setSalePrice(currentRow.salePrice != null ? String(currentRow.salePrice) : '')
      setImage(currentRow.image || '')
      setImages(Array.isArray(currentRow.images) ? currentRow.images : [])
      setCategoryId(currentRow.categoryId || '')
      setIsActive(currentRow.isActive)
      setIsFeatured(currentRow.isFeatured)
      setTags(Array.isArray(currentRow.tags) ? currentRow.tags : [])
      const seo = (currentRow.seoMeta || {}) as any
      setSeoTitle(seo.title || '')
      setSeoDesc(seo.description || '')
      setSeoKeywords(seo.keywords || '')
      setStartDate(currentRow.startDate || '')
      setEndDate(currentRow.endDate || '')
      setItems((currentRow.items || []).map(i => ({
        productId: i.productId,
        productName: i.product.name,
        productImage: Array.isArray(i.product.images) ? i.product.images[0] : '',
        variantId: i.variantId || undefined,
        quantity: i.quantity,
        price: i.price != null ? Number(i.price) : undefined,
      })))
    } else {
      setName(''); setSlug(''); setDesc(''); setShortDesc('')
      setBasePrice(''); setSalePrice(''); setImage(''); setImages([])
      setCategoryId(''); setIsActive(true); setIsFeatured(false)
      setTags([]); setTagInput('')
      setSeoTitle(''); setSeoDesc(''); setSeoKeywords('')
      setStartDate(''); setEndDate(''); setItems([])
    }
  }, [open, currentRow, isEdit])

  function slugify(v: string) { return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }

  const createMut = useMutation({
    mutationFn: (data: any) => combosApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['combos'] }); onOpenChange(false); toast.success('Combo created'); },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create combo'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => combosApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['combos'] }); onOpenChange(false); toast.success('Combo updated'); },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update combo'),
  })

  function handleSubmit() {
    const payload: any = {
      name, slug: slug || slugify(name), description: desc, shortDesc,
      basePrice: parseFloat(basePrice) || 0,
      salePrice: salePrice ? parseFloat(salePrice) : undefined,
      image, images, categoryId: categoryId || undefined,
      tags, seoMeta: { title: seoTitle, description: seoDesc, keywords: seoKeywords },
      isActive, isFeatured,
      startDate: startDate || undefined, endDate: endDate || undefined,
      items: items.map(i => ({
        productId: i.productId,
        variantId: i.variantId || undefined,
        quantity: i.quantity,
        price: i.price || undefined,
      })),
    }
    if (isEdit && currentRow) {
      updateMut.mutate({ id: currentRow.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  function addItem(product: any) {
    if (items.some(i => i.productId === product.id)) {
      toast.error('Product already added to combo')
      return
    }
    const isVar = product.type === 'variable'
    const price = isVar && Array.isArray(product.variants) && product.variants.length > 0
      ? Math.min(...product.variants.map((v: any) => parseFloat(String(v.price ?? 0))).filter((v: number) => v > 0))
      : (product.salePrice ? Number(product.salePrice) : Number(product.basePrice))
    setItems(prev => [...prev, {
      productId: product.id,
      productName: product.name,
      productImage: Array.isArray(product.images) ? product.images[0] : '',
      productType: isVar ? 'variable' : 'simple',
      variants: isVar ? (product.variants || []) : undefined,
      flexibleMode: isVar,  // default to flexible for variable products
      quantity: 1,
      price: isFinite(price) ? price : 0,
    }])
    setProductSearch('')
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  function updateItemQty(index: number, qty: number) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, quantity: Math.max(1, qty) } : item))
  }

  function updateItemPrice(index: number, price: number) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, price } : item))
  }

  function setItemFlexible(index: number, flexible: boolean) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, flexibleMode: flexible, variantId: flexible ? undefined : item.variantId, variantLabel: flexible ? undefined : item.variantLabel, attrSelections: flexible ? undefined : item.attrSelections } : item))
  }

  function setItemVariant(index: number, variantId: string, label: string) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, variantId, variantLabel: label, flexibleMode: false } : item))
  }

  function setItemAttrSelection(index: number, attrName: string, value: string) {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      const next = { ...(item.attrSelections || {}), [attrName]: value }
      const attrs = getUniqueAttrs(item)
      const variant = findVariantByAttrs(item, next)
      const allSelected = Object.keys(next).length === attrs.length
      return {
        ...item,
        attrSelections: next,
        variantId: variant && allSelected ? variant.id : undefined,
        variantLabel: variant && allSelected ? variant.label : undefined,
        flexibleMode: false,
      }
    }))
  }

  function findVariantByAttrs(item: ComboItemForm, selections: Record<string, string>): { id: string; label: string } | null {
    if (!item.variants) return null
    for (const v of item.variants) {
      const matches = v.attributeValues.every(av =>
        selections[av.attributeValue.attribute.name] === av.attributeValue.value
      )
      if (matches) return { id: v.id, label: v.attributeValues.map(av => av.attributeValue.value).join(' / ') }
    }
    return null
  }

  function getUniqueAttrs(item: ComboItemForm): Array<{ name: string; values: string[] }> {
    if (!item.variants) return []
    const attrMap = new Map<string, Set<string>>()
    for (const v of item.variants) {
      for (const av of v.attributeValues) {
        const name = av.attributeValue.attribute.name
        if (!attrMap.has(name)) attrMap.set(name, new Set())
        attrMap.get(name)!.add(av.attributeValue.value)
      }
    }
    return Array.from(attrMap.entries()).map(([name, values]) => ({ name, values: Array.from(values) }))
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) { setTags(prev => [...prev, t]); setTagInput('') }
  }

  const saving = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open && !pickerOpen} onOpenChange={(v) => { if (pickerOpen) return; onOpenChange(v); }}>
      <DialogContent className='!max-w-6xl max-h-[95vh] overflow-hidden flex flex-col p-0'>
        <DialogHeader className='px-6 pt-6 pb-2'>
          <DialogTitle>{isEdit ? 'Edit Combo' : 'Create Combo'}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className='flex-1 overflow-hidden flex flex-col'>
          <div className='px-6'>
            <TabsList className='grid grid-cols-4'>
              <TabsTrigger value='general'>General</TabsTrigger>
              <TabsTrigger value='items'>Items ({items.length})</TabsTrigger>
              <TabsTrigger value='pricing'>Pricing</TabsTrigger>
              <TabsTrigger value='meta'>Meta</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value='general' className='flex-1 overflow-y-auto px-6 pb-4 space-y-4 mt-4'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label>Name *</Label>
                <Input value={name} onChange={e => { setName(e.target.value); if (!isEdit) setSlug(slugify(e.target.value)) }} placeholder='Combo name' />
              </div>
              <div className='space-y-2'>
                <Label>Slug</Label>
                <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder='combo-slug' />
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Short Description</Label>
              <Input value={shortDesc} onChange={e => setShortDesc(e.target.value)} placeholder='Short description' />
            </div>
            <div className='space-y-2'>
              <Label>Description</Label>
              <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder='Full description' />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <SearchableSelect
                  options={categoryOptions}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder='No category'
                  searchPlaceholder='Search categories...'
                />
              </div>
              <div className='space-y-2'>
                <Label>Featured Image</Label>
                <div className='flex items-center gap-2'>
                  <div className='h-12 w-12 rounded border bg-muted overflow-hidden shrink-0 flex items-center justify-center'>
                    {image
                      ? <SafeImage src={mediaUrl(image)} alt='' className='h-full w-full object-cover' />
                      : <ImageIcon className='h-5 w-5 text-muted-foreground' />}
                  </div>
                  <Button type='button' variant='outline' size='sm' onClick={() => { setPickerMulti(false); setPickerOpen(true) }}>
                    {image ? 'Change' : 'Choose'} image
                  </Button>
                  {image && (
                    <Button type='button' variant='ghost' size='icon' className='h-8 w-8' onClick={() => setImage('')}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Gallery</Label>
              <div className='flex flex-wrap items-center gap-2'>
                {images.map((u, i) => (
                  <div key={i} className='relative h-16 w-16 rounded border overflow-hidden group'>
                    <SafeImage src={mediaUrl(u)} alt='' className='h-full w-full object-cover' />
                    <button
                      type='button'
                      onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                      className='absolute top-0 right-0 bg-background/80 rounded-bl p-0.5 opacity-0 group-hover:opacity-100'
                    >
                      <X className='h-3 w-3 text-destructive' />
                    </button>
                  </div>
                ))}
                <Button type='button' variant='outline' size='sm' onClick={() => { setPickerMulti(true); setPickerOpen(true) }}>
                  <Plus className='h-4 w-4 mr-1' /> Add images
                </Button>
              </div>
            </div>
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-2'>
                <Switch id='isActive' checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor='isActive'>Active</Label>
              </div>
              <div className='flex items-center gap-2'>
                <Switch id='isFeatured' checked={isFeatured} onCheckedChange={setIsFeatured} />
                <Label htmlFor='isFeatured'>Featured</Label>
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Tags</Label>
              <div className='flex gap-2'>
                <Input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder='Add tag...' />
                <Button type='button' variant='outline' onClick={addTag}><Plus className='h-4 w-4' /></Button>
              </div>
              {tags.length > 0 && (
                <div className='flex flex-wrap gap-1 mt-2'>
                  {tags.map((t, i) => <Badge key={i} variant='secondary' className='gap-1'>{t}<X className='h-3 w-3 cursor-pointer' onClick={() => setTags(prev => prev.filter((_, j) => j !== i))} /></Badge>)}
                </div>
              )}
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label>Start Date</Label>
                <Input type='datetime-local' value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label>End Date</Label>
                <Input type='datetime-local' value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value='items' className='flex-1 overflow-y-auto px-6 pb-4 space-y-4 mt-4'>
            <div className='space-y-2'>
              <Label>Search Products to Add</Label>
              <div className='relative'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                <Input className='pl-8' value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder='Search by product name...' />
              </div>
              {productSearch.length >= 2 && searchResults?.data && (
                <div className='border rounded-md max-h-60 overflow-y-auto divide-y'>
                  {searchResults.data.map((p: any) => {
                    const img = Array.isArray(p.images) ? p.images[0] : null
                    const isVar = p.type === 'variable'
                    const price = isVar && Array.isArray(p.variants)
                      ? Math.min(...p.variants.map((v: any) => parseFloat(String(v.price ?? 0))).filter((v: number) => v > 0), Infinity)
                      : parseFloat(String(p.salePrice ?? p.basePrice ?? 0))
                    return (
                      <div key={p.id} className='flex items-center gap-3 p-2.5 hover:bg-muted cursor-pointer transition-colors' onClick={() => addItem(p)}>
                        {img
                          ? <SafeImage src={mediaUrl(img)} alt='' className='w-10 h-10 rounded border object-cover shrink-0' />
                          : <div className='w-10 h-10 rounded border bg-muted flex items-center justify-center shrink-0'><Gift className='h-4 w-4 text-muted-foreground' /></div>}
                        <div className='flex-1 min-w-0'>
                          <p className='text-sm font-medium truncate'>{p.name}</p>
                          <p className='text-xs text-muted-foreground truncate'>{p.sku || '—'}</p>
                        </div>
                        <span className='text-sm font-medium shrink-0'>
                          {isVar && Array.isArray(p.variants) && p.variants.length > 0
                            ? (() => {
                                const prices = p.variants.map((v: any) => parseFloat(String(v.price ?? 0))).filter((v: number) => v > 0)
                                if (prices.length === 0) return <span className='text-muted-foreground'>—</span>
                                const min = Math.min(...prices)
                                const max = Math.max(...prices)
                                return <>৳{min.toFixed(2)}{min !== max ? ` – ৳${max.toFixed(2)}` : ''}</>
                              })()
                            : <>৳{price.toFixed(2)}</>
                          }
                        </span>
                        <Button type='button' variant='ghost' size='icon' className='h-7 w-7 shrink-0'>
                          <Plus className='h-4 w-4' />
                        </Button>
                      </div>
                    )
                  })}
                  {searchResults.data.length === 0 && (
                    <p className='p-3 text-sm text-muted-foreground text-center'>No products found</p>
                  )}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className='text-center py-8 text-muted-foreground'>
                <Gift className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p className='text-sm'>No items added yet. Search and add products above.</p>
              </div>
            ) : (
              <div className='border rounded-md divide-y'>
                {items.map((item, index) => {
                  const img = item.productImage
                  const isVar = item.productType === 'variable'
                  const attrs = isVar ? getUniqueAttrs(item) : []
                  const selections = item.attrSelections || {}

                  return (
                    <div key={index} className='p-3 space-y-2 hover:bg-muted/30 transition-colors'>
                      <div className='flex items-center gap-3'>
                        {img
                          ? <SafeImage src={mediaUrl(img)} alt='' className='w-12 h-12 rounded border object-cover shrink-0' />
                          : <div className='w-12 h-12 rounded border bg-muted flex items-center justify-center shrink-0'><Gift className='h-4 w-4 text-muted-foreground' /></div>}
                        <div className='flex-1 min-w-0'>
                          <p className='text-sm font-medium truncate'>{item.productName}</p>
                          {item.variantLabel && <p className='text-xs text-muted-foreground'>{item.variantLabel}</p>}
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          <div className='flex items-center gap-1 border rounded-md'>
                            <Button type='button' variant='ghost' size='icon' className='h-8 w-8 rounded-none' onClick={() => updateItemQty(index, item.quantity - 1)} disabled={item.quantity <= 1}>−</Button>
                            <span className='w-8 text-center text-sm tabular-nums'>{item.quantity}</span>
                            <Button type='button' variant='ghost' size='icon' className='h-8 w-8 rounded-none' onClick={() => updateItemQty(index, item.quantity + 1)}>+</Button>
                          </div>
                          <div className='flex items-center gap-1'>
                            <span className='text-xs text-muted-foreground'>৳</span>
                            <Input type='number' className='w-20 h-8 text-xs' value={item.price ?? ''} onChange={e => updateItemPrice(index, parseFloat(e.target.value) || 0)} placeholder='0' />
                          </div>
                          <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground hover:text-destructive' onClick={() => removeItem(index)}>
                            <X className='h-4 w-4' />
                          </Button>
                        </div>
                      </div>

                      {isVar && (
                        <div className='ml-[60px] space-y-2'>
                          <div className='flex items-center gap-2'>
                            <span className='text-xs font-medium text-muted-foreground'>Variant:</span>
                            <div className='flex gap-1 border rounded-md p-0.5'>
                              <Button
                                type='button'
                                variant={!item.flexibleMode ? 'default' : 'ghost'}
                                size='sm'
                                className='h-7 text-xs'
                                onClick={() => setItemFlexible(index, false)}
                              >
                                Fixed Variant
                              </Button>
                              <Button
                                type='button'
                                variant={item.flexibleMode ? 'default' : 'ghost'}
                                size='sm'
                                className='h-7 text-xs'
                                onClick={() => setItemFlexible(index, true)}
                              >
                                Flexible
                              </Button>
                            </div>
                          </div>

                          {item.flexibleMode ? (
                            <p className='text-xs text-muted-foreground'>All available variants will be unlocked for the customer.</p>
                          ) : (
                            <div className='flex flex-wrap gap-2'>
                              {attrs.map((attr, ai) => (
                                <select
                                  key={ai}
                                  value={selections[attr.name] || ''}
                                  onChange={e => setItemAttrSelection(index, attr.name, e.target.value)}
                                  className='h-8 rounded-md border border-input bg-background px-2 text-xs'
                                >
                                  <option value=''>Select {attr.name}</option>
                                  {attr.values.map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </select>
                              ))}
                              {item.variantId && item.variantLabel && (
                                <Badge variant='outline' className='text-xs gap-1'>
                                  {item.variantLabel}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value='pricing' className='flex-1 overflow-y-auto px-6 pb-4 space-y-4 mt-4'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label>Base Price (৳) *</Label>
                <Input type='number' value={basePrice} onChange={e => setBasePrice(e.target.value)} placeholder='0.00' />
              </div>
              <div className='space-y-2'>
                <Label>Sale Price (৳)</Label>
                <Input type='number' value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder='0.00' />
              </div>
            </div>
            {items.length > 0 && (
              <div className='border rounded-md p-3 bg-muted/50'>
                <p className='text-sm font-medium mb-2'>Component Items Total</p>
                <p className='text-2xl font-bold'>৳{items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0).toFixed(2)}</p>
                {basePrice && (
                  <p className='text-xs text-muted-foreground mt-1'>
                    Combo Price: ৳{parseFloat(basePrice || '0').toFixed(2)}
                    {parseFloat(basePrice) < items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0) && (
                      <span className='text-green-600 ml-2'>
                        Save ৳{(items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0) - parseFloat(basePrice)).toFixed(2)}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value='meta' className='flex-1 overflow-y-auto px-6 pb-4 space-y-4 mt-4'>
            <div className='space-y-2'>
              <Label>SEO Title</Label>
              <Input value={seoTitle} onChange={e => setSeoTitle(e.target.value)} placeholder='Meta title' />
            </div>
            <div className='space-y-2'>
              <Label>SEO Description</Label>
              <Textarea value={seoDesc} onChange={e => setSeoDesc(e.target.value)} rows={2} placeholder='Meta description' />
            </div>
            <div className='space-y-2'>
              <Label>SEO Keywords</Label>
              <Input value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)} placeholder='keyword1, keyword2' />
            </div>
          </TabsContent>
        </Tabs>

        <div className='flex justify-end gap-2 px-6 py-4 border-t shrink-0'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || !basePrice || items.length === 0 || saving}>
            {saving && <Loader2 className='h-4 w-4 mr-1 animate-spin' />}
            {isEdit ? 'Update Combo' : 'Create Combo'}
          </Button>
        </div>

        <MediaPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selected={pickerMulti ? images : image ? [image] : []}
          multiple={pickerMulti}
          onSelect={(urls) => {
            if (pickerMulti) {
              const set = new Set([...images, ...urls])
              setImages(Array.from(set))
            } else {
              setImage(urls[urls.length - 1] || '')
            }
            setPickerOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
