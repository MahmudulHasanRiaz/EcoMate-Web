import { useState, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Upload, Plus, Loader2, Package } from 'lucide-react'
import { productsApi, type ProductResponse } from '../api'
import { uploadApi } from '@/features/media/api'
import { MediaPicker } from '@/components/media-picker'

function imgUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('http')) return url
  return `http://localhost:4000${url}`
}
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
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDesc, setSeoDesc] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')

  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([])
  const [variantPrice, setVariantPrice] = useState('')
  const [variantStock, setVariantStock] = useState('0')

  const [uploading, setUploading] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)

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
      setSeoTitle((currentRow.seoMeta as any)?.title || '')
      setSeoDesc((currentRow.seoMeta as any)?.description || '')
      setSeoKeywords((currentRow.seoMeta as any)?.keywords || '')
    } else {
      setName(''); setSlug(''); setType('simple'); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
      setSku(''); setStock('0'); setLowStockQty(''); setCategoryId(''); setIsActive(true); setIsFeatured(false);
      setManageStock(false); setImages([]); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
      setSelectedAttrs([]); setVariantPrice(''); setVariantStock('0');
    }
    setTab('general')
  }, [open, currentRow, isEdit])

  const reset = () => {
    setName(''); setSlug(''); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
    setSku(''); setStock('0'); setLowStockQty(''); setCategoryId(''); setIsActive(true); setIsFeatured(false);
    setManageStock(false); setImages([]); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
    setSelectedAttrs([]); setVariantPrice(''); setVariantStock('0');
  }

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const res = await uploadApi.file(file);
      setImages(prev => [...prev, res.data.url]);
    } catch { toast.error('Upload failed'); }
    setUploading(false);
    e.target.value = '';
  }, [])

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

  const handleSave = () => {
    const payload: any = {
      name, slug: slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: desc || undefined, shortDesc: shortDesc || undefined,
      basePrice: parseFloat(basePrice) || 0, salePrice: salePrice ? parseFloat(salePrice) : undefined,
      sku: sku || undefined, type, categoryId: categoryId || undefined,
      stock: parseInt(stock) || 0, lowStockQty: lowStockQty ? parseInt(lowStockQty) : undefined,
      images, isActive, isFeatured, manageStock,
      seoMeta: seoTitle || seoDesc ? { title: seoTitle, description: seoDesc, keywords: seoKeywords } : undefined,
    }
    if (isEdit && currentRow) updateMut.mutate({ id: currentRow.id, data: payload })
    else createMut.mutate(payload)
  }

  const handleGenerateVariants = () => {
    if (!currentRow || selectedAttrs.length === 0) return
    genVariantMut.mutate({ id: currentRow.id, data: { attributeIds: selectedAttrs, defaultPrice: parseFloat(variantPrice) || undefined, defaultStock: parseInt(variantStock) || 0 } })
  }

  const removeImage = (url: string) => setImages(prev => prev.filter(i => i !== url))

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onOpenChange(false); reset(); } }}>
      <DialogContent className='max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0'>
        <DialogHeader className='px-6 pt-6 pb-2 flex flex-row items-center justify-between'>
          <DialogTitle>{isEdit ? `Edit: ${currentRow?.name}` : 'Add New Product'}</DialogTitle>
          <div className='flex items-center gap-2'>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className='text-sm border rounded-md px-3 py-1.5 bg-background'
            >
              <option value='simple'>Simple Product</option>
              <option value='variable'>Variable Product</option>
            </select>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className='flex-1 flex flex-col overflow-hidden'>
          <TabsList className='px-6 justify-start rounded-none border-b'>
            <TabsTrigger value='general'>General</TabsTrigger>
            <TabsTrigger value='images'>Images</TabsTrigger>
            <TabsTrigger value='variants' disabled={type !== 'variable'}>Variants</TabsTrigger>
            <TabsTrigger value='seo'>SEO</TabsTrigger>
          </TabsList>

          <div className='flex-1 overflow-y-auto px-6 py-4'>
            <TabsContent value='general' className='mt-0 space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label>Name *</Label>
                  <Input value={name} onChange={e => { setName(e.target.value); if (!isEdit) setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')) }} placeholder='Product name' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Slug *</Label>
                  <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder='product-slug' />
                </div>
              </div>
              <div className='space-y-1.5'>
                <Label>Short Description</Label>
                <Textarea value={shortDesc} onChange={e => setShortDesc(e.target.value)} rows={2} placeholder='Brief excerpt...' />
              </div>
              <div className='space-y-1.5'>
                <Label>Description</Label>
                <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} placeholder='Full product description...' />
              </div>

              <div className='grid grid-cols-3 gap-4'>
                <div className='space-y-1.5'>
                  <Label>Regular Price *</Label>
                  <Input type='number' step='0.01' value={basePrice} onChange={e => setBasePrice(e.target.value)} placeholder='0.00' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Sale Price</Label>
                  <Input type='number' step='0.01' value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder='0.00' />
                </div>
                <div className='space-y-1.5'>
                  <Label>SKU</Label>
                  <Input value={sku} onChange={e => setSku(e.target.value)} placeholder='PRD-001' />
                </div>
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label>Category</Label>
                  <select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                    <option value=''>None</option>
                    {(cats || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className='space-y-1.5'>
                  <Label>Stock Qty</Label>
                  <Input type='number' value={stock} onChange={e => setStock(e.target.value)} placeholder='0' />
                </div>
              </div>

              <div className='grid grid-cols-2 gap-4'>
                <div className='flex items-center gap-3 pt-2'>
                  <Switch checked={manageStock} onCheckedChange={setManageStock} />
                  <Label>Manage Stock</Label>
                </div>
                {manageStock && (
                  <div className='space-y-1.5'>
                    <Label>Low Stock Alert</Label>
                    <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' />
                  </div>
                )}
              </div>

              <div className='flex gap-6 pt-2'>
                <div className='flex items-center gap-2'>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <Label>Active</Label>
                </div>
                <div className='flex items-center gap-2'>
                  <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
                  <Label>Featured</Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value='images' className='mt-0 space-y-4'>
              <div className='flex items-center gap-4'>
                <Button variant='outline' size='sm' onClick={() => setGalleryOpen(true)}>
                  <Upload className='h-4 w-4 mr-1' /> Browse Gallery
                </Button>
                <label className='cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 border rounded-md hover:bg-muted text-sm'>
                  <Upload className='h-4 w-4' />
                  {uploading ? 'Uploading...' : 'Upload New'}
                  <input type='file' accept='image/*' onChange={handleUpload} className='hidden' disabled={uploading} />
                </label>
                <span className='text-xs text-muted-foreground'>{images.length} image(s) selected</span>
              </div>
              <div className='grid grid-cols-4 gap-3'>
                {images.map((url, i) => (
                  <div key={i} className='relative group border rounded-lg overflow-hidden bg-muted/30'>
                    <img src={imgUrl(url)} alt='' className='w-full h-32 object-cover' />
                    <button onClick={() => removeImage(url)} className='absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                      <X className='h-3 w-3' />
                    </button>
                    {i === 0 && <Badge className='absolute bottom-1 left-1 text-xs'>Featured</Badge>}
                  </div>
                ))}
                {images.length === 0 && (
                  <div className='col-span-4 flex flex-col items-center justify-center py-8 text-muted-foreground border-2 border-dashed rounded-lg'>
                    <Package className='h-8 w-8 mb-2' />
                    <p className='text-sm'>No images selected</p>
                    <Button variant='outline' size='sm' className='mt-2' onClick={() => setGalleryOpen(true)}>Browse Gallery</Button>
                  </div>
                )}
              </div>
              <MediaPicker
                open={galleryOpen}
                onOpenChange={setGalleryOpen}
                selected={images}
                onSelect={(urls) => setImages(urls)}
              />
            </TabsContent>

            <TabsContent value='variants' className='mt-0 space-y-4'>
              <div className='p-4 border rounded-lg bg-muted/20'>
                <h3 className='font-medium mb-3'>Select Attributes for Variants</h3>
                <div className='flex flex-wrap gap-2 mb-4'>
                  {(attrs || []).map((attr: any) => (
                    <Badge
                      key={attr.id}
                      variant={selectedAttrs.includes(attr.id) ? 'default' : 'outline'}
                      className='cursor-pointer'
                      onClick={() => setSelectedAttrs(prev => prev.includes(attr.id) ? prev.filter(a => a !== attr.id) : [...prev, attr.id])}
                    >
                      {attr.name}
                    </Badge>
                  ))}
                </div>
                <div className='grid grid-cols-2 gap-4 mb-3'>
                  <div className='space-y-1.5'>
                    <Label>Default Price</Label>
                    <Input type='number' step='0.01' value={variantPrice} onChange={e => setVariantPrice(e.target.value)} placeholder={basePrice || '0.00'} />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Default Stock</Label>
                    <Input type='number' value={variantStock} onChange={e => setVariantStock(e.target.value)} placeholder='0' />
                  </div>
                </div>
                <Button onClick={handleGenerateVariants} disabled={selectedAttrs.length === 0 || genVariantMut.isPending} size='sm'>
                  {genVariantMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : <Plus className='h-4 w-4 mr-1' />}
                  Generate Variants
                </Button>
              </div>

              {currentRow?.variants && currentRow.variants.length > 0 && (
                <div>
                  <h3 className='font-medium mb-2'>Existing Variants ({currentRow.variants.length})</h3>
                  <div className='border rounded-md divide-y'>
                    {currentRow.variants.map(v => (
                      <div key={v.id} className='p-3 flex items-center justify-between text-sm'>
                        <div>
                          <p className='font-medium'>{v.sku}</p>
                          <p className='text-muted-foreground text-xs'>
                            {v.attributeValues?.map(av => av.attributeValue.value).join(' / ')}
                          </p>
                        </div>
                        <div className='flex items-center gap-4'>
                          <span>${Number(v.price || 0).toFixed(2)}</span>
                          <Badge variant='outline'>Stock: {v.stock}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value='seo' className='mt-0 space-y-4'>
              <div className='space-y-1.5'>
                <Label>Meta Title</Label>
                <Input value={seoTitle} onChange={e => setSeoTitle(e.target.value)} placeholder='SEO title...' />
              </div>
              <div className='space-y-1.5'>
                <Label>Meta Description</Label>
                <Textarea value={seoDesc} onChange={e => setSeoDesc(e.target.value)} rows={2} placeholder='Meta description (max 160 chars)...' />
              </div>
              <div className='space-y-1.5'>
                <Label>Keywords</Label>
                <Input value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)} placeholder='keyword1, keyword2, ...' />
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
