import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Plus, Loader2, Package, Image as ImageIcon, Pencil, Check, GripVertical, Star } from 'lucide-react'
import { appUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { productsApi, type ProductResponse } from '../api'
import { productOverrideApi } from '@/features/gateways/api'
import { MediaPicker } from '@/components/media-picker'
import { MultiSearchableSelect, type MultiSearchableOption } from '@/components/ui/multi-searchable-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { TagInput } from '@/components/ui/tag-input'
import { ManagedStockAdjustmentModal } from './managed-stock-adjustment-modal'
const imgUrl = appUrl
import { apiClient } from '@/lib/api-client'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'
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
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, rectSortingStrategy, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  const { data: overrideData } = useQuery({
    queryKey: ['product-overrides', currentRow?.id],
    queryFn: () => productOverrideApi.list(currentRow!.id).then(r => (Array.isArray(r.data) ? r.data : r.data?.data || [])),
    enabled: isEdit && !!currentRow?.id,
  })

  const { data: imEnabled = true } = useInventoryManagement()

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

  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [newValueInput, setNewValueInput] = useState<Record<string, string>>({})
  const [defaultVariantStock, setDefaultVariantStock] = useState('0')

  const [uploading] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [regenerateConfirm, setRegenerateConfirm] = useState(false)
  const [localVariants, setLocalVariants] = useState<any[]>([])
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false)
  const [showReviewGuard, setShowReviewGuard] = useState(false)
  const [reviewGuardItems, setReviewGuardItems] = useState<string[]>([])
  const [variantImgMgr, setVariantImgMgr] = useState<{ variantId: string; images: string[] } | null>(null)
  const [variantImgGalleryOpen, setVariantImgGalleryOpen] = useState(false)
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false)
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkSalePrice, setBulkSalePrice] = useState('')
  const [bulkStandardCost, setBulkStandardCost] = useState('')
  const [bulkStock, setBulkStock] = useState('')
  const [bulkOverridePrice, setBulkOverridePrice] = useState(false)
  const [bulkOverrideSalePrice, setBulkOverrideSalePrice] = useState(false)
  const [bulkOverrideStandardCost, setBulkOverrideStandardCost] = useState(false)
  const [bulkOverrideStock, setBulkOverrideStock] = useState(false)
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

    if (currentRow) {
      const isClone = !isEdit
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
      setCategoryIds((currentRow as any).productCategories?.map((pc: any) => pc.categoryId) || (currentRow.categoryId ? [currentRow.categoryId] : []))
      setBrandId(currentRow.brandId || '')
      setIsActive(currentRow.isActive ?? true)
      setIsFeatured(currentRow.isFeatured ?? false)
      setAvailabilityMode(currentRow.availabilityMode || (currentRow.manageStock ? 'MANAGED_STOCK' : 'INVENTORY_CONTROLLED'))
      setStandardCost(currentRow.standardCost != null ? String(currentRow.standardCost) : '')
      setImages(dedupUrls(Array.isArray(currentRow.images) ? currentRow.images : []))
      setTags(Array.isArray(currentRow.tags) ? currentRow.tags.join(', ') : '')
      setSizeChartId((currentRow as any).sizeChartId || '')
      setSeoTitle((currentRow.seoMeta as any)?.title || '')
      setSeoDesc((currentRow.seoMeta as any)?.description || '')
      setSeoKeywords((currentRow.seoMeta as any)?.keywords || '')
      if (isClone) {
        setLocalVariants(currentRow.variants?.map((v: any) => ({
          ...v,
          id: undefined,
          productId: undefined,
          sku: v.sku ? `${v.sku}-copy-${Date.now()}` : '',
        })) || [])
      }
    } else {
      setName(''); setSlug(''); setType('simple'); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
      setSku(''); setStock('0'); setLowStockQty(''); setCategoryIds([]); setBrandId(''); setIsActive(true); setIsFeatured(false);
      setAvailabilityMode('MANAGED_STOCK'); setStandardCost(''); setImages([]); setTags(''); setSizeChartId(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({});
      setDefaultVariantStock('0'); setLocalVariants([]);
    }
    setTab('general')
  }, [open, currentRow, isEdit])

  useEffect(() => {
    if (type === 'variable') {
      setStock('0')
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
    setAvailabilityMode('MANAGED_STOCK'); setStandardCost(''); setImages([]); setTags(''); setSizeChartId(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
    setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({});
    setCreatedProductId(null); setRegenerateConfirm(false); setLocalVariants([]);
    setOverrideFormState({
      FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    })
    setAdjustmentModalOpen(false)
  }

  const handleBackendError = (e: any) => {
    const msg = e.response?.data?.message || 'Error'
    const code = e.response?.data?.code
    if (code === 'ConflictException' || (typeof msg === 'string' && msg.toLowerCase().includes('slug'))) {
      setTab('general')
    }
    toast.error(typeof msg === 'string' ? msg : 'An error occurred')
  }

  const createMut = useMutation({
    mutationFn: productsApi.create,
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const createdId = res.data?.id || res.id;
      setLocalVariants([]);
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
    onError: handleBackendError,
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      onOpenChange(false)
      toast.success('Product updated')
    },
    onError: handleBackendError,
  })

  const genVariantMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.generateVariants(id, data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      const freshId = currentRow?.id || res?.data?.id
      if (freshId) queryClient.invalidateQueries({ queryKey: ['product', freshId] })
      toast.success('Variants generated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateVariantMut = useMutation({
    mutationFn: ({ id, variantId, data }: { id: string; variantId: string; data: any }) =>
      productsApi.updateVariant(id, variantId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      toast.success('Variant updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const reorderVariantsMut = useMutation({
    mutationFn: ({ id, orderedIds }: { id: string; orderedIds: string[] }) =>
      productsApi.reorderVariants(id, orderedIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
    },
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
    if (type !== 'variable' && availabilityMode === 'MANAGED_STOCK') {
      payload.managedStockQuantity = parseInt(stock) || 0
    }
    if (type === 'variable' && localVariants.length > 0) {
      payload.variants = localVariants.map(v => ({
        sku: v.sku,
        price: v.price,
        salePrice: v.salePrice || undefined,
        managedStockQuantity: v.managedStockQuantity || 0,
        standardCost: v.standardCost || undefined,
        image: v.images?.[0] || v.image || undefined,
        images: v.images || undefined,
        attributeValues: v.attributeValueIds.map((id: string) => ({ attributeValueId: id })),
      }))
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

  const cartesian = <T,>(arrays: T[][]): T[][] =>
    arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]] as T[][])

  const handleGenerateVariants = () => {
    if (selectedAttrs.length === 0) return

    const productId = currentRow?.id || createdProductId
    if (productId) {
      // Existing product — call API
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
          defaultSalePrice: salePrice ? parseFloat(salePrice) : undefined,
          defaultStandardCost: standardCost ? parseFloat(standardCost) : undefined,
          defaultManagedStockQuantity: parseInt(defaultVariantStock) || 0,
        },
      })
    } else {
      // New product — compute locally
      const groups: any[][] = []
      for (const attrId of selectedAttrs) {
        const attr = (attrs || []).find((a: any) => a.id === attrId)
        if (!attr) continue
        const vals = selectedValues[attrId]
        const activeValues = vals?.length
          ? attr.values.filter((v: any) => vals.includes(v.id))
          : (attr.values || [])
        if (activeValues.length > 0) groups.push(activeValues)
      }
      const combinations = cartesian(groups)
      const generated = combinations.map((combo, idx) => {
        const values = combo.map((av: any) => av.value)
        const fullSku = `${sku || 'PRD'}-${values.join('-').replace(/\s+/g, '-').replace(/\//g, '_').toUpperCase()}`
        return {
          _tempId: `_new_${idx}`,
          sku: fullSku,
          price: parseFloat(basePrice) || 0,
          salePrice: salePrice ? parseFloat(salePrice) : null,
          managedStockQuantity: parseInt(defaultVariantStock) || 0,
          standardCost: standardCost ? parseFloat(standardCost) : null,
          images: [],
          attributeValueIds: combo.map((av: any) => av.id),
          attributeValues: combo.map((av: any) => ({
            attributeValue: { value: av.value, id: av.id, attribute: { name: av.attribute?.name || '' } },
          })),
        }
      })
      setLocalVariants(generated)
      toast.success(`${generated.length} variants generated. Configure them then save.`)
    }
  }

  const dedupUrls = (urls: string[]) => [...new Set(urls)]

  const removeImage = (url: string) => setImages(prev => prev.filter(i => i !== url))

  const handleImageDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const idToUrl = (id: string) => images.find(u => `img-${u}` === id)
    const oldUrl = idToUrl(active.id as string)
    const newUrl = idToUrl(over.id as string)
    if (!oldUrl || !newUrl) return
    const oldIndex = images.indexOf(oldUrl)
    const newIndex = images.indexOf(newUrl)
    if (oldIndex === -1 || newIndex === -1) return
    setImages(arrayMove(images, oldIndex, newIndex))
  }

  const setPrimaryImage = (url: string) => {
    setImages(prev => {
      const filtered = prev.filter(i => i !== url)
      return [url, ...filtered]
    })
  }

  const imageDndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const imageIds = images.map(url => `img-${url}`)

  const openVariantImgMgr = (variant: any) => {
    const vid = variant.id || variant._tempId
    const imgs = variant.images?.length ? dedupUrls([...variant.images]) : (variant.image ? [variant.image] : [])
    setVariantImgMgr({ variantId: vid, images: imgs })
  }

  const saveVariantImgMgr = () => {
    if (!variantImgMgr) return
    const { variantId, images: mgrImages } = variantImgMgr
    if (isLocalMode) {
      setLocalVariants(prev => prev.map(lv =>
        (lv.id || lv._tempId) === variantId
          ? { ...lv, images: mgrImages, image: mgrImages[0] || null }
          : lv
      ))
      setVariantImgMgr(null)
    } else {
      updateVariantMut.mutate({
        id: currentRow?.id || createdProductId!,
        variantId,
        data: { images: mgrImages },
      }, {
        onSuccess: () => setVariantImgMgr(null),
      })
    }
  }

  const reorderVariantImg = (variantId: string, oldIndex: number, newIndex: number) => {
    if (!variantImgMgr || variantImgMgr.variantId !== variantId) return
    const reordered = arrayMove(variantImgMgr.images, oldIndex, newIndex)
    setVariantImgMgr({ ...variantImgMgr, images: reordered })
  }

  const setPrimaryVariantImg = (variantId: string, url: string) => {
    if (!variantImgMgr || variantImgMgr.variantId !== variantId) return
    const filtered = variantImgMgr.images.filter(i => i !== url)
    setVariantImgMgr({ ...variantImgMgr, images: [url, ...filtered] })
  }

  const removeVariantImg = (variantId: string, url: string) => {
    if (!variantImgMgr || variantImgMgr.variantId !== variantId) return
    setVariantImgMgr({ ...variantImgMgr, images: variantImgMgr.images.filter(i => i !== url) })
  }

  const handleBulkUpdate = () => {
    const patch: Record<string, any> = {}
    if (bulkOverridePrice && bulkPrice) patch.price = parseFloat(bulkPrice)
    if (bulkOverrideSalePrice) patch.salePrice = bulkSalePrice ? parseFloat(bulkSalePrice) : null
    if (bulkOverrideStandardCost) patch.standardCost = bulkStandardCost ? parseFloat(bulkStandardCost) : null
    if (bulkOverrideStock && bulkStock) patch.managedStockQuantity = parseInt(bulkStock) || 0
    if (Object.keys(patch).length === 0) { toast.error('Select at least one field to update'); return }

    if (isLocalMode) {
      setLocalVariants(prev => prev.map(lv => ({ ...lv, ...patch })))
      toast.success(`Updated ${variantList.length} variants`)
    } else {
      const rowId = currentRow?.id || createdProductId
      if (!rowId) return
      let done = 0
      const total = variantList.length
      for (const v of variantList) {
        updateVariantMut.mutate(
          { id: rowId, variantId: v.id, data: patch },
          { onSuccess: () => { done++; if (done === total) toast.success(`Updated ${total} variants`) } },
        )
      }
    }
    setBulkUpdateOpen(false)
    setBulkPrice(''); setBulkSalePrice(''); setBulkStandardCost(''); setBulkStock('')
    setBulkOverridePrice(false); setBulkOverrideSalePrice(false); setBulkOverrideStandardCost(false); setBulkOverrideStock(false)
  }

  const validateForSave = (): string[] => {
    const errors: string[] = []
    if (!name.trim()) errors.push('Product name is required')
    if (!basePrice || parseFloat(basePrice) <= 0) errors.push('Regular price is required')
    return errors
  }

  const handleSaveClick = (skipReviewGuard = false) => {
    const errors = validateForSave()
    if (errors.length > 0) {
      setTab('general')
      toast.error(errors[0])
      return
    }
    if (!isEdit && !skipReviewGuard) {
      const items: string[] = []
      if (images.length === 0) items.push('No product images configured')
      if (type === 'variable' && variantList.length === 0) items.push('Variable product has no variants')
      if (items.length > 0) {
        setReviewGuardItems(items)
        setShowReviewGuard(true)
        return
      }
    }
    handleSave()
  }

  const isLocalMode = localVariants.length > 0 && !currentRow && !createdProductId
  const variantList = isLocalMode ? localVariants : (fullProduct?.variants || currentRow?.variants || [])

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleVariantDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = variantList.findIndex((v: any) => (v.id || v._tempId) === active.id)
    const newIndex = variantList.findIndex((v: any) => (v.id || v._tempId) === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(variantList, oldIndex, newIndex)
    if (isLocalMode) {
      setLocalVariants(reordered)
    } else {
      const rowId = currentRow?.id || createdProductId!
      const orderedIds = reordered.map((v: any) => v.id)
      reorderVariantsMut.mutate({ id: rowId, orderedIds })
    }
  }

  const variantIds = variantList.map((v: any) => v.id || v._tempId)

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
                    <TagInput
                      value={tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []}
                      onChange={(arr) => setTags(arr.join(', '))}
                    />
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
                    {imEnabled && <option value='INVENTORY_CONTROLLED'>Inventory Controlled</option>}
                  </select>
                </div>
                {availabilityMode === 'MANAGED_STOCK' && type !== 'variable' && (
                  isEdit ? (
                    <div className='space-y-3'>
                      <div className='flex items-center gap-3'>
                        <Badge variant='outline' className='text-sm px-3 py-1'>
                          Current Stock: <strong className='ml-1'>{stock}</strong>
                        </Badge>
                        <div className='space-y-1.5 w-40'>
                          <Label className='text-xs'>Low Stock Alert</Label>
                          <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' className='h-8 text-xs' />
                        </div>
                      </div>
                      <div className='flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          Stock adjustments tracked in Managed Stock Ledger.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setActiveVariantId(null); setAdjustmentModalOpen(true); }}>
                          Adjust Stock
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className='flex flex-col sm:flex-row items-start sm:items-center gap-6'>
                      <div className='space-y-1.5 w-full sm:w-40'>
                        <Label>Low Stock Alert</Label>
                        <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' />
                      </div>
                      <div className='flex-1 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          Starting stock cannot be set here. Please load initial quantities via the <strong>Inventory &gt; Stock</strong> page's adjustment tool after creating the product to preserve ledger audit trail integrity.
                        </p>
                      </div>
                    </div>
                  )
                )}
                {availabilityMode === 'MANAGED_STOCK' && type === 'variable' && (
                  <div className='space-y-3'>
                    <p className='text-sm text-muted-foreground'>Stock is managed at the variant level.</p>
                    {isEdit && (
                      <div className='flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          Adjust variant stock using the Managed Stock tool.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setActiveVariantId(null); setAdjustmentModalOpen(true); }}>
                          Adjust Variants
                        </Button>
                      </div>
                    )}
                  </div>
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
                  <div className='flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-blue-700 dark:text-blue-300'>
                      Stock controlled by physical Inventory module. Managed Stock rules do not apply.
                    </p>
                    {isEdit && (
                       <Button type="button" variant="default" size="sm" onClick={() => {
                         window.open(`/op/inventory?productId=${currentRow?.id}`, '_blank')
                       }}>
                         Open Inventory
                       </Button>
                    )}
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value='images' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Product Images</h3>
                    <p className='text-xs text-muted-foreground mt-1'>Drag to reorder · first image is the Primary/thumbnail</p>
                  </div>
                  <Button variant='outline' size='sm' onClick={() => setGalleryOpen(true)}>
                    <ImageIcon className='h-4 w-4 mr-1' /> Browse Library
                  </Button>
                </div>
                <DndContext sensors={imageDndSensors} collisionDetection={closestCenter} onDragEnd={handleImageDragEnd}>
                  <SortableContext items={imageIds} strategy={rectSortingStrategy}>
                    <div className='grid grid-cols-6 gap-3'>
                      {images.map((url) => (
                        <SortableImageCard
                          key={`img-${url}`}
                          url={url}
                          isPrimary={images.indexOf(url) === 0}
                          onSetPrimary={setPrimaryImage}
                          onRemove={removeImage}
                        />
                      ))}
                      {images.length === 0 && (
                        <div className='col-span-6 flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg'>
                          <Package className='h-10 w-10 mb-3' />
                          <p className='text-sm'>No images selected</p>
                          <Button variant='outline' size='sm' className='mt-3' onClick={() => setGalleryOpen(true)}>Browse Library</Button>
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
              <MediaPicker
                open={galleryOpen}
                onOpenChange={setGalleryOpen}
                selected={images}
                multiple={true}
                onSelect={(urls) => setImages(dedupUrls(urls))}
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
                        return (
                          <div className='mt-3 bg-muted/20 rounded-lg p-4 space-y-2'>
                            <div className='flex items-center justify-between'>
                              <span className='text-sm font-medium'>Expected combinations: <strong>{total}</strong></span>
                              <span className='text-xs text-muted-foreground'>Default stock: {parseInt(defaultVariantStock) || 10} per variant</span>
                            </div>

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
                        <div className='flex items-center gap-2'>
                          <Button variant='outline' size='sm' onClick={() => setBulkUpdateOpen(true)} disabled={variantList.length === 0}>
                            Bulk Update
                          </Button>
                          <span className='text-xs text-muted-foreground'>Drag to reorder · Click values to edit inline</span>
                        </div>
                      </div>
                      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleVariantDragEnd}>
                        <SortableContext items={variantIds} strategy={verticalListSortingStrategy}>
                          <div className='divide-y'>
                            {variantList.map(v => {
                              const vid = v.id || v._tempId
                              return (
                                <SortableVariantRow key={vid} id={vid}>
                                  {isLocalMode ? (
                                    <VariantRow
                                      variant={v}
                                      productId=''
                                      onUpdate={(data) => {
                                        setLocalVariants(prev => prev.map(lv =>
                                          lv._tempId === v._tempId ? { ...lv, ...data } : lv
                                        ))
                                      }}
                                      onImagePick={() => openVariantImgMgr(v)}
                                      currencySymbol='৳'
                                    />
                                  ) : (
                                    <VariantRow
                                      variant={v}
                                      productId={currentRow?.id || createdProductId!}
                                      onUpdate={(data) => updateVariantMut.mutate({ id: currentRow?.id || createdProductId!, variantId: v.id, data })}
                                      onImagePick={() => openVariantImgMgr(v)}
                                      currencySymbol='৳'
                                      onAdjustStock={() => { setActiveVariantId(v.id); setAdjustmentModalOpen(true) }}
                                    />
                                  )}
                                </SortableVariantRow>
                              )
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}

                  <MediaPicker
                    open={variantPickerOpen}
                    onOpenChange={(v) => { setVariantPickerOpen(v); if (!v) setActiveVariantId(null) }}
                    selected={
                      activeVariantId
                        ? (() => {
                            const v = variantList.find((x: any) => (x.id || x._tempId) === activeVariantId)
                            if (!v) return []
                            const imgs = v.images?.length ? v.images : (v.image ? [v.image] : [])
                            return imgs
                          })()
                        : []
                    }
                    multiple={true}
                    onSelect={(urls) => {
                      if (isLocalMode && activeVariantId) {
                        setLocalVariants(prev => prev.map(lv =>
                          lv._tempId === activeVariantId ? { ...lv, images: urls, image: urls[0] || null } : lv
                        ))
                      } else if (activeVariantId && currentRow) {
                        updateVariantMut.mutate({
                          id: currentRow.id,
                          variantId: activeVariantId,
                          data: { images: urls },
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

        <div className='flex items-center justify-end gap-3 px-6 py-4 border-t mt-auto shrink-0 bg-muted/20'>
          <Button variant='outline' onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          <Button onClick={handleSaveClick} disabled={createMut.isPending || updateMut.isPending}>
            {(createMut.isPending || updateMut.isPending) && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {isEdit ? 'Update Product' : 'Create Product'}
          </Button>
        </div>
      </DialogContent>
      {adjustmentModalOpen && currentRow?.id && (
        <ManagedStockAdjustmentModal
          open={adjustmentModalOpen}
          onOpenChange={setAdjustmentModalOpen}
          initialProductId={currentRow.id}
          initialVariantId={activeVariantId || undefined}
        />
      )}

      {showReviewGuard && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50' onClick={() => setShowReviewGuard(false)}>
          <div className='bg-background rounded-lg shadow-lg max-w-md w-full mx-4 p-6 space-y-4' onClick={e => e.stopPropagation()}>
            <h3 className='font-semibold text-lg'>Review before creating</h3>
            <p className='text-sm text-muted-foreground'>
              The following configuration areas may need attention:
            </p>
            <div className='space-y-2'>
              {reviewGuardItems.map((item, i) => (
                <div key={i} className='flex items-center gap-2 text-sm border rounded-lg p-3'>
                  <span className='text-amber-500 font-bold'>⚠</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className='flex justify-end gap-3 pt-2'>
              <Button variant='outline' onClick={() => setShowReviewGuard(false)}>Continue Editing</Button>
              <Button onClick={() => { setShowReviewGuard(false); handleSaveClick(true); }} disabled={createMut.isPending || updateMut.isPending}>
                {(createMut.isPending || updateMut.isPending) && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Create Anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      {variantImgMgr && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50' onClick={() => setVariantImgMgr(null)}>
          <div className='bg-background rounded-lg shadow-lg max-w-lg w-full mx-4 p-6 space-y-4' onClick={e => e.stopPropagation()}>
            <div className='flex items-center justify-between'>
              <h3 className='font-semibold text-lg'>Variant Images</h3>
              <Button variant='outline' size='sm' onClick={() => { setVariantImgGalleryOpen(true) }}>
                <ImageIcon className='h-4 w-4 mr-1' /> Add Images
              </Button>
            </div>
            {variantImgMgr.images.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-10 text-muted-foreground border-2 border-dashed rounded-lg'>
                <Package className='h-8 w-8 mb-2' />
                <p className='text-sm'>No images for this variant</p>
                <Button variant='outline' size='sm' className='mt-2' onClick={() => setVariantImgGalleryOpen(true)}>Browse Library</Button>
              </div>
            ) : (
              <DndContext sensors={imageDndSensors} collisionDetection={closestCenter} onDragEnd={(event) => {
                const { active, over } = event
                if (!over || active.id === over.id) return
                const imgs = variantImgMgr.images
                const idToUrl = (id: string) => imgs.find(u => `vimg-${variantImgMgr.variantId}-${u}` === id)
                const oldUrl = idToUrl(active.id as string)
                const newUrl = idToUrl(over.id as string)
                if (!oldUrl || !newUrl) return
                const oldIdx = imgs.indexOf(oldUrl)
                const newIdx = imgs.indexOf(newUrl)
                if (oldIdx === -1 || newIdx === -1) return
                reorderVariantImg(variantImgMgr.variantId, oldIdx, newIdx)
              }}>
                <SortableContext items={variantImgMgr.images.map(u => `vimg-${variantImgMgr.variantId}-${u}`)} strategy={rectSortingStrategy}>
                  <div className='grid grid-cols-4 gap-3'>
                    {variantImgMgr.images.map((url) => {
                      const idx = variantImgMgr.images.indexOf(url)
                      return (
                        <SortableImageCard
                          key={`vimg-${variantImgMgr.variantId}-${url}`}
                          url={url}
                          isPrimary={idx === 0}
                          onSetPrimary={(u) => setPrimaryVariantImg(variantImgMgr.variantId, u)}
                          onRemove={(u) => removeVariantImg(variantImgMgr.variantId, u)}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            <div className='flex justify-end gap-3 pt-2 border-t'>
              <Button variant='outline' onClick={() => setVariantImgMgr(null)} disabled={updateVariantMut.isPending}>Cancel</Button>
              <Button onClick={saveVariantImgMgr} disabled={updateVariantMut.isPending}>
                {updateVariantMut.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Save Images
              </Button>
            </div>
          </div>
        </div>
      )}

      {variantImgGalleryOpen && variantImgMgr && (
        <MediaPicker
          open={variantImgGalleryOpen}
          onOpenChange={setVariantImgGalleryOpen}
          selected={variantImgMgr.images}
          multiple={true}
          onSelect={(urls) => {
            setVariantImgMgr(prev => prev ? { ...prev, images: dedupUrls(urls) } : null)
            setVariantImgGalleryOpen(false)
          }}
        />
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

      {bulkUpdateOpen && (
        <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50' onClick={() => setBulkUpdateOpen(false)}>
          <div className='bg-background rounded-lg shadow-lg max-w-md w-full mx-4 p-6 space-y-4' onClick={e => e.stopPropagation()}>
            <h3 className='font-semibold text-lg'>Bulk Update All Variants</h3>
            <p className='text-sm text-muted-foreground'>
              Check the fields you want to update. Only checked fields will be applied to all {variantList.length} variant(s).
            </p>
            <div className='space-y-3'>
              <label className='flex items-center gap-3 cursor-pointer'>
                <input type='checkbox' checked={bulkOverridePrice} onChange={e => setBulkOverridePrice(e.target.checked)} className='rounded' />
                <span className='text-sm w-24'>Price</span>
                <Input type='number' step='0.01' value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} placeholder='0.00' disabled={!bulkOverridePrice} className='flex-1' />
              </label>
              <label className='flex items-center gap-3 cursor-pointer'>
                <input type='checkbox' checked={bulkOverrideSalePrice} onChange={e => setBulkOverrideSalePrice(e.target.checked)} className='rounded' />
                <span className='text-sm w-24'>Sale Price</span>
                <Input type='number' step='0.01' value={bulkSalePrice} onChange={e => setBulkSalePrice(e.target.value)} placeholder='0.00' disabled={!bulkOverrideSalePrice} className='flex-1' />
              </label>
              <label className='flex items-center gap-3 cursor-pointer'>
                <input type='checkbox' checked={bulkOverrideStandardCost} onChange={e => setBulkOverrideStandardCost(e.target.checked)} className='rounded' />
                <span className='text-sm w-24'>Std Cost</span>
                <Input type='number' step='0.01' value={bulkStandardCost} onChange={e => setBulkStandardCost(e.target.value)} placeholder='0.00' disabled={!bulkOverrideStandardCost} className='flex-1' />
              </label>
              <label className='flex items-center gap-3 cursor-pointer'>
                <input type='checkbox' checked={bulkOverrideStock} onChange={e => setBulkOverrideStock(e.target.checked)} className='rounded' />
                <span className='text-sm w-24'>Stock Qty</span>
                <Input type='number' value={bulkStock} onChange={e => setBulkStock(e.target.value)} placeholder='0' disabled={!bulkOverrideStock} className='flex-1' />
              </label>
            </div>
            <div className='flex justify-end gap-3 pt-2'>
              <Button variant='outline' onClick={() => setBulkUpdateOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkUpdate}>Apply to All</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function SortableVariantRow(props: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : 0,
  }
  return (
    <div ref={setNodeRef} style={style} className='flex items-center'>
      <button
        type='button'
        className='cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground shrink-0 touch-none'
        {...attributes}
        {...listeners}
      >
        <GripVertical className='h-4 w-4' />
      </button>
      <div className='flex-1 min-w-0'>
        {props.children}
      </div>
    </div>
  )
}

function SortableImageCard({ url, isPrimary, onSetPrimary, onRemove }: { url: string; isPrimary: boolean; onSetPrimary: (url: string) => void; onRemove: (url: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `img-${url}` })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className='relative group border rounded-lg overflow-hidden bg-muted/30 aspect-square'>
      <SafeImage src={imgUrl(url)} alt='' className='w-full h-full object-cover' />
      <button
        type='button'
        className='absolute top-1 left-1 cursor-grab active:cursor-grabbing p-1 bg-black/40 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity touch-none'
        {...attributes}
        {...listeners}
      >
        <GripVertical className='h-3.5 w-3.5' />
      </button>
      <button
        type='button'
        onClick={() => onRemove(url)}
        className='absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity'
      >
        <X className='h-3 w-3' />
      </button>
      {isPrimary ? (
        <Badge className='absolute bottom-1 left-1 text-xs gap-1'>
          <Star className='h-3 w-3 fill-current' /> Primary
        </Badge>
      ) : (
        <button
          type='button'
          onClick={() => onSetPrimary(url)}
          className='absolute bottom-1 left-1 bg-foreground/70 text-background text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1'
        >
          <Star className='h-2.5 w-2.5' /> Primary
        </button>
      )}
    </div>
  )
}

function VariantRow({
  variant,
  productId,
  onUpdate,
  onImagePick,
  currencySymbol,
  onAdjustStock,
}: {
  variant: ProductResponse['variants'][number]
  productId: string
  onUpdate: (data: any) => void
  onImagePick: () => void
  currencySymbol: string
  onAdjustStock?: () => void
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
  const variantImages = variant.images?.length ? variant.images : (variant.image ? [variant.image] : [])

  return (
    <div className='p-3 flex items-center gap-3 text-sm hover:bg-muted/10 transition-colors'>
      <div className='shrink-0 cursor-pointer' onClick={() => {
        const e = new CustomEvent('openVariantImgMgr', { detail: variant })
        window.dispatchEvent(e)
      }}>
        {variantImages.length === 0 ? (
          <div className='h-12 w-12 rounded border bg-muted overflow-hidden flex items-center justify-center'>
            <ImageIcon className='h-4 w-4 text-muted-foreground' />
          </div>
        ) : (
          <div className='relative'>
            <div className='flex -space-x-2 hover:space-x-0.5 transition-all'>
              {variantImages.slice(0, 3).map((img: string, i: number) => (
                <div key={i} className='h-12 w-12 rounded border bg-muted overflow-hidden shadow-sm' style={{ zIndex: 3 - i }}>
                  <SafeImage src={imgUrl(img)} alt='' className='h-full w-full object-cover' />
                </div>
              ))}
              {variantImages.length > 3 && (
                <div className='h-12 w-12 rounded border bg-muted/50 overflow-hidden flex items-center justify-center text-xs text-muted-foreground shadow-sm' style={{ zIndex: 0 }}>
                  +{variantImages.length - 3}
                </div>
              )}
            </div>
            {variantImages.length > 0 && (
              <span className='absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] px-1 py-0.5 rounded-full leading-none border border-background'>
                {variantImages.length}
              </span>
            )}
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0 grid grid-cols-6 gap-3 items-center'>
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

        {/* Stock (read-only — edit via Inventory) */}
        <div className='min-w-0 flex items-center gap-1.5'>
          <div>
            <p className='font-medium text-xs text-muted-foreground mb-0.5'>Stock</p>
            <Badge variant={variant.managedStockQuantity > 0 ? 'secondary' : 'destructive'} className='text-xs'>
              {variant.managedStockQuantity}
            </Badge>
          </div>
          {onAdjustStock && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 mt-4"
              onClick={onAdjustStock}
              title="Adjust Stock"
            >
              <Pencil className="h-3 w-3" />
            </Button>
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
