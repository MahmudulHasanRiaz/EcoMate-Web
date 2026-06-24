import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { suppliersApi, type SupplierResponse } from './api'
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

export function Suppliers() {
  const queryClient = useQueryClient()
  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => suppliersApi.list().then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<SupplierResponse | null>(null)
  const [form, setForm] = useState({
    name: '', slug: '', contactPerson: '', email: '', phone: '',
    address: '', city: '', country: 'Bangladesh', taxId: '', paymentTerms: '', notes: '', isActive: true,
  })

  const createMut = useMutation({
    mutationFn: suppliersApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); setShowCreate(false); setForm({ name: '', slug: '', contactPerson: '', email: '', phone: '', address: '', city: '', country: 'Bangladesh', taxId: '', paymentTerms: '', notes: '', isActive: true }); toast.success('Created') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); setEditing(null); toast.success('Updated') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: suppliersApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Deleted') },
  })

  const openEdit = (supplier: SupplierResponse) => {
    setEditing(supplier)
    setForm({
      name: supplier.name, slug: supplier.slug, contactPerson: supplier.contactPerson || '',
      email: supplier.email || '', phone: supplier.phone || '', address: supplier.address || '',
      city: supplier.city || '', country: supplier.country || 'Bangladesh', taxId: supplier.taxId || '',
      paymentTerms: supplier.paymentTerms || '', notes: supplier.notes || '', isActive: supplier.isActive,
    })
  }

  const renderSupplier = (supplier: SupplierResponse) => (
    <div key={supplier.id}>
      <div className='flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-muted/50 group'>
        <span className='flex-1 font-medium'>{supplier.name}</span>
        {supplier.contactPerson && <span className='text-xs text-muted-foreground'>{supplier.contactPerson}</span>}
        {supplier.phone && <span className='text-xs text-muted-foreground'>{supplier.phone}</span>}
        {supplier.email && <span className='text-xs text-muted-foreground'>{supplier.email}</span>}
        <Badge variant='outline' className='text-xs'>{supplier.slug}</Badge>
        {supplier._count && <span className='text-xs text-muted-foreground'>{supplier._count.purchases} purchases</span>}
        {supplier.isActive ? <Badge variant='default' className='text-xs bg-green-500'>Active</Badge> : <Badge variant='secondary' className='text-xs'>Inactive</Badge>}
        <div className='flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(supplier)}><Pencil className='h-3.5 w-3.5' /></Button>
          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(supplier.id)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
        </div>
      </div>
    </div>
  )

  const allSuppliers = Array.isArray(suppliers) ? suppliers : []

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
            <h2 className='text-2xl font-bold tracking-tight'>Suppliers</h2>
            <p className='text-muted-foreground'>Manage product suppliers.</p>
          </div>
          <Button size='sm' onClick={() => setShowCreate(true)}><Plus className='h-4 w-4' /> Add Supplier</Button>
        </div>

        {isLoading ? <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div> : (
          <Card>
            <CardContent className='pt-4'>
              <div className='flex flex-col gap-1'>
                {allSuppliers.map(s => renderSupplier(s))}
                {allSuppliers.length === 0 && <div className='text-center py-12 text-muted-foreground'>No suppliers found</div>}
              </div>
            </CardContent>
          </Card>
        )}
      </Main>

      <Dialog open={showCreate || !!editing} onOpenChange={o => { if (!o) { setShowCreate(false); setEditing(null) } }}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => {
                const name = e.target.value
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                setForm(f => ({ ...f, name, slug: editing ? f.slug : slug }))
              }} placeholder='e.g. TechSource Ltd' />
            </div>
            <div className='grid gap-2'>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>Contact Person</Label>
                <Input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder='e.g. John Doe' />
              </div>
              <div className='grid gap-2'>
                <Label>Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder='e.g. john@example.com' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder='e.g. +880 1234 567890' />
              </div>
              <div className='grid gap-2'>
                <Label>Tax ID</Label>
                <Input value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder='e.g. BIN 123456' />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder='e.g. 123, Gulshan Avenue' />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>City</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder='e.g. Dhaka' />
              </div>
              <div className='grid gap-2'>
                <Label>Country</Label>
                <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Payment Terms</Label>
              <Input value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} placeholder='e.g. Net 30' />
            </div>
            <div className='grid gap-2'>
              <Label>Notes</Label>
              <textarea
                className='flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder='Additional notes...'
              />
            </div>
            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' className='rounded border-gray-300' checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setShowCreate(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={() => editing ? updateMut.mutate({ id: editing.id, data: form }) : createMut.mutate(form)} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? 'Save Changes' : 'Create Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
