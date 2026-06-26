import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, Image as ImageIcon } from 'lucide-react'
import { brandsApi, type BrandResponse } from './api'
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
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'

export function Brands() {
  const queryClient = useQueryClient()
  const { data: brands, isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandsApi.list().then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<BrandResponse | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', logo: '' })
  const [pickerOpen, setPickerOpen] = useState(false)

  const createMut = useMutation({
    mutationFn: brandsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['brands'] }); setShowCreate(false); setForm({ name: '', slug: '', logo: '' }); toast.success('Created') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => brandsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['brands'] }); setEditing(null); toast.success('Updated') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: brandsApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['brands'] }); toast.success('Deleted') },
  })

  const openEdit = (brand: BrandResponse) => {
    setEditing(brand)
    setForm({ name: brand.name, slug: brand.slug, logo: brand.logo || '' })
  }

  const renderBrand = (brand: BrandResponse) => (
    <div key={brand.id}>
      <div className={`flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-muted/50 group`}>
        {brand.logo ? (
          <SafeImage src={mediaUrl(brand.logo)} alt='' className='h-8 w-8 rounded object-cover border shrink-0 bg-white' thumbWidth={40} thumbHeight={40} />
        ) : (
          <div className='h-8 w-8 rounded bg-muted border shrink-0 flex items-center justify-center'><ImageIcon className='h-4 w-4 text-muted-foreground' /></div>
        )}
        <span className='flex-1 font-medium'>{brand.name}</span>
        <Badge variant='outline' className='text-xs'>{brand.slug}</Badge>
        {brand._count && <span className='text-xs text-muted-foreground'>{brand._count.products} products</span>}
        {brand.isActive ? <Badge variant='default' className='text-xs bg-green-500'>Active</Badge> : <Badge variant='secondary' className='text-xs'>Inactive</Badge>}
        <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(brand)}><Pencil className='h-3.5 w-3.5' /></Button>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(brand.id)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
        </div>
      </div>
    </div>
  )

  const allBrands = Array.isArray(brands) ? brands : []

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
            <h2 className='text-2xl font-bold tracking-tight'>Brands</h2>
            <p className='text-muted-foreground'>Manage product brands.</p>
          </div>
          <Button size='sm' onClick={() => setShowCreate(true)}><Plus className='h-4 w-4' /> Add Brand</Button>
        </div>

        {isLoading ? <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div> : (
          <Card>
            <CardContent className='pt-4'>
              <div className='flex flex-col gap-1'>
                {allBrands.map(b => renderBrand(b))}
                {allBrands.length === 0 && <div className='text-center py-12 text-muted-foreground'>No brands found</div>}
              </div>
            </CardContent>
          </Card>
        )}
      </Main>

      {/* Dialog for Create/Edit */}
      <Dialog open={(showCreate || !!editing) && !pickerOpen} onOpenChange={o => { if (!o && !pickerOpen) { setShowCreate(false); setEditing(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Brand' : 'Add Brand'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => {
                const name = e.target.value
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                setForm(f => ({ ...f, name, slug: editing ? f.slug : slug }))
              }} placeholder='e.g. Apple' />
            </div>
            <div className='grid gap-2'>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            
            <div className='grid gap-2'>
              <Label>Logo</Label>
              <div className='flex items-center gap-4'>
                {form.logo ? <SafeImage src={mediaUrl(form.logo)} className='h-12 w-12 rounded border object-cover' alt='' thumbWidth={48} thumbHeight={48} /> : <div className='h-12 w-12 rounded border bg-muted flex items-center justify-center'><ImageIcon className='h-5 w-5 text-muted-foreground' /></div>}
                <Button variant='outline' size='sm' onClick={() => setPickerOpen(true)}>Choose Logo</Button>
                {form.logo && <Button variant='ghost' size='sm' className='text-destructive' onClick={() => setForm(f => ({ ...f, logo: '' }))}>Clear</Button>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setShowCreate(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={() => editing ? updateMut.mutate({ id: editing.id, data: form }) : createMut.mutate(form)} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? 'Save Changes' : 'Create Brand'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MediaPicker selected={form.logo ? [form.logo] : []} open={pickerOpen} onOpenChange={setPickerOpen} onSelect={m => { setForm(f => ({ ...f, logo: m[0] || '' })); setPickerOpen(false) }} />
    </>
  )
}
