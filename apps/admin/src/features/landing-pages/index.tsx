import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Globe, GlobeOff, Trash2, Pencil, ExternalLink, Code, Layout, Loader2, Search, X, Copy, Eye, EyeOff, ChevronUp, ChevronDown, ImagePlus } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { MediaPicker } from '@/components/media-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { landingPagesApi, type LandingPage } from './api'
import { AI_INSTRUCTION_SECTIONS, buildAiInstructions } from './ai-instructions'
import { buildPreviewUrl, buildSavePayload, buildStorefrontPageUrl, getLandingPageStatus } from './helpers'
import { apiClient } from '@/lib/api-client'
import { PageInfo } from '@/components/page-info'

/** Which section field the MediaPicker is currently choosing an image for. */
type PickerTarget =
  | { kind: 'hero'; sectionIndex: number }
  | { kind: 'gallery'; sectionIndex: number }
  | { kind: 'poster'; sectionIndex: number }
  | { kind: 'review-image'; sectionIndex: number; itemIndex: number }

export function LandingPages() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editRow, setEditRow] = useState<LandingPage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LandingPage | null>(null)
  const [tab, setTab] = useState('general')
  const [page, setPage] = useState(1)
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [pageType, setPageType] = useState<string>('template')
  const [templateId, setTemplateId] = useState('clothing')
  const [sections, setSections] = useState<any[]>([])
  const [customHtml, setCustomHtml] = useState('')
  const [customCss, setCustomCss] = useState('')
  const [selectedProducts, setSelectedProducts] = useState<{ id: string; name: string }[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [primaryColor, setPrimaryColor] = useState('#3730a3')
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const productSearchRef = useRef<HTMLDivElement>(null)
  const sectionAddRef = useRef<HTMLDivElement>(null)
  const [showSectionMenu, setShowSectionMenu] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['landing-pages', page],
    queryFn: () => landingPagesApi.list({ page, perPage: 10 }).then(r => r.data),
  })

  const pages = (data as any)?.data || []
  const totalPages = (data as any)?.meta?.totalPages || 1

  const createMut = useMutation({
    mutationFn: landingPagesApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); setFormOpen(false); reset(); toast.success('Landing page created'); setHasUnsaved(false); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => landingPagesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Saved'); setHasUnsaved(false); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: landingPagesApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); setDeleteTarget(null); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const publishMut = useMutation({
    mutationFn: landingPagesApi.publish,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Published'); },
  })

  const unpublishMut = useMutation({
    mutationFn: landingPagesApi.unpublish,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Unpublished'); },
  })

  const cloneMut = useMutation({
    mutationFn: (row: LandingPage) => landingPagesApi.create({
      title: `Copy of ${row.title}`,
      slug: `${row.slug}-copy-${Date.now()}`.slice(0, 60),
      pageType: row.pageType,
      templateId: row.templateId,
      sections: row.sections,
      customHtml: row.customHtml,
      customCss: row.customCss,
      productIds: Array.isArray(row.productIds) ? row.productIds : [],
      // comboIds intentionally NOT cloned/sent: combos render nowhere
      // (audit §3.3); existing rows keep their stored value untouched.
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Duplicated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const isPending = createMut.isPending || updateMut.isPending

  // Mark form as dirty when any field changes
  const markDirty = () => { if (!hasUnsaved) setHasUnsaved(true) }

  const reset = () => {
    setTitle(''); setSlug(''); setPageType('template'); setTemplateId('clothing'); setSections([])
    setCustomHtml(''); setCustomCss(''); setPrimaryColor('#3730a3'); setSelectedProducts([]); setTab('general'); setEditRow(null); setHasUnsaved(false)
  }

  const openEdit = (row: LandingPage) => {
    setEditRow(row)
    setTitle(row.title); setSlug(row.slug); setPageType(row.pageType)
    setTemplateId(row.templateId || 'clothing')
    setSections(row.sections || [])
    setCustomHtml(row.customHtml || '')
    setCustomCss(row.customCss || '')
    setPrimaryColor(row.trackingJson?.primaryColor || '#3730a3')
    // Resolve product names from IDs
    const pIds = Array.isArray(row.productIds) ? row.productIds : []
    if (pIds.length > 0) {
      apiClient.get('/products', { params: { ids: pIds.slice(0, 20).join(','), perPage: 20 } })
        .then(res => {
          const items = (res.data as any)?.data || []
          setSelectedProducts(pIds.map((id: string) => {
            const found = items.find((p: any) => p.id === id)
            return { id, name: found?.name || id.slice(0, 8) + '...' }
          }))
        })
        .catch(() => setSelectedProducts(pIds.map((id: string) => ({ id, name: id.slice(0, 8) + '...' }))))
    } else {
      setSelectedProducts([])
    }
    // Combos are not loaded: combo assignment was removed — combos are
    // stored on the row but rendered nowhere (audit §3.3), so the editor
    // neither shows nor sends them. Existing rows keep their stored value.
    setFormOpen(true)
    setTab('general')
  }

  const handleSave = () => {
    if (!title || !slug) { toast.error('Title and slug are required'); return }
    if (!/^[a-z0-9-]+$/.test(slug)) { toast.error('Slug must be lowercase alphanumeric with dashes only'); return }
    if (pageType === 'custom' && !customHtml.trim()) { toast.error('Custom HTML is empty. Paste your code or switch to Template mode.'); return }
    const payload = buildSavePayload({
      title, slug, pageType, templateId, sections, customHtml, customCss,
      productIds: selectedProducts.map(p => p.id),
      primaryColor,
      existingTrackingJson: editRow?.trackingJson,
    })
    if (editRow) {
      updateMut.mutate({ id: editRow.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  // Product search with debounce
  useEffect(() => {
    if (!productSearch || productSearch.length < 2) { setProductResults([]); setShowProductDropdown(false); return }
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      setSearching(true)
      apiClient.get('/products', { params: { search: productSearch, perPage: 50, isActive: true } })
        .then(res => {
          const items = (res.data as any)?.data || []
          setProductResults(items)
          setShowProductDropdown(items.length > 0)
        })
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 300)
    return () => { clearTimeout(searchRef.current) }
  }, [productSearch])

  const addProduct = (p: any) => {
    if (!selectedProducts.find(sp => sp.id === p.id)) {
      setSelectedProducts(prev => [...prev, { id: p.id, name: p.name }])
    }
    setProductSearch(''); setShowProductDropdown(false)
  }

  const removeProduct = (id: string) => {
    setSelectedProducts(prev => prev.filter(p => p.id !== id))
  }

  // Media picker: the value(s) for the field the picker is choosing for.
  const pickerSelected: string[] = (() => {
    if (!pickerTarget) return []
    const sec = sections[pickerTarget.sectionIndex]
    if (!sec) return []
    if (pickerTarget.kind === 'hero') return sec.image ? [sec.image] : []
    if (pickerTarget.kind === 'poster') return sec.poster ? [sec.poster] : []
    if (pickerTarget.kind === 'gallery') return Array.isArray(sec.images) ? sec.images.filter(Boolean) : []
    const item = sec.items?.[pickerTarget.itemIndex]
    return item?.image ? [item.image] : []
  })()

  const handlePickerSelect = (urls: string[]) => {
    if (!pickerTarget) return
    const { sectionIndex } = pickerTarget
    if (pickerTarget.kind === 'hero') {
      updateSection(sectionIndex, 'image', urls[0] || '')
    } else if (pickerTarget.kind === 'poster') {
      updateSection(sectionIndex, 'poster', urls[0] || '')
    } else if (pickerTarget.kind === 'gallery') {
      const current: string[] = Array.isArray(sections[sectionIndex]?.images) ? sections[sectionIndex].images : []
      updateSection(sectionIndex, 'images', Array.from(new Set([...current.filter(Boolean), ...urls])))
    } else {
      const items = [...(sections[sectionIndex]?.items || [])]
      items[pickerTarget.itemIndex] = { ...items[pickerTarget.itemIndex], image: urls[0] || '' }
      updateSection(sectionIndex, 'items', items)
    }
    markDirty()
    setPickerTarget(null)
  }

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
      if (sectionAddRef.current && !sectionAddRef.current.contains(e.target as Node)) {
        setShowSectionMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Template section builder
  const updateSection = (index: number, field: string, value: any) => {
    setSections(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const SECTION_TYPES: Record<string, { label: string; icon: string; default: any }> = {
    hero: { label: 'Hero Banner', icon: '🖼️', default: { type: 'hero', title: 'Premium Collection', subtitle: '', image: '', ctaText: 'Shop Now', badgeText: '', offerEndsAt: '', stockCount: 0 } },
    features: { label: 'Features Grid', icon: '✨', default: { type: 'features', title: 'Why Choose Us', items: [{ text: 'Feature 1', icon: '✓' }, { text: 'Feature 2', icon: '✓' }, { text: 'Feature 3', icon: '✓' }] } },
    'product-info': { label: 'Product Info', icon: '📋', default: { type: 'product-info', title: 'Product Details', items: [{ title: 'Feature', text: 'Description' }] } },
    'featured-grid': { label: 'Product Grid', icon: '🏷️', default: { type: 'featured-grid', title: 'Our Products', productIds: [] } },
    'checkout-form': { label: 'Checkout Form', icon: '📝', default: { type: 'checkout-form', title: 'Order Now', submitText: 'Place Order', productId: '' } },
    'trust-badges': { label: 'Trust Badges', icon: '✅', default: { type: 'trust-badges', title: 'Why Shop With Us', items: [{ icon: '🚚', label: 'Free Delivery' }, { icon: '💳', label: 'Cash on Delivery' }, { icon: '🔄', label: 'Easy Returns' }, { icon: '🔒', label: 'Secure Payment' }] } },
    'cta-footer': { label: 'CTA Footer', icon: '🎯', default: { type: 'cta-footer', title: 'Limited Time Offer', subtitle: 'Order now before stock runs out', ctaText: 'Order Now', badgeText: '', offerEndsAt: '', stockCount: 0 } },
    'image-gallery': { label: 'Image Gallery', icon: '🖼️', default: { type: 'image-gallery', title: 'Gallery', images: [''] } },
    'video-embed': { label: 'Video Embed', icon: '🎬', default: { type: 'video-embed', title: 'Watch', videoUrl: '', poster: '' } },
    testimonials: { label: 'Testimonials', icon: '💬', default: { type: 'testimonials', title: 'What Our Customers Say', items: [{ name: 'Customer', text: 'Great product!', rating: 5 }] } },
    'review-slider': { label: 'Review Slider', icon: '⭐', default: { type: 'review-slider', title: 'Reviews', items: [{ image: '', title: 'Review', text: 'Amazing!', rating: 5 }] } },
    faq: { label: 'FAQ', icon: '❓', default: { type: 'faq', title: 'FAQs', items: [{ question: 'Question?', answer: 'Answer here.' }] } },
  }

  const addSection = (type: string) => {
    const config = SECTION_TYPES[type]
    if (!config) return
    setSections(prev => [...prev, JSON.parse(JSON.stringify(config.default))])
    markDirty()
  }

  const removeSection = (index: number) => {
    setSections(prev => prev.filter((_, i) => i !== index))
    markDirty()
  }

  const moveSection = (index: number, direction: 'up' | 'down') => {
    setSections(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    markDirty()
  }

  const renderSectionFields = (sec: any, i: number) => {
    const fields: React.ReactElement[] = [
      <div className='space-y-1' key='title'>
        <Label className='text-xs'>Title</Label>
        <Input className='h-8 text-xs' value={sec.title || ''} onChange={e => updateSection(i, 'title', e.target.value)} placeholder='Section title' />
      </div>,
    ]

    if (sec.subtitle !== undefined) {
      fields.push(
        <div className='space-y-1' key='subtitle'>
          <Label className='text-xs'>Subtitle</Label>
          <Input className='h-8 text-xs' value={sec.subtitle || ''} onChange={e => updateSection(i, 'subtitle', e.target.value)} placeholder='Subtitle' />
        </div>,
      )
    }

    if (sec.ctaText !== undefined) {
      fields.push(
        <div className='space-y-1' key='ctaText'>
          <Label className='text-xs'>Button Text</Label>
          <Input className='h-8 text-xs' value={sec.ctaText || ''} onChange={e => updateSection(i, 'ctaText', e.target.value)} placeholder='Shop Now' />
        </div>,
      )
    }

    if (sec.badgeText !== undefined) {
      fields.push(
        <div className='space-y-1' key='badgeText'>
          <Label className='text-xs'>Badge Text</Label>
          <Input className='h-8 text-xs' value={sec.badgeText || ''} onChange={e => updateSection(i, 'badgeText', e.target.value)} placeholder='Limited Offer' />
        </div>,
      )
    }

    if (sec.offerEndsAt !== undefined) {
      fields.push(
        <div className='space-y-1' key='offerEndsAt'>
          <Label className='text-xs'>Offer End Date</Label>
          <Input className='h-8 text-xs' value={sec.offerEndsAt || ''} onChange={e => updateSection(i, 'offerEndsAt', e.target.value)} placeholder='2026-07-31' />
        </div>,
      )
    }

    if (sec.stockCount !== undefined) {
      fields.push(
        <div className='space-y-1' key='stockCount'>
          <Label className='text-xs'>Stock Count</Label>
          <Input className='h-8 text-xs' type='number' value={sec.stockCount ?? 0} onChange={e => updateSection(i, 'stockCount', parseInt(e.target.value) || 0)} placeholder='0' />
        </div>,
      )
    }

    if (sec.image !== undefined && !Array.isArray(sec.image)) {
      fields.push(
        <div className='space-y-1 col-span-2' key='image'>
          <Label className='text-xs'>Image URL</Label>
          <div className='flex items-center gap-2'>
            <Input className='h-8 text-xs flex-1' value={sec.image || ''} onChange={e => updateSection(i, 'image', e.target.value)} placeholder='https://...' />
            <Button variant='outline' size='sm' className='h-8 text-xs shrink-0' onClick={() => setPickerTarget({ kind: 'hero', sectionIndex: i })}>
              <ImagePlus className='h-3.5 w-3.5 mr-1' /> Browse
            </Button>
          </div>
        </div>,
      )
    }

    if (sec.images !== undefined && Array.isArray(sec.images)) {
      fields.push(
        <div className='space-y-2 col-span-2' key='images'>
          <Label className='text-xs'>Images</Label>
          {sec.images.map((img: string, imgI: number) => (
            <div key={imgI} className='flex items-center gap-2'>
              <Input className='h-8 text-xs flex-1' value={img} onChange={e => {
                const next = [...sec.images]
                next[imgI] = e.target.value
                updateSection(i, 'images', next)
              }} placeholder='https://...' />
              <button type='button' onClick={() => {
                const next = sec.images.filter((_: any, j: number) => j !== imgI)
                updateSection(i, 'images', next)
              }} className='text-xs p-1 rounded hover:bg-destructive/10 text-destructive shrink-0'>
                <X className='h-3.5 w-3.5' />
              </button>
            </div>
          ))}
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' className='text-xs' onClick={() => updateSection(i, 'images', [...sec.images, ''])}>
              <Plus className='h-3 w-3 mr-1' /> Add Image
            </Button>
            <Button variant='outline' size='sm' className='text-xs' onClick={() => setPickerTarget({ kind: 'gallery', sectionIndex: i })}>
              <ImagePlus className='h-3 w-3 mr-1' /> Browse library
            </Button>
          </div>
        </div>,
      )
    }

    if (sec.videoUrl !== undefined) {
      fields.push(
        <div className='space-y-1 col-span-2' key='videoUrl'>
          <Label className='text-xs'>Video URL</Label>
          <Input className='h-8 text-xs' value={sec.videoUrl || ''} onChange={e => updateSection(i, 'videoUrl', e.target.value)} placeholder='https://youtube.com/...' />
        </div>,
      )
    }

    if (sec.poster !== undefined) {
      fields.push(
        <div className='space-y-1 col-span-2' key='poster'>
          <Label className='text-xs'>Poster URL</Label>
          <div className='flex items-center gap-2'>
            <Input className='h-8 text-xs flex-1' value={sec.poster || ''} onChange={e => updateSection(i, 'poster', e.target.value)} placeholder='https://...' />
            <Button variant='outline' size='sm' className='h-8 text-xs shrink-0' onClick={() => setPickerTarget({ kind: 'poster', sectionIndex: i })}>
              <ImagePlus className='h-3.5 w-3.5 mr-1' /> Browse
            </Button>
          </div>
        </div>,
      )
    }

    if (sec.submitText !== undefined) {
      fields.push(
        <div className='space-y-1' key='submitText'>
          <Label className='text-xs'>Submit Button Text</Label>
          <Input className='h-8 text-xs' value={sec.submitText || ''} onChange={e => updateSection(i, 'submitText', e.target.value)} placeholder='Place Order' />
        </div>,
      )
    }

    if (sec.productId !== undefined) {
      fields.push(
        <div className='space-y-1' key='productId'>
          <Label className='text-xs'>Product</Label>
          <select className='w-full rounded-md border px-2 py-1.5 text-xs bg-background h-8' value={sec.productId || ''} onChange={e => updateSection(i, 'productId', e.target.value)}>
            <option value=''>None (use page-level products)</option>
            {selectedProducts.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {sec.productId && !selectedProducts.find(p => p.id === sec.productId) && (
              <option value={sec.productId} disabled>Unavailable product</option>
            )}
          </select>
        </div>,
      )
    }

    if (sec.productIds !== undefined && Array.isArray(sec.productIds)) {
      fields.push(
        <div className='space-y-1 col-span-2' key='productIds'>
          <Label className='text-xs'>Product IDs</Label>
          <div className='flex flex-wrap gap-1.5'>
            {sec.productIds.map((pid: string, pi: number) => {
              const p = selectedProducts.find(sp => sp.id === pid)
              return (
                <Badge key={pi} variant='secondary' className='gap-1 pr-1 text-xs'>
                  <span className='truncate max-w-[120px]'>{p?.name || pid.slice(0, 8) + '...'}</span>
                  <button type='button' onClick={() => updateSection(i, 'productIds', sec.productIds.filter((_: any, j: number) => j !== pi))} className='ml-0.5 hover:text-destructive'>
                    <X className='h-3 w-3' />
                  </button>
                </Badge>
              )
            })}
          </div>
          <div className='relative'>
            <input type='text' placeholder='Type product ID and press Enter...'
              className='w-full rounded-md border px-2 py-1.5 text-xs bg-background h-8'
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim()
                  if (val && !sec.productIds.includes(val)) {
                    updateSection(i, 'productIds', [...sec.productIds, val])
                  }
                  ;(e.target as HTMLInputElement).value = ''
                }
              }}
            />
          </div>
        </div>,
      )
    }

    if (sec.items !== undefined && Array.isArray(sec.items)) {
      const first = sec.items[0]
      const isIconText = first && 'icon' in first && 'text' in first && !('title' in first) && !('name' in first) && !('question' in first) && !('image' in first)
      const isTitleText = first && 'title' in first && 'text' in first && !('icon' in first)
      const isNameText = first && 'name' in first && 'text' in first && !('image' in first) && !('question' in first)
      const isImageTitleText = first && 'image' in first && 'title' in first && 'text' in first
      const isQuestionAnswer = first && 'question' in first && 'answer' in first

      fields.push(
        <div className='space-y-2 col-span-2' key='items'>
          <Label className='text-xs'>Items</Label>
          {sec.items.map((item: any, itemI: number) => (
            <div key={itemI} className='border rounded p-2 space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-xs text-muted-foreground'>Item #{itemI + 1}</span>
                <button type='button' onClick={() => {
                  const next = sec.items.filter((_: any, j: number) => j !== itemI)
                  updateSection(i, 'items', next)
                }} className='text-xs p-1 rounded hover:bg-destructive/10 text-destructive'>
                  <X className='h-3 w-3' />
                </button>
              </div>
              {isIconText && (
                <div className='grid grid-cols-2 gap-2'>
                  <Input className='h-8 text-xs' value={item.icon || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], icon: e.target.value }; updateSection(i, 'items', next) }} placeholder='Icon' />
                  <Input className='h-8 text-xs' value={item.text || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], text: e.target.value }; updateSection(i, 'items', next) }} placeholder='Feature text' />
                </div>
              )}
              {isTitleText && (
                <div className='grid grid-cols-2 gap-2'>
                  <Input className='h-8 text-xs' value={item.title || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], title: e.target.value }; updateSection(i, 'items', next) }} placeholder='Title' />
                  <Input className='h-8 text-xs' value={item.text || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], text: e.target.value }; updateSection(i, 'items', next) }} placeholder='Description' />
                </div>
              )}
              {isNameText && (
                <div className='grid grid-cols-3 gap-2'>
                  <Input className='h-8 text-xs' value={item.name || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], name: e.target.value }; updateSection(i, 'items', next) }} placeholder='Name' />
                  <Input className='h-8 text-xs' value={item.text || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], text: e.target.value }; updateSection(i, 'items', next) }} placeholder='Review' />
                  <Input className='h-8 text-xs' type='number' min={1} max={5} value={item.rating ?? 5} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], rating: parseInt(e.target.value) || 5 }; updateSection(i, 'items', next) }} placeholder='Rating' />
                </div>
              )}
              {isImageTitleText && (
                <div className='grid grid-cols-2 gap-2'>
                  <div className='flex items-center gap-2 col-span-2'>
                    <Input className='h-8 text-xs flex-1' value={item.image || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], image: e.target.value }; updateSection(i, 'items', next) }} placeholder='Image URL' />
                    <Button variant='outline' size='sm' className='h-8 text-xs shrink-0' onClick={() => setPickerTarget({ kind: 'review-image', sectionIndex: i, itemIndex: itemI })}>
                      <ImagePlus className='h-3.5 w-3.5 mr-1' /> Browse
                    </Button>
                  </div>
                  <Input className='h-8 text-xs' value={item.title || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], title: e.target.value }; updateSection(i, 'items', next) }} placeholder='Title' />
                  <Input className='h-8 text-xs' value={item.text || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], text: e.target.value }; updateSection(i, 'items', next) }} placeholder='Review' />
                  <Input className='h-8 text-xs' type='number' min={1} max={5} value={item.rating ?? 5} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], rating: parseInt(e.target.value) || 5 }; updateSection(i, 'items', next) }} placeholder='Rating' />
                </div>
              )}
              {isQuestionAnswer && (
                <div className='space-y-2'>
                  <Input className='h-8 text-xs' value={item.question || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], question: e.target.value }; updateSection(i, 'items', next) }} placeholder='Question' />
                  <Textarea className='text-xs' rows={2} value={item.answer || ''} onChange={e => { const next = [...sec.items]; next[itemI] = { ...next[itemI], answer: e.target.value }; updateSection(i, 'items', next) }} placeholder='Answer' />
                </div>
              )}
            </div>
          ))}
          <Button variant='outline' size='sm' className='text-xs' onClick={() => {
            let newItem: any
            if (isIconText) newItem = { icon: '✓', text: '' }
            else if (isTitleText) newItem = { title: '', text: '' }
            else if (isNameText) newItem = { name: '', text: '', rating: 5 }
            else if (isImageTitleText) newItem = { image: '', title: '', text: '', rating: 5 }
            else if (isQuestionAnswer) newItem = { question: '', answer: '' }
            else newItem = { text: '' }
            updateSection(i, 'items', [...sec.items, newItem])
          }}>
            <Plus className='h-3 w-3 mr-1' /> Add Item
          </Button>
        </div>,
      )
    }

    return fields
  }

  return (
    <>
      <Header fixed>
        <div className='ms-auto flex items-center gap-2'>
          <ThemeSwitch /><ProfileDropdown />
        </div>
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div className='flex items-center gap-1.5'>
            <h2 className='text-2xl font-bold tracking-tight'>Landing Pages</h2>
            </div>
          <Button onClick={() => { reset(); setFormOpen(true); }}>
            <Plus className='h-4 w-4 mr-1' /> Add Landing Page
          </Button>
        </div>

        {/* List table */}
        <div className='border rounded-lg overflow-hidden'>
          {isLoading ? (
            <div className='flex items-center justify-center py-16 text-muted-foreground'>
              <Loader2 className='h-5 w-5 animate-spin mr-2' /> Loading...
            </div>
          ) : pages.length === 0 ? (
            <div className='text-center py-16 text-muted-foreground'>
              <Layout className='h-10 w-10 mx-auto mb-3 opacity-40' />
              <p className='text-sm'>No landing pages yet</p>
              <Button variant='outline' size='sm' className='mt-3' onClick={() => { reset(); setFormOpen(true); }}>
                Create your first page
              </Button>
            </div>
          ) : (
            <table className='w-full text-sm'>
              <thead className='bg-muted/50 border-b'>
                <tr>
                  <th className='text-left px-4 py-3 font-medium'>Title</th>
                  <th className='text-left px-4 py-3 font-medium'>Slug</th>
                  <th className='text-left px-4 py-3 font-medium'>Type</th>
                  <th className='text-left px-4 py-3 font-medium'>Status</th>
                  <th className='text-left px-4 py-3 font-medium'>Updated</th>
                  <th className='text-right px-4 py-3 font-medium'>Actions</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {pages.map((p: LandingPage) => (
                  <tr key={p.id} className='hover:bg-muted/10 transition-colors'>
                    <td className='px-4 py-3 font-medium'>{p.title}</td>
                    <td className='px-4 py-3 text-muted-foreground'>/landing/{p.slug}</td>
                    <td className='px-4 py-3'>
                      <Badge variant='outline' className='text-xs'>{p.pageType}</Badge>
                    </td>
                    <td className='px-4 py-3'>
                      {(() => {
                        const status = getLandingPageStatus(p)
                        return status === 'Published' ? (
                          <Badge variant='default' className='bg-green-600 text-xs'>Published</Badge>
                        ) : status === 'Unpublished' ? (
                          <Badge variant='outline' className='text-xs text-amber-600 border-amber-600'>Unpublished</Badge>
                        ) : (
                          <Badge variant='secondary' className='text-xs'>Draft</Badge>
                        )
                      })()}
                    </td>
                    <td className='px-4 py-3 text-muted-foreground text-xs'>
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3 text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        {p.isActive && !p.isDraft && (
                          <Button variant='ghost' size='sm' className='h-8 w-8 p-0' title='View'
                            onClick={() => window.open(buildStorefrontPageUrl(p.slug), '_blank')}>
                            <ExternalLink className='h-4 w-4' />
                          </Button>
                        )}
                        <Button variant='ghost' size='sm' className='h-8 w-8 p-0' title='Edit' onClick={() => openEdit(p)}>
                          <Pencil className='h-4 w-4' />
                        </Button>
                        {p.isActive && !p.isDraft ? (
                          <Button variant='ghost' size='sm' className='h-8 w-8 p-0' title='Unpublish'
                            onClick={() => unpublishMut.mutate(p.id)}>
                            <GlobeOff className='h-4 w-4 text-amber-600' />
                          </Button>
                        ) : (
                          <Button variant='ghost' size='sm' className='h-8 w-8 p-0' title='Publish'
                            onClick={() => publishMut.mutate(p.id)}>
                            <Globe className='h-4 w-4 text-green-600' />
                          </Button>
                        )}
                        <Button variant='ghost' size='sm' className='h-8 w-8 p-0' title='Duplicate' onClick={() => cloneMut.mutate(p)}>
                          <Copy className='h-4 w-4' />
                        </Button>
                        <Button variant='ghost' size='sm' className='h-8 w-8 p-0 text-destructive' title='Delete'
                          onClick={() => setDeleteTarget(p)}>
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-4 py-3 border-t bg-muted/20'>
              <span className='text-xs text-muted-foreground'>Page {page} of {totalPages}</span>
              <div className='flex gap-1'>
                <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </Main>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={(v) => {
        if (!v && hasUnsaved) { setCloseConfirm(true); return }
        if (!v) { setFormOpen(false); reset(); }
      }}>
        <DialogContent className='!max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col p-0'>
          <DialogHeader className='px-6 pt-6 pb-0'>
            <DialogTitle>{editRow ? `Edit: ${editRow.title}` : 'New Landing Page'}</DialogTitle>
            <DialogDescription>Configure your sales page content and tracking.</DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab} className='flex-1 flex flex-col overflow-hidden'>
            <TabsList className='px-6 justify-start rounded-none border-b'>
              <TabsTrigger value='general'>General</TabsTrigger>
              <TabsTrigger value='content'>Content</TabsTrigger>
              <TabsTrigger value='products'>Products</TabsTrigger>
            </TabsList>

            <div className='flex-1 overflow-y-auto px-6 py-4'>
              {/* General Tab */}
              <TabsContent value='general' className='mt-0 space-y-4'>
                <div className='space-y-1.5'>
                  <Label>Page Title *</Label>
                  <Input value={title} onChange={e => { setTitle(e.target.value); markDirty(); if (!editRow) setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')) }} placeholder='Summer Sale 2026' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Slug *</Label>
                  <Input value={slug} onChange={e => { setSlug(e.target.value); markDirty(); }} placeholder='summer-sale-2026' />
                  <p className='text-xs text-muted-foreground'>URL: /landing/{slug || 'slug'}</p>
                </div>
                <div className='space-y-1.5'>
                  <Label>Page Type</Label>
                  <div className='flex gap-3'>
                    <button
                      onClick={() => setPageType('template')}
                      className={`flex-1 flex items-center gap-2 rounded-lg border-2 p-3 text-sm transition-colors ${
                        pageType === 'template' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
                      }`}
                    >
                      <Layout className='h-5 w-5' />
                      <div className='text-left'>
                        <p className='font-medium'>Template</p>
                        <p className='text-xs text-muted-foreground'>Pre-built sections, edit content</p>
                      </div>
                    </button>
                    <button
                      onClick={() => setPageType('custom')}
                      className={`flex-1 flex items-center gap-2 rounded-lg border-2 p-3 text-sm transition-colors ${
                        pageType === 'custom' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
                      }`}
                    >
                      <Code className='h-5 w-5' />
                      <div className='text-left'>
                        <p className='font-medium'>Custom Code</p>
                        <p className='text-xs text-muted-foreground'>Full HTML control</p>
                      </div>
                    </button>
                  </div>
                </div>

                {pageType === 'template' && (
                  <div className='space-y-1.5'>
                    <Label>Template</Label>
                    <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                      className='w-full rounded-md border px-3 py-2 text-sm bg-background'>
                      <option value='clothing'>Clothing Sales Page</option>
                    </select>
                  </div>
                )}
                <div className='space-y-1.5'>
                  <Label>Brand Primary Color</Label>
                  <div className='flex items-center gap-2'>
                    <input type='color' value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                      className='w-10 h-10 rounded cursor-pointer border' />
                    <span className='text-xs text-muted-foreground'>{primaryColor}</span>
                  </div>
                </div>
              </TabsContent>

              {/* Content Tab */}
              <TabsContent value='content' className='mt-0 space-y-4'>
                {pageType === 'template' ? (
                  <div className='space-y-4'>
                    <div className='flex items-center justify-between'>
                      <p className='text-sm font-medium'>Template Sections ({sections.length})</p>
                      <div className='relative' ref={sectionAddRef}>
                        <Button variant='outline' size='sm' onClick={() => setShowSectionMenu(!showSectionMenu)}>
                          <Plus className='h-4 w-4 mr-1' /> Add Section
                        </Button>
                        {showSectionMenu && (
                          <div className='absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg min-w-[200px] max-h-60 overflow-y-auto'>
                            {Object.entries(SECTION_TYPES).map(([type, config]) => (
                              <button
                                key={type}
                                type='button'
                                onClick={() => { addSection(type); setShowSectionMenu(false) }}
                                className='w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left transition-colors'
                              >
                                <span>{config.icon}</span>
                                <span>{config.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {sections.length === 0 ? (
                      <div className='text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg'>
                        <p className='text-sm'>No sections configured</p>
                        <p className='text-xs mt-1'>Add sections to build your landing page.</p>
                      </div>
                    ) : (
                      <div className='space-y-3'>
                        {sections.map((sec, i) => (
                          <div key={i} className='border rounded-lg p-4 space-y-3'>
                            <div className='flex items-center justify-between'>
                              <div className='flex items-center gap-2'>
                                <Badge variant='outline' className='text-xs uppercase'>{SECTION_TYPES[sec.type]?.label || sec.type}</Badge>
                                <span className='text-xs text-muted-foreground'>#{i + 1}</span>
                              </div>
                              <div className='flex items-center gap-1'>
                                <button type='button' onClick={() => moveSection(i, 'up')} disabled={i === 0} className='text-xs p-1 rounded hover:bg-muted/50 transition-colors disabled:opacity-30' title='Move up'>
                                  <ChevronUp className='h-3.5 w-3.5' />
                                </button>
                                <button type='button' onClick={() => moveSection(i, 'down')} disabled={i === sections.length - 1} className='text-xs p-1 rounded hover:bg-muted/50 transition-colors disabled:opacity-30' title='Move down'>
                                  <ChevronDown className='h-3.5 w-3.5' />
                                </button>
                                <button type='button' onClick={() => updateSection(i, 'hidden', !sec.hidden)} className={`text-xs p-1 rounded transition-colors ${sec.hidden ? 'text-muted-foreground' : 'text-foreground'}`} title={sec.hidden ? 'Show section' : 'Hide section'}>
                                  {sec.hidden ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
                                </button>
                                <button type='button' onClick={() => removeSection(i)} className='text-xs p-1 rounded hover:bg-destructive/10 text-destructive transition-colors' title='Remove section'>
                                  <Trash2 className='h-3.5 w-3.5' />
                                </button>
                              </div>
                            </div>
                            {sec.hidden && (
                              <div className='bg-muted/30 rounded px-3 py-2'>
                                <p className='text-xs text-muted-foreground'>This section is hidden and will not appear on the published page.</p>
                              </div>
                            )}
                            <div className='grid grid-cols-2 gap-3'>
                              {renderSectionFields(sec, i)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className='space-y-4'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <p className='text-sm font-medium'>Custom HTML</p>
                        <p className='text-xs text-muted-foreground'>HTML fragment only — no JavaScript. Checkout and tracking are provided by the platform.</p>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button variant='outline' size='sm' onClick={() => {
                          navigator.clipboard.writeText(buildAiInstructions())
                          toast.success('AI instructions copied to clipboard')
                        }}>
                          <Copy className='h-4 w-4 mr-1' /> Copy AI instructions
                        </Button>
                        <PromptReferenceModal />
                      </div>
                    </div>
                    <Textarea
                      value={customHtml}
                      onChange={e => setCustomHtml(e.target.value)}
                      rows={24}
                      placeholder='<div id="ecomate-checkout-mount"></div>'
                      className='font-mono text-xs leading-relaxed'
                    />
                    <div className='space-y-1.5'>
                      <Label>Custom CSS</Label>
                      <p className='text-xs text-muted-foreground'>Plain CSS only — no Tailwind classes, no @import. Scoped to your page automatically.</p>
                      <Textarea
                        value={customCss}
                        onChange={e => { setCustomCss(e.target.value); markDirty(); }}
                        rows={10}
                        placeholder={'.hero {\n  padding: 2rem;\n}'}
                        className='font-mono text-xs leading-relaxed'
                      />
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Products Tab */}
              <TabsContent value='products' className='mt-0 space-y-6'>
                <div className='space-y-1.5'>
                  <Label>Assigned Products</Label>
                  <div className='relative' ref={productSearchRef}>
                    <div className='flex items-center border rounded-md px-3 py-2 bg-background'>
                      <Search className='h-4 w-4 text-muted-foreground mr-2 shrink-0' />
                      <input
                        type='text'
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        placeholder='Search products by name...'
                        className='flex-1 text-sm bg-transparent outline-none border-0 p-0'
                      />
                      {searching && <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />}
                    </div>
                    {showProductDropdown && (
                      <div className='absolute z-50 top-full mt-1 left-0 right-0 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto'>
                        {productResults.map((p: any) => (
                          <button
                            key={p.id}
                            type='button'
                            onClick={() => addProduct(p)}
                            className='w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50 text-left transition-colors'
                          >
                            {p.images?.[0] ? (
                              <img src={p.images[0]} alt='' className='w-8 h-8 rounded object-cover bg-muted' />
                            ) : (
                              <div className='w-8 h-8 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground'>?</div>
                            )}
                            <div className='min-w-0 flex-1'>
                              <p className='font-medium truncate'>{p.name}</p>
                              <p className='text-xs text-muted-foreground'>৳{Number(p.basePrice || 0).toLocaleString()}</p>
                            </div>
                            <Plus className='h-4 w-4 shrink-0 text-muted-foreground' />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedProducts.length > 0 && (
                    <div className='flex flex-wrap items-center gap-1.5 mt-2'>
                      {selectedProducts.map(p => (
                        <Badge key={p.id} variant='secondary' className='gap-1 pr-1 text-xs max-w-[200px]'>
                          <span className='truncate'>{p.name}</span>
                          <button onClick={() => removeProduct(p.id)} className='ml-0.5 hover:text-destructive shrink-0'>
                            <X className='h-3 w-3' />
                          </button>
                        </Badge>
                      ))}
                      {selectedProducts.length > 1 && (
                        <button onClick={() => setSelectedProducts([])} className='text-[11px] text-muted-foreground hover:text-destructive ml-1'>
                          Clear all
                        </button>
                      )}
                    </div>
                  )}
                  {selectedProducts.length === 0 && (
                    <p className='text-xs text-muted-foreground'>Search and select products above.</p>
                  )}
                </div>

                <p className='text-xs text-muted-foreground border-t pt-4'>
                  Assigned products are rendered by the platform. Combos are not shown here:
                  combo assignment renders nothing on the published page, so it was removed.
                  Pages that already have combos stored keep them, unchanged.
                </p>
              </TabsContent>
            </div>
          </Tabs>

          <div className='border-t px-6 py-3 flex justify-between items-center'>
            {editRow && (
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => window.open(buildPreviewUrl(editRow.slug), '_blank')}>
                  <ExternalLink className='h-4 w-4 mr-1' /> Preview
                </Button>
                {editRow.isActive && !editRow.isDraft ? (
                  <Button variant='outline' size='sm' onClick={() => unpublishMut.mutate(editRow.id)}>
                    <GlobeOff className='h-4 w-4 mr-1' /> Unpublish
                  </Button>
                ) : (
                  <Button variant='outline' size='sm' className='text-green-600 border-green-600' onClick={() => publishMut.mutate(editRow.id)}>
                    <Globe className='h-4 w-4 mr-1' /> Publish
                  </Button>
                )}
              </div>
            )}
            <div className='flex gap-2 ms-auto'>
              <Button variant='outline' onClick={() => { setFormOpen(false); reset(); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={!title || !slug || isPending}>
                {isPending ? <Loader2 className='h-4 w-4 animate-spin mr-1' /> : null}
                {editRow ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Media Library picker for section image fields (hero, gallery, review photos,
          video poster). The poster is only rendered by the storefront for native
          <video> sections; YouTube embeds ignore it (iframes have no poster). */}
      <MediaPicker
        open={pickerTarget !== null}
        onOpenChange={(v) => { if (!v) setPickerTarget(null) }}
        selected={pickerSelected}
        multiple={pickerTarget?.kind === 'gallery'}
        accept='image'
        onSelect={handlePickerSelect}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title='Delete Landing Page'
        desc={`Are you sure you want to delete "${deleteTarget?.title}"?`}
        confirmText='Delete'
        destructive
        isLoading={deleteMut.isPending}
        handleConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />

      <ConfirmDialog
        open={closeConfirm}
        onOpenChange={() => setCloseConfirm(false)}
        title='Unsaved Changes'
        desc='You have unsaved changes. Are you sure you want to close?'
        confirmText='Discard'
        destructive
        handleConfirm={() => { setCloseConfirm(false); setFormOpen(false); reset(); }}
      />
    </>
  )
}

export function PromptReferenceModal() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Code className='h-4 w-4 mr-1' /> Prompt Reference
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>Custom Code — Full Integration Guide</DialogTitle>
            <DialogDescription>
              Custom code is HTML + plain CSS only — no JavaScript of any kind. Tracking and
              checkout are provided by the platform. Give this to any AI to generate a safe page.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 text-sm'>
            {AI_INSTRUCTION_SECTIONS.map((sec, i) => (
              <div key={i} className='bg-muted/20 rounded-lg p-4 space-y-1'>
                <h4 className='font-semibold text-xs uppercase tracking-wider text-muted-foreground'>{sec.title}</h4>
                <p className='text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap'>{sec.content}</p>
              </div>
            ))}

            <div className='border-t pt-4'>
              <h4 className='font-semibold text-sm mb-2'>Copy the instructions for any AI</h4>
              <p className='text-xs text-muted-foreground leading-relaxed mb-3'>
                This copies the same contract shown above, plus a slot for your requirements.
                Paste it into any AI, fill in your requirements, and paste the two blocks it
                returns into the Custom HTML and Custom CSS fields.
              </p>
              <Button variant='default' size='sm' onClick={() => {
                navigator.clipboard.writeText(buildAiInstructions())
                toast.success('AI instructions copied to clipboard')
              }}>
                <Copy className='h-4 w-4 mr-1' /> Copy AI instructions
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
