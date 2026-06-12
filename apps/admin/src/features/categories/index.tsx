import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, ChevronRight, Image as ImageIcon, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { categoriesApi, type CategoryResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { MediaPicker } from '@/components/media-picker'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'

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
  })

  const openEdit = (cat: CategoryResponse) => {
    setEditing(cat)
    setForm({ name: cat.name, slug: cat.slug, parentId: cat.parentId || '', image: cat.image || '', sizeChartId: (cat as any).sizeChartId || '' })
  }

  const renderCategory = (cat: CategoryResponse, depth = 0) => (
    <div key={cat.id}>
      <div className={`flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-muted/50 group ${depth > 0 ? 'ml-6 border-l-2 pl-4' : ''}`}>
        {cat.children && cat.children.length > 0 && <ChevronRight className='h-4 w-4 text-muted-foreground' />}
        {cat.image ? (
          <SafeImage src={mediaUrl(cat.image)} alt='' className='h-8 w-8 rounded object-cover border shrink-0' thumbWidth={40} thumbHeight={40} />
        ) : (
          <div className='h-8 w-8 rounded bg-muted border shrink-0 flex items-center justify-center'><ImageIcon className='h-4 w-4 text-muted-foreground' /></div>
        )}
        <span className='flex-1 font-medium'>{cat.name}</span>
        <Badge variant='outline' className='text-xs'>{cat.slug}</Badge>
        {cat._count && <span className='text-xs text-muted-foreground'>{cat._count.products} products</span>}
        {cat.isActive ? <Badge variant='default' className='text-xs bg-green-500'>Active</Badge> : <Badge variant='secondary' className='text-xs'>Inactive</Badge>}
        <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(cat)}><Pencil className='h-3.5 w-3.5' /></Button>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(cat.id)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
        </div>
      </div>
      {cat.children?.map(child => renderCategory(child, depth + 1))}
    </div>
  )

  const rootCategories = (Array.isArray(categories) ? categories : []).filter((c: CategoryResponse) => !c.parentId)

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
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

        {isLoading ? <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div> : (
          <Card>
            <CardContent className='pt-4'>
              {rootCategories.length === 0 ? <p className='text-muted-foreground text-center py-8'>No categories yet.</p> : rootCategories.map(c => renderCategory(c))}
            </CardContent>
          </Card>
        )}

        <Dialog open={showCreate || !!editing} onOpenChange={() => { setShowCreate(false); setEditing(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Edit Category' : 'New Category'}</DialogTitle></DialogHeader>
            <div className='space-y-3'>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })} placeholder='Category name' /></div>
              <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder='category-slug' /></div>
              <div><Label>Parent Category</Label>
                <select className='w-full rounded-md border px-3 py-2 text-sm' value={form.parentId} onChange={e => setForm({ ...form, parentId: e.target.value })}>
                  <option value=''>None (root)</option>
                  {(Array.isArray(categories) ? categories : []).map((c: CategoryResponse) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className='space-y-2'>
                <Label>Image</Label>
                <div className='flex items-center gap-2'>
                  <div className='h-14 w-14 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                    {form.image
                      ? <SafeImage src={mediaUrl(form.image)} alt='' className='h-full w-full object-cover' />
                      : <ImageIcon className='h-5 w-5 text-muted-foreground' />}
                  </div>
                  <Button type='button' variant='outline' size='sm' onClick={() => setPickerOpen(true)}>
                    {form.image ? 'Change' : 'Choose'} image
                  </Button>
                  {form.image && (
                    <Button type='button' variant='ghost' size='icon' onClick={() => setForm({ ...form, image: '' })}>
                      <X className='h-4 w-4' />
                    </Button>
                  )}
                </div>
              </div>
              <div className='space-y-1.5'>
                <Label>Size Chart</Label>
                <select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={form.sizeChartId} onChange={e => setForm({ ...form, sizeChartId: e.target.value })}>
                  <option value=''>None</option>
                  {(Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as any)?.data || []).map((sc: any) => (
                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => { setShowCreate(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={() => {
                const data = { name: form.name, slug: form.slug, parentId: form.parentId || undefined, image: form.image || undefined, sizeChartId: form.sizeChartId || undefined };
                editing ? updateMut.mutate({ id: editing.id, data }) : createMut.mutate(data as any);
              }} disabled={!form.name || !form.slug}>{editing ? 'Save' : 'Create'}</Button>
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
