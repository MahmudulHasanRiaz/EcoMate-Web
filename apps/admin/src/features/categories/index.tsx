import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, ChevronRight, ChevronDown, Image as ImageIcon, X, Search, Copy, Check } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { categoriesApi, type CategoryResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { MediaPicker } from '@/components/media-picker'
import { mediaUrl, getStorefrontUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'
import { SearchableSelect } from '@/components/ui/searchable-select'

export function Categories() {
  const queryClient = useQueryClient()
  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list().then(r => Array.isArray(r.data) ? r.data : r.data?.data || []),
  })

  const { data: sizeCharts } = useQuery({ queryKey: ['size-charts'], queryFn: () => apiClient.get('/size-charts').then(r => r.data) })

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<CategoryResponse | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', parentId: '', image: '', sizeChartId: '' })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyCategoryLink = (slug: string, id: string) => {
    navigator.clipboard.writeText(`${getStorefrontUrl()}/category/${slug}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const createMut = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categories'] }); setShowCreate(false); setForm({ name: '', slug: '', parentId: '', image: '', sizeChartId: '' }); toast.success('Created') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => categoriesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categories'] }); setEditing(null); toast.success('Updated') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: categoriesApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categories'] }); toast.success('Deleted') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Delete failed'),
  })

  const openEdit = (cat: CategoryResponse) => {
    setEditing(cat)
    setForm({ name: cat.name, slug: cat.slug, parentId: cat.parentId || '', image: cat.image || '', sizeChartId: (cat as any).sizeChartId || '' })
  }

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const getCategoryPath = (cat: CategoryResponse): string => {
    const parts: string[] = [cat.name]
    let current = cat
    while (current.parentId) {
      const parent = (categories as CategoryResponse[]).find(c => c.id === current.parentId)
      if (!parent) break
      parts.unshift(parent.name)
      current = parent
    }
    return parts.join(' > ')
  }

  const sortedCats = useMemo(() => {
    return [...(Array.isArray(categories) ? categories : [])].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [categories])

  const rootCategories = useMemo(() => {
    const categoryMap = new Map<string, any>(
      sortedCats.map(c => [c.id, { ...c, children: [] }])
    )
    const roots: any[] = []

    for (const cat of categoryMap.values()) {
      if (cat.parentId) {
        const parent = categoryMap.get(cat.parentId)
        if (parent) {
          parent.children.push(cat)
        } else {
          roots.push(cat)
        }
      } else {
        roots.push(cat)
      }
    }
    return roots
  }, [sortedCats])

  const matchingCats = useMemo(() => {
    if (!searchTerm.trim()) return []
    const q = searchTerm.toLowerCase().trim()
    return (categories as CategoryResponse[] || []).filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q)
    )
  }, [categories, searchTerm])

  const parentOptions = useMemo(() => {
    return [
      ...(Array.isArray(categories) ? categories : []).map((c: CategoryResponse) => ({
        id: c.id,
        label: getCategoryPath(c),
      })),
    ].filter(opt => !editing || opt.id !== editing.id)
  }, [categories, editing])

  const sizeChartOptions = useMemo(() => {
    return [
      ...(Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as any)?.data || []).map((sc: any) => ({
        id: sc.id,
        label: sc.name,
      })),
    ]
  }, [sizeCharts])

  const renderCategory = (cat: any, depth = 0) => {
    const hasChildren = cat.children && cat.children.length > 0
    const isExpanded = !!expandedIds[cat.id]

    return (
      <div key={cat.id} className="space-y-1">
        <div
          className={`flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 group transition-colors cursor-pointer ${
            depth > 0 ? 'ml-6 border-l pl-4 border-muted' : ''
          }`}
          onClick={() => openEdit(cat)}
        >
          {hasChildren ? (
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6 p-0 hover:bg-muted shrink-0 text-muted-foreground'
              onClick={(e) => toggleExpand(cat.id, e)}
            >
              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
            </Button>
          ) : (
            <div className='w-6 shrink-0' />
          )}

          {cat.image ? (
            <SafeImage src={mediaUrl(cat.image)} alt='' className='h-8 w-8 rounded object-cover border shrink-0' thumbWidth={40} thumbHeight={40} />
          ) : (
            <div className='h-8 w-8 rounded bg-muted border shrink-0 flex items-center justify-center'>
              <ImageIcon className='h-4 w-4 text-muted-foreground' />
            </div>
          )}

          <div className='flex-1 min-w-0'>
            <div className='font-medium text-sm truncate'>{cat.name}</div>
          </div>

          <Badge variant='outline' className='text-[10px] uppercase font-mono px-1.5 py-0 shrink-0'>{cat.slug}</Badge>

          {cat._count && (
            <span className='text-xs text-muted-foreground shrink-0 hidden sm:inline'>
              {cat._count.products} {cat._count.products === 1 ? 'product' : 'products'}
            </span>
          )}

          {cat.isActive ? (
            <Badge variant='default' className='text-[10px] bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/25 shrink-0 px-2 border-0'>Active</Badge>
          ) : (
            <Badge variant='secondary' className='text-[10px] shrink-0 px-2'>Inactive</Badge>
          )}

          <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0' onClick={e => e.stopPropagation()}>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => copyCategoryLink(cat.slug, cat.id)} title='Copy link'>
              {copiedId === cat.id ? <Check className='h-3.5 w-3.5 text-emerald-500' /> : <Copy className='h-3.5 w-3.5' />}
            </Button>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(cat)}>
              <Pencil className='h-3.5 w-3.5' />
            </Button>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => {
              if (confirm(`Are you sure you want to delete "${cat.name}"?`)) {
                deleteMut.mutate(cat.id)
              }
            }}>
              <Trash2 className='h-3.5 w-3.5 text-destructive' />
            </Button>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="space-y-1">
            {cat.children.map((child: any) => renderCategory(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderFlatCategory = (cat: CategoryResponse) => {
    return (
      <div
        key={cat.id}
        className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 group cursor-pointer transition-colors"
        onClick={() => openEdit(cat)}
      >
        {cat.image ? (
          <SafeImage src={mediaUrl(cat.image)} alt='' className='h-8 w-8 rounded object-cover border shrink-0' thumbWidth={40} thumbHeight={40} />
        ) : (
          <div className='h-8 w-8 rounded bg-muted border shrink-0 flex items-center justify-center'>
            <ImageIcon className='h-4 w-4 text-muted-foreground' />
          </div>
        )}

        <div className='flex-1 min-w-0'>
          <div className='font-medium text-sm'>{cat.name}</div>
          <div className='text-xs text-muted-foreground truncate'>{getCategoryPath(cat)}</div>
        </div>

        <Badge variant='outline' className='text-[10px] uppercase font-mono px-1.5 py-0 shrink-0'>{cat.slug}</Badge>

        {cat._count && (
          <span className='text-xs text-muted-foreground shrink-0 hidden sm:inline'>
            {cat._count.products} {cat._count.products === 1 ? 'product' : 'products'}
          </span>
        )}

        {cat.isActive ? (
          <Badge variant='default' className='text-[10px] bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/25 shrink-0 px-2 border-0'>Active</Badge>
        ) : (
          <Badge variant='secondary' className='text-[10px] shrink-0 px-2'>Inactive</Badge>
        )}

        <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0' onClick={e => e.stopPropagation()}>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => copyCategoryLink(cat.slug, cat.id)} title='Copy link'>
            {copiedId === cat.id ? <Check className='h-3.5 w-3.5 text-emerald-500' /> : <Copy className='h-3.5 w-3.5' />}
          </Button>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(cat)}>
            <Pencil className='h-3.5 w-3.5' />
          </Button>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => {
            if (confirm(`Are you sure you want to delete "${cat.name}"?`)) {
              deleteMut.mutate(cat.id)
            }
          }}>
            <Trash2 className='h-3.5 w-3.5 text-destructive' />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Categories</h2>
            <p className='text-muted-foreground'>Manage product categories.</p>
          </div>
          <Button size='sm' onClick={() => setShowCreate(true)}><Plus className='h-4 w-4' /> Add Category</Button>
        </div>

        <div className='flex items-center max-w-xs relative'>
          <Search className='absolute left-2.5 h-4 w-4 text-muted-foreground pointer-events-none' />
          <Input
            placeholder='Filter categories...'
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className='pl-9 h-9 text-sm shadow-sm'
          />
          {searchTerm && (
            <Button variant='ghost' size='icon' onClick={() => setSearchTerm('')} className='absolute right-1.5 h-6 w-6 text-muted-foreground hover:text-foreground'>
              <X className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>

        {isLoading ? <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div> : (
          <Card>
            <CardContent className='p-4 space-y-1'>
              {searchTerm.trim() ? (
                matchingCats.length === 0 ? (
                  <p className='text-muted-foreground text-center py-8 text-sm'>No matching categories found.</p>
                ) : (
                  matchingCats.map(c => renderFlatCategory(c))
                )
              ) : (
                rootCategories.length === 0 ? (
                  <p className='text-muted-foreground text-center py-8 text-sm'>No categories yet.</p>
                ) : (
                  rootCategories.map(c => renderCategory(c))
                )
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={(showCreate || !!editing) && !pickerOpen} onOpenChange={(open) => { if (!open && !pickerOpen) { setShowCreate(false); setEditing(null); } }}>
          <DialogContent className='sm:max-w-[425px]'>
            <DialogHeader><DialogTitle>{editing ? 'Edit Category' : 'New Category'}</DialogTitle></DialogHeader>
            <div className='space-y-4 py-2'>
              <div className='space-y-1.5'>
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })} placeholder='Category name' />
              </div>
              <div className='space-y-1.5'>
                <Label>Slug</Label>
                <Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder='category-slug' />
              </div>
              <div className='space-y-1.5'>
                <Label>Parent Category</Label>
                <SearchableSelect
                  options={parentOptions}
                  value={form.parentId}
                  onChange={val => setForm({ ...form, parentId: val })}
                  placeholder='None (root)'
                  searchPlaceholder='Search parent categories...'
                />
              </div>
              <div className='space-y-2'>
                <Label>Image</Label>
                <div className='flex items-center gap-3'>
                  <div className='h-14 w-14 rounded-md border overflow-hidden bg-muted shrink-0 flex items-center justify-center shadow-inner'>
                    {form.image
                      ? <SafeImage src={mediaUrl(form.image)} alt='' className='h-full w-full object-cover' />
                      : <ImageIcon className='h-5 w-5 text-muted-foreground' />}
                  </div>
                  <Button type='button' variant='outline' size='sm' onClick={() => setPickerOpen(true)}>
                    {form.image ? 'Change' : 'Choose'} image
                  </Button>
                  {form.image && (
                    <Button type='button' variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground hover:text-foreground' onClick={() => setForm({ ...form, image: '' })}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
              </div>
              <div className='space-y-1.5'>
                <Label>Size Chart</Label>
                <SearchableSelect
                  options={sizeChartOptions}
                  value={form.sizeChartId}
                  onChange={val => setForm({ ...form, sizeChartId: val })}
                  placeholder='None'
                  searchPlaceholder='Search size charts...'
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => { setShowCreate(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={() => {
                const data = { name: form.name, slug: form.slug, parentId: form.parentId || null, image: form.image || null, sizeChartId: form.sizeChartId || null };
                editing ? updateMut.mutate({ id: editing.id, data }) : createMut.mutate(data as any);
              }} disabled={!form.name || !form.slug || createMut.isPending || updateMut.isPending}>{editing ? 'Save' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <MediaPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selected={form.image ? [form.image] : []}
          multiple={false}
          onSelect={(urls) => {
            setForm((prev) => ({ ...prev, image: urls[urls.length - 1] || '' }))
            setPickerOpen(false)
          }}
        />
      </Main>
    </>
  )
}
