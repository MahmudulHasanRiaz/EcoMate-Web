import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Plus, Loader2, Package, Image as ImageIcon, Pencil, Check } from 'lucide-react'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { productsApi, type ProductResponse } from '../api'
import { apiClient } from '@/lib/api-client'
import { productOverrideApi } from '@/features/gateways/api'
import { MediaPicker } from '@/components/media-picker'
import { MultiSearchableSelect, type MultiSearchableOption } from '@/components/ui/multi-searchable-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
const imgUrl = appUrl
import { attributesApi } from '@/features/attributes/api'
import { categoriesApi } from '@/features/categories/api'
import { brandsApi } from '@/features/brands/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
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
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)

  const { data: fullProduct } = useQuery({
    queryKey: ['product', currentRow?.id || createdProductId],
    queryFn: () => productsApi.get(currentRow?.id || createdProductId!).then(r => r.data),
    enabled: (isEdit && !!currentRow?.id) || !!createdProductId,
  })

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list().then(r => Array.isArray(r.data) ? r.data : (r.data as any)?.data || []) })
  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list(true).then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []) })
  const { data: attrs } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list().then(r => r.data) })
  const { data: sizeCharts } = useQuery({ queryKey: ['size-charts'], queryFn: () => apiClient.get('/size-charts').then(r => r.data) })
  const { data: allTags } = useQuery({ queryKey: ['tags'], queryFn: () => apiClient.get('/tags').then(r => r.data) })
  const { data: overrideData } = useQuery({
    queryKey: ['product-overrides', currentRow?.id],
    queryFn: () => productOverrideApi.list(currentRow!.id).then(r => (Array.isArray(r.data) ? r.data : r.data?.data || [])),
    enabled: isEdit && !!currentRow?.id,
  })

  const categoryOptions = React.useMemo(() => {
    const flat = Array.isArray(cats) ? cats : []
    const map = new Map<string, any>()
    for (const c of flat) map.set(c.id, { id: c.id, name: c.name })
    const children = new Map<string, any[]>()
    const roots: any[] = []
    for (const c of flat) {
      if (c.parentId && map.has(c.parentId)) {
        const list = children.get(c.parentId) || []
        list.push(c.id)
        children.set(c.parentId, list)
      } else {
        roots.push(c.id)
      }
    }
    const result: MultiSearchableOption[] = []
    const walk = (ids: string[], depth: number) => {
      for (const id of ids) {
        const c = map.get(id)
        if (!c) continue
        result.push({ id: c.id, label: c.name, depth })
        const childIds = children.get(id)
        if (childIds) walk(childIds, depth + 1)
      }
    }
    walk(roots, 0)
    return result
  }, [cats])

  const brandOptions = useMemo(() => {
    return (brands || []).map((b: any) => ({ id: b.id, label: b.name }))
  }, [brands])

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
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [brandId, setBrandId] = useState<string>('')
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [manageStock, setManageStock] = useState(false)
  const [availabilityMode, setAvailabilityMode] = useState<string>('MANAGED_STOCK')
  const [standardCost, setStandardCost] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [tags, setTags] = useState<string>('')
  const [sizeChartId, setSizeChartId] = useState<string>('')
  const [categoryDefaultChart, setCategoryDefaultChart] = useState<{ id: string; name: string | null } | null>(null)
  const sizeChartOptions = useMemo(() => {
    const defaultLabel = categoryDefaultChart?.id ? 'None (use default)' : 'None';
    return [
      { id: '', label: defaultLabel },
      ...(Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as any)?.data || []).map((sc: any) => ({
        id: sc.id,
        label: sc.id === categoryDefaultChart?.id ? `${sc.name} (default)` : sc.name,
      })),
    ];
  }, [sizeCharts, categoryDefaultChart]);
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDesc, setSeoDesc] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')

  const [tagInput, setTagInput] = useState('')
  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [newValueInput, setNewValueInput] = useState<Record<string, string>>({})

  const [uploading] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; stock: number }>({ open: false, stock: 0 })
  const [regenerateConfirm, setRegenerateConfirm] = useState(false)
  const [manageStockJustToggled, setManageStockJustToggled] = useState(false)
  const [overrideFormState, setOverrideFormState] = useState<Record<string, { enabled: boolean; partialFixedAmount: string; partialPercentage: string }>>({
    FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
  })

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
      setStock(String(currentRow.managedStockQuantity ?? 0))
      setLowStockQty(currentRow.lowStockQty != null ? String(currentRow.lowStockQty) : '')
      setCategoryIds((currentRow as any).productCategories?.map((pc: any) => pc.categoryId) || [])
      setBrandId(currentRow.brandId || '')
      setIsActive(currentRow.isActive ?? true)
      setIsFeatured(currentRow.isFeatured ?? false)
      setManageStock(currentRow.manageStock ?? false)
      setAvailabilityMode(currentRow.availabilityMode || 'MANAGED_STOCK')
      setStandardCost(currentRow.standardCost != null ? String(currentRow.standardCost) : '')
      setImages(Array.isArray(currentRow.images) ? currentRow.images : [])
      setTags(Array.isArray(currentRow.tags) ? currentRow.tags.join(', ') : '')
      setSizeChartId((currentRow as any).sizeChartId || '')
      setSeoTitle((currentRow.seoMeta as any)?.title || '')
      setSeoDesc((currentRow.seoMeta as any)?.description || '')
      setSeoKeywords((currentRow.seoMeta as any)?.keywords || '')
    } else {
      setName(''); setSlug(''); setType('simple'); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
      setSku(''); setStock('0'); setLowStockQty(''); setCategoryIds([]); setBrandId(''); setIsActive(true); setIsFeatured(false);
      setManageStock(false); setAvailabilityMode('MANAGED_STOCK'); setStandardCost(''); setImages([]); setTags(''); setSizeChartId(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
      setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({});
    }
    setTab('general')
  }, [open, currentRow, isEdit])

  useEffect(() => {
    if (type === 'variable') {
      setStock('0')
      setManageStock(false)
    }
  }, [type])

  useEffect(() => {
    if (categoryIds.length > 0 && categoryIds[0]) {
      apiClient.get(`/categories/${categoryIds[0]}`).then(r => {
        const cat = r.data as any
        const chartId = cat?.sizeChartId || null
        if (chartId) {
          const charts = Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as any)?.data || []
          const chart = charts.find((sc: any) => sc.id === chartId)
          setCategoryDefaultChart({ id: chartId, name: chart?.name || null })
        } else {
          setCategoryDefaultChart(null)
        }
      }).catch(() => setCategoryDefaultChart(null))
    } else {
      setCategoryDefaultChart(null)
    }
  }, [categoryIds, sizeCharts])

  useEffect(() => {
    if (!overrideData) return
    const state: Record<string, { enabled: boolean; partialFixedAmount: string; partialPercentage: string }> = {
      FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    }
    for (const ov of overrideData) {
      const key = ov.paymentOptionType as string
      if (state[key]) {
        state[key].enabled = ov.enabled ?? false
        state[key].partialFixedAmount = ov.partialFixedAmount != null ? String(ov.partialFixedAmount) : ''
        state[key].partialPercentage = ov.partialPercentage != null ? String(ov.partialPercentage) : ''
      }
    }
    setOverrideFormState(state)
  }, [overrideData])

  const reset = () => {
    setName(''); setSlug(''); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
    setSku(''); setStock('0'); setLowStockQty(''); setCategoryIds([]); setBrandId(''); setIsActive(true); setIsFeatured(false);
    setManageStock(false); setAvailabilityMode('MANAGED_STOCK'); setStandardCost(''); setImages([]); setTags(''); setSizeChartId(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
    setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({}); setManageStockJustToggled(false); setConfirmDialog({ open: false, stock: 0 });
    setCreatedProductId(null); setRegenerateConfirm(false);
    setOverrideFormState({
      FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    })
  }

  const createMut = useMutation({
    mutationFn: productsApi.create,
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const createdId = res.data?.id || res.id;
      if (type === 'variable' && selectedAttrs.length > 0 && createdId) {
        setCreatedProductId(createdId);
        setTab('variants');
        toast.success('Product created. Now configure variants.');
      } else {
        onOpenChange(false);
        reset();
        toast.success('Product created');
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); onOpenChange(false); toast.success('Product updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const genVariantMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.generateVariants(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (currentRow?.id) queryClient.invalidateQueries({ queryKey: ['product', currentRow.id] });
      toast.success('Variants generated');
    },
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

  const upsertOverrideMut = useMutation({
    mutationFn: ({ type, data }: { type: string; data: any }) => productOverrideApi.upsert(currentRow!.id, type, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['product-overrides', currentRow?.id] }) },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving payment override'),
  })

  const handleOverrideToggle = (type: string, enabled: boolean) => {
    const update: any = { enabled }
    if (type === 'PARTIAL_PAYMENT') {
      const cur = overrideFormState[type]
      if (cur.partialFixedAmount) update.partialFixedAmount = parseFloat(cur.partialFixedAmount)
      if (cur.partialPercentage) update.partialPercentage = parseFloat(cur.partialPercentage)
    }
    upsertOverrideMut.mutate({ type, data: update })
    setOverrideFormState(prev => ({ ...prev, [type]: { ...prev[type], enabled } }))
  }

  const handlePartialBlur = (type: string) => {
    const cur = overrideFormState[type]
    if (!cur?.enabled) return
    const update: any = { enabled: true }
    if (cur.partialFixedAmount) update.partialFixedAmount = parseFloat(cur.partialFixedAmount)
    else update.partialFixedAmount = null
    if (cur.partialPercentage) update.partialPercentage = parseFloat(cur.partialPercentage)
    else update.partialPercentage = null
    upsertOverrideMut.mutate({ type, data: update })
  }

  const handleSave = () => {
    const payload: any = {
      name, slug: slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: desc || undefined, shortDesc: shortDesc || undefined,
      basePrice: parseFloat(basePrice) || 0, salePrice: salePrice ? parseFloat(salePrice) : undefined,
      sku: sku || undefined, type,
      categoryId: categoryIds[0] || undefined,
      brandId: brandId || null,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      lowStockQty: lowStockQty ? parseInt(lowStockQty) : undefined,
      sizeChartId: sizeChartId || undefined,
      images, tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined, isActive, isFeatured,
      seoMeta: seoTitle || seoDesc ? { title: seoTitle, description: seoDesc, keywords: seoKeywords } : undefined,
    }
    payload.availabilityMode = availabilityMode
    payload.standardCost = standardCost ? parseFloat(standardCost) : undefined
    if (type !== 'variable') {
      payload.manageStock = manageStock
      if (!isEdit && availabilityMode === 'MANAGED_STOCK') {
        payload.managedStockQuantity = parseInt(stock) || 0
      } else if (manageStockJustToggled && availabilityMode === 'MANAGED_STOCK') {
        payload.managedStockQuantity = parseInt(stock) || 0
      }
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
    const productId = currentRow?.id || createdProductId
    if (!productId || selectedAttrs.length === 0) return
    // If variants already exist, warn about regeneration
    if (variantList.length > 0 && !regenerateConfirm) {
      setRegenerateConfirm(true)
      return
    }
    setRegenerateConfirm(false)
    const allValueIds = Object.values(selectedValues).flat()
    genVariantMut.mutate({
      id: productId,
      data: {
        attributeIds: selectedAttrs,
        attributeValueIds: allValueIds.length > 0 ? allValueIds : undefined,
        defaultPrice: basePrice ? parseFloat(basePrice) : undefined,
        defaultManagedStockQuantity: manageStock ? (parseInt(stock) || 0) : 10,
      },
    })
  }

  const removeImage = (url: string) => setImages(prev => prev.filter(i => i !== url))

  const variantList = fullProduct?.variants || currentRow?.variants || []

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
            <TabsTrigger value='payments'>Payments</TabsTrigger>
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
                <div className='grid grid-cols-4 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Categories</Label>
                    <MultiSearchableSelect
                      options={categoryOptions}
                      value={categoryIds}
                      onChange={setCategoryIds}
                      placeholder='Search categories...'
                      searchPlaceholder='Type to search...'
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Brand</Label>
                    <SearchableSelect
                      options={brandOptions}
                      value={brandId}
                      onChange={setBrandId}
                      placeholder='Search brands...'
                      searchPlaceholder='Type to search...'
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>SKU</Label>
                    <Input value={sku} onChange={e => setSku(e.target.value)} placeholder='PRD-001' />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Tags</Label>
                    <div className='flex flex-wrap gap-1.5 min-h-[36px] p-1.5 border rounded-md'>
                      {tags ? tags.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                        <Badge key={t} variant='secondary' className='gap-1 cursor-pointer' onClick={() => {
                          const arr = tags.split(',').map(x => x.trim()).filter(Boolean)
                          setTags(arr.filter(x => x !== t).join(', '))
                        }}>
                          {t} <X className='h-3 w-3' />
                        </Badge>
                      )) : <span className='text-xs text-muted-foreground px-1'>Click below to add tags</span>}
                    </div>
                    <div className='flex flex-wrap gap-1.5'>
                      {(Array.isArray(allTags) ? allTags : (allTags as any)?.data || []).map((tag: any) => {
                        const tagName = tag.name
                        const isSelected = tags.split(',').map(t => t.trim()).filter(Boolean).includes(tagName)
                        return (
                          <Badge
                            key={tag.id}
                            variant={isSelected ? 'default' : 'outline'}
                            className='cursor-pointer text-xs'
                            onClick={() => {
                              const arr = tags.split(',').map(x => x.trim()).filter(Boolean)
                              if (isSelected) {
                                setTags(arr.filter(x => x !== tagName).join(', '))
                              } else {
                                setTags([...arr, tagName].join(', '))
                              }
                            }}
                          >
                            {tagName} ({tag._count?.products ?? tag.productCount ?? 0})
                          </Badge>
                        )
                      })}
                    </div>
                    <div className='flex items-center gap-2'>
                      <Input
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && tagInput.trim()) {
                            e.preventDefault()
                            const arr = tags.split(',').map(x => x.trim()).filter(Boolean)
                            if (!arr.includes(tagInput.trim())) {
                              setTags([...arr, tagInput.trim()].join(', '))
                            }
                            setTagInput('')
                          }
                        }}
                        placeholder='Type tag name and press Enter...'
                        className='h-7 text-xs'
                      />
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 text-xs shrink-0'
                        disabled={!tagInput.trim()}
                        onClick={() => {
                          const arr = tags.split(',').map(x => x.trim()).filter(Boolean)
                          if (!arr.includes(tagInput.trim())) {
                            setTags([...arr, tagInput.trim()].join(', '))
                          }
                          setTagInput('')
                        }}
                      >
                        <Plus className='h-3 w-3 mr-1' /> Add
                      </Button>
                    </div>
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Size Chart</Label>
                    <SearchableSelect
                      options={sizeChartOptions}
                      value={sizeChartId}
                      onChange={setSizeChartId}
                      placeholder={categoryDefaultChart?.id ? 'None (use default)' : 'None'}
                      searchPlaceholder='Search size charts...'
                    />
                    {categoryDefaultChart?.id && (
                      <p className='text-xs text-muted-foreground mt-1'>
                        Default from{' '}
                        {(() => {
                          const c = Array.isArray(cats) ? cats.find((c: any) => c.id === categoryIds[0]) : null
                          return c?.name || 'selected category'
                        })()}
                        : {categoryDefaultChart.name}
                      </p>
                    )}
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label>Short Description</Label>
                  <Textarea value={shortDesc} onChange={e => setShortDesc(e.target.value)} rows={3} placeholder='Brief excerpt...' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Description</Label>
                  <RichTextEditor value={desc} onChange={setDesc} placeholder='Full product description...' minHeight={300} />
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
                  <div className='space-y-1.5'>
                    <Label>Standard Cost (COGS)</Label>
                    <Input type='number' step='0.01' value={standardCost} onChange={e => setStandardCost(e.target.value)} placeholder='0.00' />
                  </div>
                </div>
              </section>

              {/* Inventory */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Inventory</h3>
                <div className='space-y-1.5'>
                  <Label>Availability Mode</Label>
                  <select
                    className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    value={availabilityMode}
                    onChange={e => setAvailabilityMode(e.target.value)}
                  >
                    <option value='MANAGED_STOCK'>Managed Stock</option>
                    <option value='ALWAYS_IN_STOCK'>Always In Stock</option>
                    <option value='ALWAYS_OUT_OF_STOCK'>Always Out Of Stock</option>
                    <option value='INVENTORY_CONTROLLED'>Inventory Controlled</option>
                  </select>
                </div>
                {availabilityMode === 'MANAGED_STOCK' && type !== 'variable' && (
                  isEdit ? (
                    <div className='space-y-3'>
                      <div className='flex items-center gap-3'>
                        <Switch checked={manageStock} onCheckedChange={(v) => {
                          if (!v && parseInt(stock) > 0) {
                            setConfirmDialog({ open: true, stock: parseInt(stock) })
                          } else {
                            setManageStock(v)
                            if (v) setManageStockJustToggled(true)
                          }
                        }} />
                        <Label>Manage Stock</Label>
                      </div>
                      {manageStock ? (
                        <>
                          <div className='flex items-center gap-3'>
                            <Badge variant='outline' className='text-sm px-3 py-1'>
                              {manageStockJustToggled ? 'Initial Stock:' : 'Current Stock:'} <strong className='ml-1'>{stock}</strong>
                            </Badge>
                            {manageStockJustToggled ? (
                              <div className='space-y-1.5 w-40'>
                                <Label className='text-xs'>Quantity</Label>
                                <Input type='number' value={stock} onChange={e => setStock(e.target.value)} placeholder='0' className='h-8 text-xs' />
                              </div>
                            ) : (
                              <div className='space-y-1.5 w-40'>
                                <Label className='text-xs'>Low Stock Alert</Label>
                                <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' className='h-8 text-xs' />
                              </div>
                            )}
                          </div>
                          {!manageStockJustToggled && (
                            <div className='bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                              <p className='text-xs text-blue-700 dark:text-blue-300'>
                                Stock can only be adjusted from <strong>Inventory → Adjust Stock</strong>.
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className='text-sm text-muted-foreground'>Stock status-based (In Stock / Out of Stock). No quantity tracking.</p>
                      )}
                    </div>
                  ) : (
                    <div className='space-y-3'>
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
                    </div>
                  )
                )}
                {availabilityMode === 'MANAGED_STOCK' && type === 'variable' && (
                  isEdit ? (
                    <div className='space-y-3'>
                      <p className='text-sm text-muted-foreground'>Stock is managed at the variant level. Each variant has its own stock quantity.</p>
                      <div className='bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          To adjust stock, go to <strong>Inventory → Adjust Stock</strong> and select a variant.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className='text-sm text-muted-foreground'>Stock is managed at the variant level. Each variant has its own stock quantity.</p>
                  )
                )}
                {availabilityMode === 'ALWAYS_IN_STOCK' && (
                  <div className='bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-green-700 dark:text-green-300'>
                      Product is always in stock. No quantity tracking.
                    </p>
                  </div>
                )}
                {availabilityMode === 'ALWAYS_OUT_OF_STOCK' && (
                  <div className='bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-red-700 dark:text-red-300'>
                      Product is marked as out of stock.
                    </p>
                  </div>
                )}
                {availabilityMode === 'INVENTORY_CONTROLLED' && (
                  <div className='bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-blue-700 dark:text-blue-300'>
                      Stock is controlled by the Inventory module.
                    </p>
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
              {type !== 'variable' ? (
                <div className='bg-muted/20 rounded-lg p-8 text-center space-y-3'>
                  <Package className='h-10 w-10 text-muted-foreground mx-auto' />
                  <div>
                    <h3 className='font-medium'>Variable product only</h3>
                    <p className='text-sm text-muted-foreground'>Switch product type to <strong>Variable Product</strong> in the General tab to configure variants.</p>
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
                      <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Step 2: Generate</h3>
                      {/* Generation preview */}
                      {selectedAttrs.length > 0 && (() => {
                        const counts: { attr: string; values: string; count: number }[] = []
                        let total = 1
                        for (const attrId of selectedAttrs) {
                          const attr = (attrs || []).find((a: any) => a.id === attrId)
                          if (!attr) continue
                          const vals = selectedValues[attrId]
                          const activeValues = vals?.length
                            ? attr.values.filter((v: any) => vals.includes(v.id))
                            : (attr.values || [])
                          const count = activeValues.length || 0
                          if (count > 0) {
                            counts.push({ attr: attr.name, values: activeValues.map((v: any) => v.value).join(', '), count })
                            total *= count
                          }
                        }
                        const defaultPrice = basePrice ? parseFloat(basePrice) : undefined
                        const defaultStock = 10
                        return (
                          <div className='mt-3 bg-muted/20 rounded-lg p-4 space-y-2'>
                            <div className='flex items-center justify-between'>
                              <span className='text-sm font-medium'>Expected combinations: <strong>{total}</strong></span>
                              <span className='text-xs text-muted-foreground'>Each variant gets default stock: {defaultStock}</span>
                            </div>
                            {defaultPrice && <p className='text-xs text-muted-foreground'>Default price: ৳{defaultPrice.toFixed(2)} per variant</p>}
                            {counts.map(c => (
                              <div key={c.attr} className='text-xs text-muted-foreground'>
                                <span className='font-medium text-foreground'>{c.attr}</span>: {c.values} ({c.count})
                              </div>
                            ))}
                            {total > 50 && (
                              <p className='text-xs text-amber-600 font-medium'>⚠ Large combination set ({total} variants). Consider narrowing your attribute selection.</p>
                            )}
                          </div>
                        )
                      })()}
                      <div className='flex items-center gap-4 mt-3'>
                        {!currentRow && !createdProductId ? (
                          <div className='text-sm text-muted-foreground bg-muted/30 rounded-md px-4 py-2'>
                            Configure attributes above, then <strong>save the product first</strong> to enable variant generation.
                          </div>
                        ) : (
                          <Button onClick={handleGenerateVariants} disabled={selectedAttrs.length === 0 || genVariantMut.isPending} size='default'>
                            {genVariantMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Plus className='h-4 w-4 mr-2' />}
                            Generate Variants
                          </Button>
                        )}
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

            <TabsContent value='payments' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Payment Options</h3>
                <p className='text-xs text-muted-foreground'>Override global payment option settings for this product.</p>
                {!isEdit ? (
                  <p className='text-sm text-muted-foreground py-4'>Save the product first to configure payment overrides.</p>
                ) : (
                  <div className='space-y-2'>
                    {[
                      { type: 'FULL_PAYMENT', label: 'Full Payment', desc: 'One-time full payment' },
                      { type: 'PARTIAL_PAYMENT', label: 'Partial Payment', desc: 'Pay in installments' },
                      { type: 'CASH_ON_DELIVERY', label: 'Cash on Delivery', desc: 'Pay upon delivery' },
                    ].map(({ type, label, desc }) => (
                      <div key={type} className='border rounded-lg p-4 space-y-3'>
                        <div className='flex items-center justify-between'>
                          <div>
                            <p className='text-sm font-medium'>{label}</p>
                            <p className='text-xs text-muted-foreground'>{desc}</p>
                          </div>
                          <Switch
                            checked={overrideFormState[type]?.enabled || false}
                            onCheckedChange={(v) => handleOverrideToggle(type, v)}
                          />
                        </div>
                        {type === 'PARTIAL_PAYMENT' && overrideFormState[type]?.enabled && (
                          <div className='grid grid-cols-2 gap-4 pt-2 border-t'>
                            <div className='space-y-1.5'>
                              <Label className='text-xs'>Fixed Amount</Label>
                              <Input
                                type='number' step='0.01' placeholder='0.00'
                                value={overrideFormState[type]?.partialFixedAmount || ''}
                                onChange={(e) => setOverrideFormState(prev => ({
                                  ...prev,
                                  [type]: { ...prev[type], partialFixedAmount: e.target.value }
                                }))}
                                onBlur={() => handlePartialBlur(type)}
                              />
                            </div>
                            <div className='space-y-1.5'>
                              <Label className='text-xs'>Percentage (%)</Label>
                              <Input
                                type='number' step='0.01' min='0' max='100' placeholder='0'
                                value={overrideFormState[type]?.partialPercentage || ''}
                                onChange={(e) => setOverrideFormState(prev => ({
                                  ...prev,
                                  [type]: { ...prev[type], partialPercentage: e.target.value }
                                }))}
                                onBlur={() => handlePartialBlur(type)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

      {confirmDialog.open && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50' onClick={() => setConfirmDialog({ open: false, stock: 0 })}>
          <div className='bg-background rounded-lg shadow-lg max-w-sm w-full mx-4 p-6 space-y-4' onClick={e => e.stopPropagation()}>
            <h3 className='font-semibold text-lg'>Disable Stock Tracking?</h3>
            <p className='text-sm text-muted-foreground'>
              This product has <strong>{confirmDialog.stock} units</strong> in stock. Disabling stock tracking will remove all stock and switch to status-based (In Stock / Out of Stock).
            </p>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setConfirmDialog({ open: false, stock: 0 })}>
                Cancel
              </Button>
              <Button variant='destructive' onClick={() => { setManageStock(false); setManageStockJustToggled(false); setConfirmDialog({ open: false, stock: 0 }) }}>
                Remove Stock & Disable
              </Button>
            </div>
          </div>
        </div>
      )}

      {regenerateConfirm && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50' onClick={() => setRegenerateConfirm(false)}>
          <div className='bg-background rounded-lg shadow-lg max-w-sm w-full mx-4 p-6 space-y-4' onClick={e => e.stopPropagation()}>
            <h3 className='font-semibold text-lg'>Regenerate Variants?</h3>
            <p className='text-sm text-muted-foreground'>
              This product already has <strong>{variantList.length} variant(s)</strong>. Regenerating will <strong className='text-destructive'>delete all existing variants</strong> and recreate them with default prices and stock. Any custom prices, images, or inventory adjustments will be lost.
            </p>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setRegenerateConfirm(false)}>
                Cancel
              </Button>
              <Button variant='destructive' onClick={handleGenerateVariants}>
                Delete & Regenerate
              </Button>
            </div>
          </div>
        </div>
      )}
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
    const field = editing as 'price' | 'salePrice' | 'standardCost' | 'sku'
    if (field === 'sku') {
      if (!editValue.trim()) {
        toast.error('SKU cannot be empty')
        cancelEdit()
        return
      }
      onUpdate({ sku: editValue.trim() })
    } else if (field === 'price') {
      const val = parseFloat(editValue)
      if (isNaN(val) || val < 0) {
        toast.error('Price must be a valid positive number')
        cancelEdit()
        return
      }
      onUpdate({ price: val })
    } else if (field === 'salePrice') {
      const val = editValue === '' ? null : parseFloat(editValue)
      if (val !== null && (isNaN(val) || val < 0)) {
        toast.error('Sale price must be a valid positive number')
        cancelEdit()
        return
      }
      onUpdate({ salePrice: val })
    } else if (field === 'standardCost') {
      const val = editValue === '' ? null : parseFloat(editValue)
      if (val !== null && (isNaN(val) || val < 0)) {
        toast.error('Standard cost must be a valid positive number')
        cancelEdit()
        return
      }
      onUpdate({ standardCost: val })
    }
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
      <div className='flex-1 min-w-0 grid grid-cols-5 gap-3 items-center'>
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

        {/* Reg. Price */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Reg. Price</p>
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

        {/* Sale Price */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Sale Price</p>
          {editing === 'salePrice' ? (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{currencySymbol}</span>
              <Input type='number' step='0.01' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-24' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('salePrice', variant.salePrice)} className='flex items-center gap-1 group'>
              {variant.salePrice ? (
                <span className='text-green-600 font-medium'>{currencySymbol}{Number(variant.salePrice).toFixed(2)}</span>
              ) : (
                <span className='text-muted-foreground italic text-xs'>—</span>
              )}
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Standard Cost */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Std. Cost</p>
          {editing === 'standardCost' ? (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{currencySymbol}</span>
              <Input type='number' step='0.01' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-24' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('standardCost', variant.standardCost)} className='flex items-center gap-1 group'>
              {variant.standardCost != null ? (
                <span>{currencySymbol}{Number(variant.standardCost).toFixed(2)}</span>
              ) : (
                <span className='text-muted-foreground italic text-xs'>—</span>
              )}
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
