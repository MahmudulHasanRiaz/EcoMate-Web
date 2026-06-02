import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Plus, Loader2, Package, Image as ImageIcon, Pencil, Check } from 'lucide-react'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { productsApi, type ProductResponse } from '../api'
import { MediaPicker } from '@/components/media-picker'

const imgUrl = appUrl
import { attributesApi } from '@/features/attributes/api'
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

type Props = { open: boolean; onOpenChange: (v: boolean) => void; currentRow?: ProductResponse; mode: 'add' | 'edit' }

export function ProductForm({ open, onOpenChange, currentRow, mode }: Props) {
  const queryClient = useQueryClient()
  const isEdit = mode === 'edit'
  const [tab, setTab] = useState('general')

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list().then(r => Array.isArray(r.data) ? r.data : []) })
  const { data: attrs } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list().then(r => r.data) })

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [type, setType] = useState<string>('simple')
  const [desc, setDesc] = useState('')
  const [shortDesc, setShortDesc] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [sku, setSku] = useState('')
  const [stock, setStock] = useState('0')
  const [lowStockQty, setLowStockQty] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [manageStock, setManageStock] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [tags, setTags] = useState<string>('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDesc, setSeoDesc] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')

  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [newValueInput, setNewValueInput] = useState<Record<string, string>>({})
  const [variantPrice, setVariantPrice] = useState('')
  const [variantStock, setVariantStock] = useState('0')

  const [uploading] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)

  const prevRowId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    const isSameRow = currentRow?.id === prevRowId.current
    if (isSameRow) return

    prevRowId.current = currentRow?.id

    if (isEdit && currentRow) {
      setName(currentRow.name || '')
      setSlug(currentRow.slug || '')
      setType(currentRow.type || 'simple')
      setDesc(currentRow.description || '')
      setShortDesc(currentRow.shortDesc || '')
      setBasePrice(String(currentRow.basePrice ?? ''))
      setSalePrice(currentRow.salePrice != null ? String(currentRow.salePrice) : '')
      setSku(currentRow.sku || '')
      setStock(String(currentRow.stock ?? 0))
      setLowStockQty(currentRow.lowStockQty != null ? String(currentRow.lowStockQty) : '')
      setCategoryId(currentRow.categoryId || '')
      setIsActive(currentRow.isActive ?? true)
      setIsFeatured(currentRow.isFeatured ?? false)
      setManageStock(currentRow.manageStock ?? false)
      setImages(Array.isArray(currentRow.images) ? currentRow.images : [])
      setTags(Array.isArray(currentRow.tags) ? currentRow.tags.join(', ') : '')
      setSeoTitle((currentRow.seoMeta as any)?.title || '')
      setSeoDesc((currentRow.seoMeta as any)?.description || '')
      setSeoKeywords((currentRow.seoMeta as any)?.keywords || '')
    } else {
      setName(''); setSlug(''); setType('simple'); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
      setSku(''); setStock('0'); setLowStockQty(''); setCategoryId(''); setIsActive(true); setIsFeatured(false);
      setManageStock(false); setImages([]); setTags('');       setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
      setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({}); setVariantPrice(''); setVariantStock('0');
    }
    setTab('general')
  }, [open, currentRow, isEdit])

  const reset = () => {
    setName(''); setSlug(''); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
    setSku(''); setStock('0'); setLowStockQty(''); setCategoryId(''); setIsActive(true); setIsFeatured(false);
    setManageStock(false); setImages([]); setTags(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
    setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({}); setVariantPrice(''); setVariantStock('0');
  }

  const createMut = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); onOpenChange(false); reset(); toast.success('Product created'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); onOpenChange(false); toast.success('Product updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const genVariantMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.generateVariants(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); toast.success('Variants generated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateVariantMut = useMutation({
    mutationFn: ({ id, variantId, data }: { id: string; variantId: string; data: any }) =>
      productsApi.updateVariant(id, variantId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); toast.success('Variant updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const addAttrValueMut = useMutation({
    mutationFn: ({ attributeId, value }: { attributeId: string; value: string }) =>
      attributesApi.addValue(attributeId, { value }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      toast.success('Value added')
      setNewValueInput(prev => ({ ...prev, [vars.attributeId]: '' }))
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const handleSave = () => {
    const payload: any = {
      name, slug: slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: desc || undefined, shortDesc: shortDesc || undefined,
      basePrice: parseFloat(basePrice) || 0, salePrice: salePrice ? parseFloat(salePrice) : undefined,
      sku: sku || undefined, type, categoryId: categoryId || undefined,
      stock: parseInt(stock) || 0, lowStockQty: lowStockQty ? parseInt(lowStockQty) : undefined,
      images, tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined, isActive, isFeatured, manageStock,
      seoMeta: seoTitle || seoDesc ? { title: seoTitle, description: seoDesc, keywords: seoKeywords } : undefined,
    }
    if (isEdit && currentRow) updateMut.mutate({ id: currentRow.id, data: payload })
    else createMut.mutate(payload)
  }

  const toggleAttr = (id: string) => {
    setSelectedAttrs(prev => {
      if (prev.includes(id)) {
        setSelectedValues(v => { const { [id]: _, ...rest } = v; return rest })
        return prev.filter(a => a !== id)
      }
      return [...prev, id]
    })
  }

  const toggleValue = (attrId: string, valueId: string) => {
    setSelectedValues(prev => {
      const current = prev[attrId] || []
      const updated = current.includes(valueId) ? current.filter(v => v !== valueId) : [...current, valueId]
      if (updated.length === 0) {
        const { [attrId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [attrId]: updated }
    })
  }

  const handleGenerateVariants = () => {
    if (!currentRow || selectedAttrs.length === 0) return
    const allValueIds = Object.values(selectedValues).flat()
    genVariantMut.mutate({
      id: currentRow.id,
      data: {
        attributeIds: selectedAttrs,
        attributeValueIds: allValueIds.length > 0 ? allValueIds : undefined,
        defaultPrice: parseFloat(variantPrice) || (basePrice ? parseFloat(basePrice) : undefined),
        defaultStock: parseInt(variantStock) || (manageStock ? parseInt(stock) || 0 : 10),
      },
    })
  }

  const removeImage = (url: string) => setImages(prev => prev.filter(i => i !== url))

  const variantList = currentRow?.variants || []

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onOpenChange(false); reset(); } }}>
      <DialogContent className='!max-w-[92vw] max-w-[1400px] max-h-[95vh] overflow-hidden flex flex-col p-0'>
        <DialogHeader className='px-6 pt-6 pb-2'>
          <DialogTitle>{isEdit ? `Edit: ${currentRow?.name}` : 'Add New Product'}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className='flex-1 flex flex-col overflow-hidden'>
          <TabsList className='px-6 justify-start rounded-none border-b'>
            <TabsTrigger value='general'>General</TabsTrigger>
            <TabsTrigger value='images'>Images</TabsTrigger>
            <TabsTrigger value='variants' disabled={type !== 'variable'}>Variants</TabsTrigger>
            <TabsTrigger value='seo'>SEO</TabsTrigger>
          </TabsList>

          <div className='flex-1 overflow-y-auto px-8 py-6'>
            <TabsContent value='general' className='mt-0 space-y-8'>
              {/* Product Type + Status Row */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Product Settings</h3>
                <div className='grid grid-cols-2 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Product Type</Label>
                    <select
                      value={type}
                      onChange={e => setType(e.target.value)}
                      className='w-full rounded-md border px-3 py-2 text-sm bg-background'
                    >
                      <option value='simple'>Simple Product</option>
                      <option value='variable'>Variable Product</option>
                    </select>
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Status</Label>
                    <div className='flex items-center gap-4 h-10'>
                      <div className='flex items-center gap-2'>
                        <Switch checked={isActive} onCheckedChange={setIsActive} />
                        <Label className='font-normal text-sm'>{isActive ? 'Active' : 'Draft'}</Label>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
                        <Label className='font-normal text-sm'>{isFeatured ? 'Featured' : 'Regular'}</Label>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Basic Info */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Basic Information</h3>
                <div className='grid grid-cols-2 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Product Name *</Label>
                    <Input value={name} onChange={e => { setName(e.target.value); if (!isEdit) setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')) }} placeholder='Product name' />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Slug</Label>
                    <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder='product-slug' />
                  </div>
                </div>
                <div className='grid grid-cols-3 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Category</Label>
                    <select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                      <option value=''>None</option>
                      {(cats || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className='space-y-1.5'>
                    <Label>SKU</Label>
                    <Input value={sku} onChange={e => setSku(e.target.value)} placeholder='PRD-001' />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Tags</Label>
                    <Input value={tags} onChange={e => setTags(e.target.value)} placeholder='summer, sale, new' />
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label>Short Description</Label>
                  <Textarea value={shortDesc} onChange={e => setShortDesc(e.target.value)} rows={3} placeholder='Brief excerpt...' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Description</Label>
                  <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={10} placeholder='Full product description...' className='min-h-[200px]' />
                </div>
              </section>

              {/* Pricing */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Pricing</h3>
                <div className='grid grid-cols-3 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Regular Price *</Label>
                    <Input type='number' step='0.01' value={basePrice} onChange={e => setBasePrice(e.target.value)} placeholder='0.00' />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Sale Price</Label>
                    <Input type='number' step='0.01' value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder='0.00' />
                  </div>
                </div>
              </section>

              {/* Inventory */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Inventory</h3>
                <div className='flex items-center gap-3'>
                  <Switch checked={manageStock} onCheckedChange={setManageStock} />
                  <Label>Manage Stock</Label>
                </div>
                {manageStock ? (
                  <div className='grid grid-cols-3 gap-6'>
                    <div className='space-y-1.5'>
                      <Label>Stock Quantity</Label>
                      <Input type='number' value={stock} onChange={e => setStock(e.target.value)} placeholder='0' />
                    </div>
                    <div className='space-y-1.5'>
                      <Label>Low Stock Alert</Label>
                      <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' />
                    </div>
                  </div>
                ) : (
                  <div className='flex items-center gap-3'>
                    <Label>Stock Status:</Label>
                    <div className='flex gap-1 border rounded-md p-0.5'>
                      <Button
                        variant={parseInt(stock) > 0 ? 'default' : 'ghost'}
                        size='sm'
                        className='h-7 text-xs'
                        onClick={() => setStock('10')}
                      >
                        In Stock
                      </Button>
                      <Button
                        variant={parseInt(stock) <= 0 ? 'default' : 'ghost'}
                        size='sm'
                        className='h-7 text-xs'
                        onClick={() => setStock('0')}
                      >
                        Out of Stock
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value='images' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Product Images</h3>
                    <p className='text-xs text-muted-foreground mt-1'>First image is used as the Featured image</p>
                  </div>
                  <Button variant='outline' size='sm' onClick={() => setGalleryOpen(true)}>
                    <ImageIcon className='h-4 w-4 mr-1' /> Browse Library
                  </Button>
                </div>
                <div className='grid grid-cols-6 gap-3'>
                  {images.map((url, i) => (
                    <div key={i} className='relative group border rounded-lg overflow-hidden bg-muted/30 aspect-square'>
                      <SafeImage src={imgUrl(url)} alt='' className='w-full h-full object-cover' />
                      <button onClick={() => removeImage(url)} className='absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <X className='h-3 w-3' />
                      </button>
                      {i === 0 && <Badge className='absolute bottom-1 left-1 text-xs'>Featured</Badge>}
                    </div>
                  ))}
                  {images.length === 0 && (
                    <div className='col-span-6 flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg'>
                      <Package className='h-10 w-10 mb-3' />
                      <p className='text-sm'>No images selected</p>
                      <Button variant='outline' size='sm' className='mt-3' onClick={() => setGalleryOpen(true)}>Browse Library</Button>
                    </div>
                  )}
                </div>
              </div>
              <MediaPicker
                open={galleryOpen}
                onOpenChange={setGalleryOpen}
                selected={images}
                onSelect={(urls) => setImages(urls)}
              />
            </TabsContent>

            <TabsContent value='variants' className='mt-0 space-y-6'>
              {!currentRow ? (
                <div className='bg-muted/20 rounded-lg p-8 text-center space-y-3'>
                  <Package className='h-10 w-10 text-muted-foreground mx-auto' />
                  <div>
                    <h3 className='font-medium'>Create the product first</h3>
                    <p className='text-sm text-muted-foreground'>Fill in the General tab and save the product, then come back to configure its variants.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className='bg-muted/20 rounded-lg p-5 space-y-5'>
                    <div>
                      <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Step 1: Select Attributes & Values</h3>
                      <p className='text-xs text-muted-foreground mb-4'>Choose attributes and pick specific values for variant generation.</p>
                      <div className='space-y-3'>
                        {(attrs || []).map((attr: any) => (
                          <div key={attr.id} className='border rounded-lg overflow-hidden'>
                            <button
                              type='button'
                              onClick={() => toggleAttr(attr.id)}
                              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors ${
                                selectedAttrs.includes(attr.id) ? 'bg-primary/10 text-primary' : 'hover:bg-muted/30'
                              }`}
                            >
                              <span>{attr.name}</span>
                              <Badge variant={selectedAttrs.includes(attr.id) ? 'default' : 'outline'}>
                                {selectedAttrs.includes(attr.id) ? (selectedValues[attr.id]?.length || attr.values?.length || 0) + ' selected' : 'Click to select'}
                              </Badge>
                            </button>
                            {selectedAttrs.includes(attr.id) && (
                              <div className='px-4 pb-3 pt-2 space-y-2'>
                                <div className='flex flex-wrap gap-1.5'>
                                  {(attr.values || []).map((v: any) => (
                                    <Badge
                                      key={v.id}
                                      variant={(selectedValues[attr.id] || []).includes(v.id) ? 'default' : 'outline'}
                                      className='cursor-pointer text-xs'
                                      onClick={() => toggleValue(attr.id, v.id)}
                                    >
                                      {(selectedValues[attr.id] || []).includes(v.id) ? <Check className='h-3 w-3 mr-1' /> : null}
                                      {v.value}
                                    </Badge>
                                  ))}
                                  {(attr.values || []).length === 0 && (
                                    <p className='text-xs text-muted-foreground italic'>No values yet. Add one below.</p>
                                  )}
                                </div>
                                <div className='flex items-center gap-2'>
                                  <Input
                                    value={newValueInput[attr.id] || ''}
                                    onChange={e => setNewValueInput(prev => ({ ...prev, [attr.id]: e.target.value }))}
                                    placeholder='Add new value...'
                                    className='h-7 text-xs py-0 px-2'
                                  />
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 text-xs'
                                    disabled={!newValueInput[attr.id]?.trim() || addAttrValueMut.isPending}
                                    onClick={() => {
                                      const val = newValueInput[attr.id]?.trim()
                                      if (val) addAttrValueMut.mutate({ attributeId: attr.id, value: val })
                                    }}
                                  >
                                    {addAttrValueMut.isPending ? <Loader2 className='h-3 w-3 animate-spin' /> : <Plus className='h-3 w-3' />}
                                    Add
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {(!attrs || attrs.length === 0) && (
                          <p className='text-xs text-muted-foreground italic'>No attributes found. Create attributes first from the Attributes section.</p>
                        )}
                      </div>
                    </div>

                    <div className='border-t pt-5'>
                      <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Step 2: Set Default Values</h3>
                      <p className='text-xs text-muted-foreground mb-4'>Leave blank to inherit from parent product. You can edit individual variants later.</p>
                      <div className='grid grid-cols-3 gap-6 max-w-2xl'>
                        <div className='space-y-1.5'>
                          <Label>Default Price</Label>
                          <Input type='number' step='0.01' value={variantPrice} onChange={e => setVariantPrice(e.target.value)} placeholder={basePrice || '0.00'} />
                        </div>
                        <div className='space-y-1.5'>
                          <Label>Default Stock</Label>
                          <Input type='number' value={variantStock} onChange={e => setVariantStock(e.target.value)} placeholder={manageStock ? stock : '10'} />
                        </div>
                      </div>
                    </div>

                    <div className='border-t pt-5'>
                      <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Step 3: Generate</h3>
                      <div className='flex items-center gap-4 mt-3'>
                        <Button onClick={handleGenerateVariants} disabled={selectedAttrs.length === 0 || genVariantMut.isPending} size='default'>
                          {genVariantMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Plus className='h-4 w-4 mr-2' />}
                          Generate Variants
                        </Button>
                        <span className='text-xs text-muted-foreground'>
                          {selectedAttrs.length > 0
                            ? `Generates all combinations of selected attributes`
                            : 'Select attributes first'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {variantList.length > 0 && (
                    <div className='border rounded-lg overflow-hidden'>
                      <div className='bg-muted/30 px-4 py-2 border-b flex items-center justify-between'>
                        <h3 className='font-medium'>Variants ({variantList.length})</h3>
                        <span className='text-xs text-muted-foreground'>Click values to edit inline</span>
                      </div>
                      <div className='divide-y'>
                        {variantList.map(v => (
                          <VariantRow
                            key={v.id}
                            variant={v}
                            productId={currentRow!.id}
                            onUpdate={(data) => updateVariantMut.mutate({ id: currentRow!.id, variantId: v.id, data })}
                            onImagePick={() => { setActiveVariantId(v.id); setVariantPickerOpen(true) }}
                            currencySymbol='৳'
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <MediaPicker
                    open={variantPickerOpen}
                    onOpenChange={(v) => { setVariantPickerOpen(v); if (!v) setActiveVariantId(null) }}
                    selected={
                      activeVariantId
                        ? [variantList.find(v => v.id === activeVariantId)?.image || ''].filter(Boolean)
                        : []
                    }
                    multiple={false}
                    onSelect={(urls) => {
                      if (activeVariantId && currentRow) {
                        updateVariantMut.mutate({
                          id: currentRow.id,
                          variantId: activeVariantId,
                          data: { image: urls[urls.length - 1] || null },
                        })
                      }
                      setVariantPickerOpen(false)
                      setActiveVariantId(null)
                    }}
                  />
                </>
              )}
            </TabsContent>

            <TabsContent value='seo' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-5'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Search Engine Optimization</h3>
                <div className='grid grid-cols-2 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Meta Title</Label>
                    <Input value={seoTitle} onChange={e => setSeoTitle(e.target.value)} placeholder='SEO title...' />
                    <span className='text-xs text-muted-foreground'>{seoTitle.length} characters</span>
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Keywords</Label>
                    <Input value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)} placeholder='keyword1, keyword2, ...' />
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label>Meta Description</Label>
                  <Textarea value={seoDesc} onChange={e => setSeoDesc(e.target.value)} rows={3} placeholder='Meta description (max 160 chars)...' />
                  <span className={`text-xs ${seoDesc.length > 160 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{seoDesc.length}/160</span>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className='border-t px-6 py-3 flex justify-end gap-2'>
          <Button variant='outline' onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name || !basePrice || createMut.isPending || updateMut.isPending}>
            {createMut.isPending || updateMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : null}
            {isEdit ? 'Update' : 'Create'} Product
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VariantRow({
  variant,
  productId,
  onUpdate,
  onImagePick,
  currencySymbol,
}: {
  variant: ProductResponse['variants'][number]
  productId: string
  onUpdate: (data: any) => void
  onImagePick: () => void
  currencySymbol: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (field: string, current: any) => {
    setEditing(field)
    setEditValue(String(current ?? ''))
  }

  const saveEdit = () => {
    if (!editing) return
    const field = editing as 'price' | 'stock' | 'sku'
    const parsed = field === 'price' ? parseFloat(editValue) : field === 'stock' ? parseInt(editValue) : editValue
    onUpdate({ [field]: parsed })
    setEditing(null)
  }

  const cancelEdit = () => setEditing(null)

  return (
    <div className='p-3 flex items-center gap-3 text-sm hover:bg-muted/10 transition-colors'>
      <div className='h-12 w-12 rounded border bg-muted overflow-hidden shrink-0 flex items-center justify-center cursor-pointer' onClick={onImagePick}>
        {variant.image
          ? <SafeImage src={imgUrl(variant.image)} alt='' className='h-full w-full object-cover' />
          : <ImageIcon className='h-4 w-4 text-muted-foreground' />}
      </div>
      <div className='flex-1 min-w-0 grid grid-cols-4 gap-3 items-center'>
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Attribute</p>
          <p className='truncate'>{variant.attributeValues?.map(av => av.attributeValue.value).join(' / ')}</p>
        </div>

        {/* SKU */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>SKU</p>
          {editing === 'sku' ? (
            <div className='flex items-center gap-1'>
              <Input value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('sku', variant.sku)} className='flex items-center gap-1 group'>
              <span className='text-xs'>{variant.sku}</span>
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Price */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Price</p>
          {editing === 'price' ? (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{currencySymbol}</span>
              <Input type='number' step='0.01' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-24' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('price', variant.price)} className='flex items-center gap-1 group'>
              <span>{currencySymbol}{Number(variant.price || 0).toFixed(2)}</span>
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Stock */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Stock</p>
          {editing === 'stock' ? (
            <Input type='number' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-20' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
          ) : (
            <button onClick={() => startEdit('stock', variant.stock)} className='flex items-center gap-1 group'>
              <Badge variant='outline' className='text-xs'>{variant.stock}</Badge>
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
