import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Globe, GlobeOff, Trash2, Pencil, ExternalLink, Code, Layout, Loader2, Search, X, Copy, Eye, EyeOff } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
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
import { apiClient } from '@/lib/api-client'

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
  const [selectedProducts, setSelectedProducts] = useState<{ id: string; name: string }[]>([])
  const [selectedCombos, setSelectedCombos] = useState<{ id: string; name: string }[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [comboSearch, setComboSearch] = useState('')
  const [comboResults, setComboResults] = useState<any[]>([])
  const [combosSearching, setCombosSearching] = useState(false)
  const [showComboDropdown, setShowComboDropdown] = useState(false)
  const [primaryColor, setPrimaryColor] = useState('#3730a3')
  const searchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const comboSearchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const productSearchRef = useRef<HTMLDivElement>(null)
  const comboSearchRefDiv = useRef<HTMLDivElement>(null)

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
      productIds: Array.isArray(row.productIds) ? row.productIds : [],
      comboIds: Array.isArray(row.comboIds) ? row.comboIds : [],
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Duplicated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const isPending = createMut.isPending || updateMut.isPending

  // Mark form as dirty when any field changes
  const markDirty = () => { if (!hasUnsaved) setHasUnsaved(true) }

  const reset = () => {
    setTitle(''); setSlug(''); setPageType('template'); setTemplateId('clothing'); setSections([])
    setCustomHtml(''); setSelectedProducts([]); setSelectedCombos([]); setTab('general'); setEditRow(null); setHasUnsaved(false)
  }

  const openEdit = (row: LandingPage) => {
    setEditRow(row)
    setTitle(row.title); setSlug(row.slug); setPageType(row.pageType)
    setTemplateId(row.templateId || 'clothing')
    setSections(row.sections || [])
    setCustomHtml(row.customHtml || '')
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
    const cIds = Array.isArray(row.comboIds) ? row.comboIds : []
    setSelectedCombos(cIds.map((id: string) => ({ id, name: id.slice(0, 8) + '...' })))
    setFormOpen(true)
    setTab('general')
  }

  const handleSave = () => {
    if (!title || !slug) { toast.error('Title and slug are required'); return }
    if (!/^[a-z0-9-]+$/.test(slug)) { toast.error('Slug must be lowercase alphanumeric with dashes only'); return }
    if (pageType === 'custom' && !customHtml.trim()) { toast.error('Custom HTML is empty. Paste your code or switch to Template mode.'); return }
    const payload = {
      title, slug, pageType, templateId: pageType === 'template' ? templateId : undefined,
      sections: pageType === 'template' ? sections : undefined,
      customHtml: pageType === 'custom' ? customHtml : undefined,
      productIds: selectedProducts.map(p => p.id),
      comboIds: selectedCombos.map(c => c.id),
      trackingJson: { primaryColor },
    }
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
      apiClient.get('/products', { params: { search: productSearch, perPage: 8, isActive: true } })
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

  // Combo search with debounce
  useEffect(() => {
    if (!comboSearch || comboSearch.length < 2) { setComboResults([]); setShowComboDropdown(false); return }
    clearTimeout(comboSearchRef.current)
    comboSearchRef.current = setTimeout(() => {
      setCombosSearching(true)
      apiClient.get('/combos', { params: { search: comboSearch, perPage: 8, isActive: true } })
        .then(res => {
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.data || []
          setComboResults(items)
          setShowComboDropdown(items.length > 0)
        })
        .catch(() => {})
        .finally(() => setCombosSearching(false))
    }, 300)
    return () => { clearTimeout(comboSearchRef.current) }
  }, [comboSearch])

  const addCombo = (c: any) => {
    if (!selectedCombos.find(sc => sc.id === c.id)) {
      setSelectedCombos(prev => [...prev, { id: c.id, name: c.name }])
    }
    setComboSearch(''); setShowComboDropdown(false)
  }

  const removeCombo = (id: string) => {
    setSelectedCombos(prev => prev.filter(c => c.id !== id))
  }

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
      if (comboSearchRefDiv.current && !comboSearchRefDiv.current.contains(e.target as Node)) {
        setShowComboDropdown(false)
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

  const defaultSections = [
    { type: 'hero', title: '', subtitle: '', image: '', ctaText: 'Shop Now', productId: '' },
    { type: 'features', title: 'Features', items: [{ text: '' }, { text: '' }, { text: '' }] },
    { type: 'featured-grid', title: 'Products', productIds: [] },
    { type: 'checkout-form', title: 'Order Now', submitText: 'Place Order', productId: '' },
    { type: 'trust-badges', title: 'Why Choose Us' },
    { type: 'cta-footer', title: 'Limited Offer', subtitle: 'Order now before stock runs out', ctaText: 'Order Now' },
  ]

  return (
    <>
      <Header fixed>
        <div className='ms-auto flex items-center gap-2'>
          <ThemeSwitch /><ProfileDropdown />
        </div>
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Landing Pages</h2>
            <p className='text-muted-foreground'>Create sales pages and campaign landing pages.</p>
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
                      {p.isActive && !p.isDraft ? (
                        <Badge variant='default' className='bg-green-600 text-xs'>Published</Badge>
                      ) : (
                        <Badge variant='secondary' className='text-xs'>Draft</Badge>
                      )}
                    </td>
                    <td className='px-4 py-3 text-muted-foreground text-xs'>
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3 text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        {p.isActive && !p.isDraft && (
                          <Button variant='ghost' size='sm' className='h-8 w-8 p-0' title='View'
                            onClick={() => window.open(`/landing/${p.slug}`, '_blank')}>
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
                      <p className='text-sm font-medium'>Template Sections</p>
                      <Button variant='outline' size='sm' onClick={() => setSections(JSON.parse(JSON.stringify(defaultSections)))} disabled={sections.length > 0}>
                        Load Default Sections
                      </Button>
                    </div>
                    {sections.length === 0 ? (
                      <div className='text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg'>
                        <p className='text-sm'>No sections configured</p>
                        <Button variant='outline' size='sm' className='mt-3' onClick={() => setSections(JSON.parse(JSON.stringify(defaultSections)))}>
                          Load Default Sections
                        </Button>
                      </div>
                    ) : (
                      <div className='space-y-3'>
                        {sections.map((sec, i) => (
                          <div key={i} className='border rounded-lg p-4 space-y-3'>
                            <div className='flex items-center justify-between'>
                              <Badge variant='outline' className='text-xs uppercase'>{sec.type}</Badge>
                              <div className='flex items-center gap-2'>
                                <button
                                  onClick={() => updateSection(i, 'hidden', !sec.hidden)}
                                  className={`text-xs p-1 rounded transition-colors ${sec.hidden ? 'text-muted-foreground' : 'text-foreground'}`}
                                  title={sec.hidden ? 'Show section' : 'Hide section'}
                                >
                                  {sec.hidden ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
                                </button>
                                <span className='text-xs text-muted-foreground'>Section {i + 1}</span>
                              </div>
                            </div>
                            <div className='grid grid-cols-2 gap-3'>
                              <div className='space-y-1'>
                                <Label className='text-xs'>Title</Label>
                                <Input className='h-8 text-xs' value={sec.title || ''} onChange={e => updateSection(i, 'title', e.target.value)} placeholder='Section title' />
                              </div>
                              {sec.subtitle !== undefined && (
                                <div className='space-y-1'>
                                  <Label className='text-xs'>Subtitle</Label>
                                  <Input className='h-8 text-xs' value={sec.subtitle || ''} onChange={e => updateSection(i, 'subtitle', e.target.value)} placeholder='Subtitle' />
                                </div>
                              )}
                              {sec.ctaText !== undefined && (
                                <div className='space-y-1'>
                                  <Label className='text-xs'>Button Text</Label>
                                  <Input className='h-8 text-xs' value={sec.ctaText || ''} onChange={e => updateSection(i, 'ctaText', e.target.value)} placeholder='Shop Now' />
                                </div>
                              )}
                              {sec.productId !== undefined && (
                                <div className='space-y-1'>
                                  <Label className='text-xs'>Product</Label>
                                  <select
                                    className='w-full rounded-md border px-2 py-1.5 text-xs bg-background h-8'
                                    value={sec.productId || ''}
                                    onChange={e => updateSection(i, 'productId', e.target.value)}
                                  >
                                    <option value=''>None (use page-level products)</option>
                                    {selectedProducts.map(p => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                    {sec.productId && !selectedProducts.find(p => p.id === sec.productId) && (
                                      <option value={sec.productId} disabled>{sec.productId.slice(0, 12)}...</option>
                                    )}
                                  </select>
                                </div>
                              )}
                              {sec.image !== undefined && (
                                <div className='space-y-1 col-span-2'>
                                  <Label className='text-xs'>Image URL</Label>
                                  <Input className='h-8 text-xs' value={sec.image || ''} onChange={e => updateSection(i, 'image', e.target.value)} placeholder='https://...' />
                                </div>
                              )}
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
                        <p className='text-xs text-muted-foreground'>Paste your AI-generated HTML code here. Use <code className='bg-muted px-1 rounded'>window.EcoMate.track()</code> for events.</p>
                      </div>
                      <PromptReferenceModal />
                    </div>
                    <Textarea
                      value={customHtml}
                      onChange={e => setCustomHtml(e.target.value)}
                      rows={24}
                      placeholder='<html>...</html>'
                      className='font-mono text-xs leading-relaxed'
                    />
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

                <div className='border-t pt-4 space-y-1.5'>
                  <Label>Assigned Combos</Label>
                  <div className='relative' ref={comboSearchRefDiv}>
                    <div className='flex items-center border rounded-md px-3 py-2 bg-background'>
                      <Search className='h-4 w-4 text-muted-foreground mr-2 shrink-0' />
                      <input
                        type='text'
                        value={comboSearch}
                        onChange={e => setComboSearch(e.target.value)}
                        placeholder='Search combos by name...'
                        className='flex-1 text-sm bg-transparent outline-none border-0 p-0'
                      />
                      {combosSearching && <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />}
                    </div>
                    {showComboDropdown && (
                      <div className='absolute z-50 top-full mt-1 left-0 right-0 bg-background border rounded-md shadow-lg max-h-60 overflow-y-auto'>
                        {comboResults.map((c: any) => (
                          <button
                            key={c.id}
                            type='button'
                            onClick={() => addCombo(c)}
                            className='w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50 text-left transition-colors'
                          >
                            <div className='min-w-0 flex-1'>
                              <p className='font-medium truncate'>{c.name}</p>
                              <p className='text-xs text-muted-foreground'>৳{Number(c.basePrice || 0).toLocaleString()}</p>
                            </div>
                            <Plus className='h-4 w-4 shrink-0 text-muted-foreground' />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedCombos.length > 0 && (
                    <div className='flex flex-wrap items-center gap-1.5 mt-2'>
                      {selectedCombos.map(c => (
                        <Badge key={c.id} variant='secondary' className='gap-1 pr-1 text-xs max-w-[200px]'>
                          <span className='truncate'>{c.name}</span>
                          <button onClick={() => removeCombo(c.id)} className='ml-0.5 hover:text-destructive shrink-0'>
                            <X className='h-3 w-3' />
                          </button>
                        </Badge>
                      ))}
                      {selectedCombos.length > 1 && (
                        <button onClick={() => setSelectedCombos([])} className='text-[11px] text-muted-foreground hover:text-destructive ml-1'>
                          Clear all
                        </button>
                      )}
                    </div>
                  )}
                  {selectedCombos.length === 0 && (
                    <p className='text-xs text-muted-foreground'>Search and select combos above.</p>
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <div className='border-t px-6 py-3 flex justify-between items-center'>
            {editRow && (
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => window.open(`/landing/${editRow.slug}?preview=true`, '_blank')}>
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

function PromptReferenceModal() {
  const [open, setOpen] = useState(false)
  const promptSections = [
    {
      title: "Architecture & Limits",
      content: "Landing page at /landing/[slug] — NO main app JS. Available: Tailwind CSS CDN, Google Fonts. CSP: inline scripts allowed, images from any URL, YouTube iframes allowed. BLOCKED: external JS files, other iframes, object/embed. Your output is a single self-contained HTML file."
    },
    {
      title: "Product Data Model",
      content: "Products are assigned via UUID. Build your UI around this JS object:\n\nwindow.products = [\n  {\n    id: 'uuid-here',\n    name: 'Premium Cotton Shirt',\n    price: 990,\n    compareAtPrice: 1290,\n    image: 'https://cdn.example.com/shirt.jpg',\n    variants: [\n      { id: 'v1', label: 'S', price: 990, stock: 10 },\n      { id: 'v2', label: 'M', price: 990, stock: 25 }\n    ]\n  }\n]\n\nRead from window.products (injected by the platform). If single product, window.products has 1 item. If multiple, iterate."
    },
    {
      title: "Order API — Request & Response",
      content: "POST /api/orders (rate limit: 5/min/IP)\n\nRequest:\n{\n  items: [{ productId: 'uuid', variantId: 'uuid?', quantity: 1, price: 990 }],\n  guestName: 'Customer Name',\n  guestPhone: '01712345678',\n  shippingAddress: { fullAddress: 'House 12, Dhaka', deliveryZone: 'Inside Dhaka' },\n  paymentOptionType: 'CASH_ON_DELIVERY', // or FULL_PAYMENT, PARTIAL_PAYMENT\n  gatewayCode: 'cod' // or bkash, nagad, rocket\n}\n\nSuccess (200):\n{ id: 'order-uuid', displayId: 'ORD-240623-0001' }\n\nError (400/409):\n{ message: 'Error description', statusCode: 400 }"
    },
    {
      title: "Tracking — Events & Exact Payloads",
      content: "Timeline scope: these limits apply per single page visit (not lifetime).\n\nPageView — fires automatically on page load. DO NOT call manually.\n\nViewContent — fires ONCE per section, the first time it becomes visible.\nUse IntersectionObserver: new IntersectionObserver(entries => { if (entry.isIntersecting && !fired) { EcoMate.track('ViewContent', { productId: p.id }); fired = true; } })\nPayload: { productId: string, section?: string }\n\nAddToCart — fires ONCE per add action (click variant pill, tap +). NOT on quantity change.\nPayload: { productId: string, variantId?: string, quantity: number, price: number }\n\nLead — fires ONCE after successful form field validation AND before the POST request.\nPayload: { phone: string }\n\nInitiateCheckout — fires ONCE after POST /api/orders returns 200.\nPayload: { orderId: string }\n\nPurchase — fired server-side. Do NOT fire from frontend.\n\nCRITICAL: Implement a local dedup flag per event:\nvar tracked = {};\nfunction trackOnce(event, data) { if (tracked[event]) return; tracked[event] = true; EcoMate.track(event, data); }\n\nExample: user clicks CTA → fires ViewContent. User scrolls to product → IntersectionObserver fires ViewContent again but BLOCKED by dedup flag. User submits order → fires Lead (only once even if validate fires multiple times). API success → fires InitiateCheckout. Total: 3 fire calls, 3 distinct events."
    },
    {
      title: "UI Requirements — States & Error Handling",
      content: "CRITICAL: Every interactive element needs 4 states:\n1. IDLE — default appearance\n2. LOADING — disable button, show spinner/text change (e.g., 'Placing Order...'), prevent double-click\n3. SUCCESS — show order confirmation with displayId from API response\n4. ERROR — show inline error message (red box, not alert()), keep form data intact\n\nPhone validation: require 11 digits starting with 01. Show inline <p class='text-red-500 text-xs'> error below the input, not an alert().\nPrevent double submission: disable submit button immediately on click, re-enable on error."
    },
    {
      title: "Clothing-Specific UI (Size, Color, Quantity)",
      content: "Include for each product:\n- Color selector: row of colored circles/swatches, click to select (not dropdown)\n- Size selector: row of pill buttons (S/M/L/XL), click to select (not dropdown)\n- Quantity stepper: − 1 + row, min 1, max stock\n- Show stock for selected variant: 'Only X left' if stock <= 5\n- If variant has different price, update displayed price on selection\n- Default: select first available variant, quantity = 1"
    },
    {
      title: "Bangladesh-Specific Checkout UX",
      content: "- Default payment method: Cash on Delivery (COD), shown as first/selected option\n- Delivery zone selector: radio buttons or pill toggle, NOT dropdown\n  'ঢাকার ভিতরে (+৬০টাকা)' / 'ঢাকার বাইরে (+১২০টাকা)'\n- Delivery charge auto-updates total when zone changes\n- Order summary box (above the form):\n    Product price: ৳990\n    Delivery: +৳60\n    —————————\n    Total: ৳1,050\n- Phone field placeholder: '01XXXXXXXXX'\n- Submit button: full-width, indigo/blue color, 'অর্ডার কনফার্ম করুন' in Bengali"
    },
    {
      title: "Incomplete Order (Abandoned Checkout)",
      content: "Track users who start filling but don't submit:\n- Add onblur handler to phone input: window.EcoMate.track('Lead', { phone: input.value })\n- This fires EVEN if user never clicks submit.\n- If using <div id='ecomate-checkout-mount'>, this is handled automatically."
    },
    {
      title: "Output Structure",
      content: "<!DOCTYPE html>\n<html>\n<head>\n  <meta charset='UTF-8'>\n  <meta name='viewport' content='width=device-width, initial-scale=1.0'>\n  <script src='https://cdn.tailwindcss.com'></script>\n  <link href='https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali' rel='stylesheet'>\n  <style>/* your custom CSS */</style>\n</head>\n<body class='font-[Noto_Sans_Bengali]'>\n  <!-- Hero, features, product grid, etc -->\n  <div id='ecomate-checkout-mount'></div>\n  <!-- Trust badges, footer -->\n  <script>\n    // Product data available via window.products\n    // Track user interactions\n    // Order form submission\n  </script>\n</body>\n</html>"
    },
  ];

  const examplePrompt = `Create a modern sales landing page for a clothing brand in Bangladesh.
Target audience: young adults in Dhaka, mobile-first, Bengali language.

REQUIRED SECTIONS:
1. Hero — gradient background, headline, CTA button (scrolls to #checkout)
2. Feature badges — COD, Free Delivery, Easy Returns, Authentic — using emoji icons
3. Product showcase — render window.products with image, name, price, compareAtPrice.
   Include Color selector (swatches), Size selector (S/M/L/XL pills), Quantity stepper (− 1 +).
   Show stock availability. Update displayed price when variant changes.
4. Checkout — use <div id="ecomate-checkout-mount"></div> for built-in order form
5. Trust badges section
6. Footer with contact info

CHECKOUT UI:
- Cash on Delivery selected by default
- Delivery zone toggle: Inside Dhaka (+60) / Outside Dhaka (+120)
- Order summary showing: product price + delivery charge = total
- Phone validation: 01XXXXXXXXX (11 digits), inline red error text
- Submit button: "অর্ডার কনফার্ম করুন", shows "প্লেসিং অর্ডার..." while submitting
- On success: show order confirmation with displayId
- On error: show error message, keep form data

TRACKING (implement ALL with dedup flag):
- PageView: auto, do not call manually
- ViewContent: IntersectionObserver per product section
- AddToCart: on variant select or + click (NOT quantity change)
- Lead: on form submit (after validation, before POST)
- InitiateCheckout: after API returns 200
- Each event fires EXACTLY ONCE per page visit — use var tracked = {} to dedup

TECHNICAL:
- Tailwind CSS CDN, Noto Sans Bengali font
- Single HTML file, mobile-first responsive
- POST /api/orders with correct JSON payload
- Loading state on submit button, prevent double-click
- Show success message with displayId on 200
- Show inline red error box on 400/500
- Use IntersectionObserver for scroll-based events
- No placeholder logic — all tracking calls fully implemented`

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Code className='h-4 w-4 mr-1' /> Prompt Reference
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>Custom Code — Full Integration Guide</DialogTitle>
            <DialogDescription>Give this to any AI to generate a fully integrated landing page.</DialogDescription>
          </DialogHeader>
          <div className='space-y-4 text-sm'>
            {promptSections.map((sec, i) => (
              <div key={i} className='bg-muted/20 rounded-lg p-4 space-y-1'>
                <h4 className='font-semibold text-xs uppercase tracking-wider text-muted-foreground'>{sec.title}</h4>
                <p className='text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap'>{sec.content}</p>
              </div>
            ))}

            <div className='border-t pt-4'>
              <h4 className='font-semibold text-sm mb-2'>Complete Example Prompt</h4>
              <div className='bg-muted rounded-lg p-3 mb-3'>
                <p className='text-xs text-muted-foreground leading-relaxed border-l-2 border-primary pl-3 italic whitespace-pre-wrap'>{examplePrompt}</p>
              </div>
              <Button variant='default' size='sm' onClick={() => {
                navigator.clipboard.writeText(examplePrompt)
                toast.success('Full prompt copied to clipboard')
              }}>
                <Code className='h-4 w-4 mr-1' /> Copy Full Prompt
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
