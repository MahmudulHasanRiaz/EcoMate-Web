import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Pencil, Trash2, Building2, Search, X, Eye } from 'lucide-react'
import { WarehouseWorkspaceDrawer } from './components/warehouse-workspace-drawer'

interface Warehouse {
  id: string
  name: string
  slug: string
  type: 'main' | 'showroom' | 'storage'
  address?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  isActive: boolean
  _count?: { binLocations: number }
  createdAt: string
  updatedAt: string
}

interface WarehouseForm {
  name: string
  slug: string
  type: 'main' | 'showroom' | 'storage'
  address: string
  city: string
  phone: string
  email: string
  isActive: boolean
}

const emptyForm: WarehouseForm = {
  name: '',
  slug: '',
  type: 'main',
  address: '',
  city: '',
  phone: '',
  email: '',
  isActive: true,
}

export function Warehouses() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [form, setForm] = useState<WarehouseForm>(emptyForm)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null)

  const { data: warehouses, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get<Warehouse[]>('/warehouses').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: WarehouseForm) => apiClient.post('/warehouses', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setOpen(false)
      setForm(emptyForm)
      toast.success('Warehouse created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating warehouse'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WarehouseForm> }) => apiClient.put(`/warehouses/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm)
      toast.success('Warehouse updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating warehouse'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/warehouses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setDeleteConfirm(null)
      toast.success('Warehouse deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting warehouse'),
  })

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setOpen(true)
  }

  const openEdit = (w: Warehouse) => {
    setEditing(w)
    setForm({
      name: w.name,
      slug: w.slug,
      type: w.type || 'main',
      address: w.address || '',
      city: w.city || '',
      phone: w.phone || '',
      email: w.email || '',
      isActive: w.isActive,
    })
    setOpen(true)
  }

  const openWorkspace = (w: Warehouse) => {
    setSelectedWarehouse(w)
    setWorkspaceOpen(true)
  }

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    const slug = form.slug.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const payload = { ...form, name: form.name.trim(), slug }
    if (editing) {
      updateMut.mutate({ id: editing.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const list = Array.isArray(warehouses) ? warehouses : []
  const filtered = search
    ? list.filter(w => w.name.toLowerCase().includes(search.toLowerCase()) || w.slug.toLowerCase().includes(search.toLowerCase()))
    : list

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-end justify-between'>
          <div>
            <div className='flex items-center gap-3'>
              <h2 className='text-2xl font-bold tracking-tight'>Warehouses</h2>
            </div>
            <p className='text-muted-foreground text-sm'>
              {list.length} warehouses
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Warehouse
          </Button>
        </div>

        <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10'>
          <CardContent className='p-3'>
            <div className='relative w-[220px]'>
              <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder='Search warehouses...'
                className='h-9 text-sm pl-9 pr-7 bg-background/70 focus:bg-background border-none shadow-sm'
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className='absolute right-2 top-1/2 -translate-y-1/2 hover:text-foreground transition-colors'
                >
                  <X className='h-3.5 w-3.5 text-muted-foreground' />
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Bin Locations</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-20'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : filtered.length ? (
                  filtered.map((w: Warehouse) => (
                    <TableRow key={w.id}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <Building2 className='h-4 w-4 text-muted-foreground' />
                          <div>
                            <div className='font-medium'>{w.name}</div>
                            {w.address && <div className='text-xs text-muted-foreground'>{w.address}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline' className='capitalize'>{w.type}</Badge>
                      </TableCell>
                      <TableCell className='text-sm'>{w.city || '-'}</TableCell>
                      <TableCell className='text-sm'>{w.phone || '-'}</TableCell>
                      <TableCell className='text-sm'>{w.email || '-'}</TableCell>
                      <TableCell className='text-sm'>
                        <Badge variant='outline'>{w._count?.binLocations || 0}</Badge>
                      </TableCell>
                      <TableCell>
                        {w.isActive ? (
                          <Badge variant='default' className='bg-green-500 text-xs'>Active</Badge>
                        ) : (
                          <Badge variant='secondary' className='text-xs'>Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1 justify-end'>
                          <Button variant='ghost' size='sm' onClick={() => openWorkspace(w)}>
                            <Eye className='h-3.5 w-3.5 mr-1' /> View Workspace
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(w)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteConfirm(w.id)}>
                            <Trash2 className='h-3.5 w-3.5 text-destructive' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className='text-center py-12 text-muted-foreground'>
                      {search ? 'No warehouses match your search.' : 'No warehouses found. Create your first warehouse.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Warehouse' : 'New Warehouse'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-2'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => {
                  const name = e.target.value
                  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                  setForm(f => ({ ...f, name, slug: editing ? f.slug : slug }))
                }}
                placeholder='e.g. Main Warehouse'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                placeholder='e.g. main-warehouse'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(value: 'main' | 'showroom' | 'storage') => setForm(f => ({ ...f, type: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select type' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='main'>Main Warehouse</SelectItem>
                  <SelectItem value='showroom'>Showroom</SelectItem>
                  <SelectItem value='storage'>Storage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder='e.g. 123, Industrial Area'
              />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>City</Label>
                <Input
                  value={form.city}
                  onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  placeholder='e.g. Dhaka'
                />
              </div>
              <div className='grid gap-2'>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder='e.g. +880 1234 567890'
                />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder='e.g. warehouse@example.com'
              />
            </div>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                className='rounded border-gray-300'
                checked={form.isActive}
                onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Warehouse</DialogTitle></DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete this warehouse? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WarehouseWorkspaceDrawer 
        open={workspaceOpen} 
        onOpenChange={setWorkspaceOpen} 
        warehouse={selectedWarehouse} 
      />
    </>
  )
}