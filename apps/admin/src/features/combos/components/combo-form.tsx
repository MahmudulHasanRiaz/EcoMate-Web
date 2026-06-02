import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Plus, Search, Gift, Loader2, Image as ImageIcon } from 'lucide-react'
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
  variantId?: string; variantLabel?: string;
  quantity: number; price?: number;
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
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [manageStock, setManageStock] = useState(false)
  const [stock, setStock] = useState('0')
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
      setManageStock(currentRow.manageStock)
      setStock(String(currentRow.stock ?? 0))
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
      setManageStock(false); setStock('0'); setTags([]); setTagInput('')
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
      isActive, isFeatured, manageStock, stock: parseInt(stock) || 0,
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
    setItems(prev => [...prev, {
      productId: product.id,
      productName: product.name,
      productImage: Array.isArray(product.images) ? product.images[0] : '',
      quantity: 1,
      price: product.salePrice ? Number(product.salePrice) : Number(product.basePrice),
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

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) { setTags(prev => [...prev, t]); setTagInput('') }
  }

  const saving = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Combo' : 'Create Combo'}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className='grid grid-cols-4'>
            <TabsTrigger value='general'>General</TabsTrigger>
            <TabsTrigger value='items'>Items ({items.length})</TabsTrigger>
            <TabsTrigger value='pricing'>Pricing</TabsTrigger>
            <TabsTrigger value='meta'>Meta</TabsTrigger>
          </TabsList>

          <TabsContent value='general' className='space-y-4 mt-4'>
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
                <Label>Category</Label>
                <select className='flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm' value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                  <option value=''>No category</option>
                  {Array.isArray(cats) && cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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

          <TabsContent value='items' className='mt-4 space-y-4'>
            <div className='space-y-2'>
              <Label>Search Products to Add</Label>
              <div className='relative'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                <Input className='pl-8' value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder='Search by product name...' />
              </div>
              {productSearch.length >= 2 && searchResults?.data && (
                <div className='border rounded-md max-h-40 overflow-y-auto'>
                  {searchResults.data.map((p: any) => (
                    <div key={p.id} className='flex items-center gap-2 p-2 hover:bg-muted cursor-pointer' onClick={() => addItem(p)}>
                      <Gift className='h-4 w-4 text-muted-foreground' />
                      <span className='text-sm flex-1'>{p.name}</span>
                      <span className='text-xs text-muted-foreground'>৳{p.salePrice || p.basePrice}</span>
                      <Plus className='h-3.5 w-3.5' />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className='text-center py-8 text-muted-foreground'>
                <Gift className='h-8 w-8 mx-auto mb-2 opacity-50' />
                <p>No items added yet. Search and add products above.</p>
              </div>
            ) : (
              <div className='border rounded-md divide-y'>
                {items.map((item, index) => (
                  <div key={index} className='flex items-center gap-3 p-3'>
                    {item.productImage
                      ? <SafeImage src={item.productImage} alt='' className='w-10 h-10 rounded border object-cover' />
                      : <div className='w-10 h-10 rounded border bg-muted flex items-center justify-center'><Gift className='h-4 w-4' /></div>}
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium truncate'>{item.productName}</p>
                      {item.variantLabel && <p className='text-xs text-muted-foreground'>{item.variantLabel}</p>}
                    </div>
                    <div className='flex items-center gap-2'>
                      <div className='flex items-center gap-1'>
                        <Button type='button' variant='outline' size='icon' className='h-7 w-7' onClick={() => updateItemQty(index, item.quantity - 1)}>-</Button>
                        <span className='w-8 text-center text-sm'>{item.quantity}</span>
                        <Button type='button' variant='outline' size='icon' className='h-7 w-7' onClick={() => updateItemQty(index, item.quantity + 1)}>+</Button>
                      </div>
                      <Input type='number' className='w-20 h-8 text-xs' value={item.price || ''} onChange={e => updateItemPrice(index, parseFloat(e.target.value) || 0)} placeholder='Price' />
                      <Button type='button' variant='ghost' size='icon' className='h-7 w-7' onClick={() => removeItem(index)}>
                        <X className='h-4 w-4 text-destructive' />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value='pricing' className='space-y-4 mt-4'>
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
            <div className='flex items-center gap-2'>
              <Switch id='manageStock' checked={manageStock} onCheckedChange={setManageStock} />
              <Label htmlFor='manageStock'>Track Stock for this Combo</Label>
            </div>
            {manageStock && (
              <div className='space-y-2'>
                <Label>Stock Quantity</Label>
                <Input type='number' value={stock} onChange={e => setStock(e.target.value)} />
              </div>
            )}
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

          <TabsContent value='meta' className='space-y-4 mt-4'>
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

        <div className='flex justify-end gap-2 pt-4 border-t'>
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
