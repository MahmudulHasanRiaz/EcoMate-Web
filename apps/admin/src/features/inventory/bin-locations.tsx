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
import { Loader2, Plus, Pencil, Trash2, MapPin, Search, X, Warehouse } from 'lucide-react'

interface BinLocation {
  id: string
  warehouseId: string
  code: string
  zone: string | null
  rack: string | null
  shelf: string | null
  isActive: boolean
  warehouse: { id: string; name: string }
  createdAt: string
}

interface WarehouseItem {
  id: string
  name: string
  isActive: boolean
}

interface BinForm {
  code: string
  zone: string
  rack: string
  shelf: string
  warehouseId: string
}

const emptyForm: BinForm = { code: '', zone: '', rack: '', shelf: '', warehouseId: '' }

export function BinLocations() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<BinLocation | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<BinLocation | null>(null)
  const [form, setForm] = useState<BinForm>(emptyForm)

  const { data: bins, isLoading, isError, error } = useQuery<BinLocation[]>({
    queryKey: ['all-bin-locations', warehouseFilter, statusFilter, search],
    queryFn: () => {
      const params: Record<string, string> = {}
      if (warehouseFilter !== 'all') params.warehouseId = warehouseFilter
      if (statusFilter !== 'all') params.isActive = statusFilter === 'active' ? 'true' : 'false'
      if (search) params.search = search
      return apiClient.get('/warehouses/bin-locations', { params }).then(r => r.data)
    },
  })

  const { data: warehouses } = useQuery<WarehouseItem[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const createMut = useMutation({
    mutationFn: (data: { code: string; warehouseId: string; zone?: string; rack?: string; shelf?: string }) =>
      apiClient.post(`/warehouses/${data.warehouseId}/bin-locations`, {
        code: data.code,
        zone: data.zone || undefined,
        rack: data.rack || undefined,
        shelf: data.shelf || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bin-locations'] })
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setOpen(false)
      setForm(emptyForm)
      toast.success('Bin location created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating bin'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, warehouseId, data }: { id: string; warehouseId: string; data: { code: string; zone?: string; rack?: string; shelf?: string } }) =>
      apiClient.put(`/warehouses/${warehouseId}/bin-locations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bin-locations'] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm)
      toast.success('Bin location updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating bin'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, warehouseId }: { id: string; warehouseId: string }) =>
      apiClient.delete(`/warehouses/${warehouseId}/bin-locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-bin-locations'] })
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      setDeleteConfirm(null)
      toast.success('Bin location deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting bin'),
  })

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setOpen(true)
  }

  const openEdit = (bin: BinLocation) => {
    setEditing(bin)
    setForm({
      code: bin.code,
      zone: bin.zone || '',
      rack: bin.rack || '',
      shelf: bin.shelf || '',
      warehouseId: bin.warehouseId,
    })
    setOpen(true)
  }

  const handleSave = () => {
    if (!form.code.trim()) { toast.error('Bin code is required'); return }
    if (!form.warehouseId) { toast.error('Select a warehouse'); return }

    const payload = {
      code: form.code.trim(),
      zone: form.zone.trim() || undefined,
      rack: form.rack.trim() || undefined,
      shelf: form.shelf.trim() || undefined,
    }

    if (editing) {
      updateMut.mutate({ id: editing.id, warehouseId: editing.warehouseId, data: payload })
    } else {
      createMut.mutate({ ...payload, warehouseId: form.warehouseId })
    }
  }

  const list = Array.isArray(bins) ? bins : []
  const warehouseList = Array.isArray(warehouses) ? warehouses.filter(w => w.isActive) : []

  const totalBins = list.length
  const activeBins = list.filter(b => b.isActive).length
  const warehousesWithBins = new Set(list.map(b => b.warehouseId)).size

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
            <h2 className='text-2xl font-bold tracking-tight'>Bin Locations</h2>
            <p className='text-muted-foreground text-sm'>
              Manage storage positions within warehouses
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Bin
          </Button>
        </div>

        <div className='grid grid-cols-3 gap-4'>
          <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10'>
            <CardContent className='p-4'>
              <div className='text-xs font-medium text-muted-foreground'>Total Bins</div>
              <div className='text-2xl font-bold mt-1'>{totalBins}</div>
            </CardContent>
          </Card>
          <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10'>
            <CardContent className='p-4'>
              <div className='text-xs font-medium text-muted-foreground'>Active Bins</div>
              <div className='text-2xl font-bold mt-1 text-green-600'>{activeBins}</div>
            </CardContent>
          </Card>
          <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10'>
            <CardContent className='p-4'>
              <div className='text-xs font-medium text-muted-foreground'>Warehouses with Bins</div>
              <div className='text-2xl font-bold mt-1 text-blue-600'>{warehousesWithBins}</div>
            </CardContent>
          </Card>
        </div>

        <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10'>
          <CardContent className='p-3'>
            <div className='flex items-center gap-3'>
              <div className='relative w-[220px]'>
                <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder='Search by bin code...'
                  className='h-9 text-sm pl-9 pr-7 bg-background/70 focus:bg-background border-none shadow-sm'
                />
                {search && (
                  <button onClick={() => setSearch('')} className='absolute right-2 top-1/2 -translate-y-1/2 hover:text-foreground transition-colors'>
                    <X className='h-3.5 w-3.5 text-muted-foreground' />
                  </button>
                )}
              </div>
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className='h-9 w-[180px] bg-background border-none shadow-sm'>
                  <SelectValue placeholder='All Warehouses' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All Warehouses</SelectItem>
                  {warehouseList.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className='h-9 w-[140px] bg-background border-none shadow-sm'>
                  <SelectValue placeholder='All Status' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All Status</SelectItem>
                  <SelectItem value='active'>Active</SelectItem>
                  <SelectItem value='inactive'>Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Rack</TableHead>
                  <TableHead>Shelf</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-20'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError ? (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center py-8 text-destructive'>
                      <p className='text-sm'>{error instanceof Error ? error.message : 'Failed to load bin locations.'}</p>
                    </TableCell>
                  </TableRow>
                ) : isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : list.length > 0 ? (
                  list.map(bin => (
                    <TableRow key={bin.id}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <MapPin className='h-4 w-4 text-muted-foreground' />
                          <span className='font-medium font-mono text-sm'>{bin.code}</span>
                        </div>
                      </TableCell>
                      <TableCell className='text-sm'>{bin.zone || '—'}</TableCell>
                      <TableCell className='text-sm'>{bin.rack || '—'}</TableCell>
                      <TableCell className='text-sm'>{bin.shelf || '—'}</TableCell>
                      <TableCell>
                        <div className='flex items-center gap-1.5'>
                          <Warehouse className='h-3.5 w-3.5 text-muted-foreground' />
                          <span className='text-sm'>{bin.warehouse?.name || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {bin.isActive ? (
                          <Badge variant='default' className='bg-green-500 text-xs'>Active</Badge>
                        ) : (
                          <Badge variant='secondary' className='text-xs'>Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1 justify-end'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(bin)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteConfirm(bin)}>
                            <Trash2 className='h-3.5 w-3.5 text-destructive' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center py-12 text-muted-foreground'>
                      {search || warehouseFilter !== 'all' || statusFilter !== 'all'
                        ? 'No bins match your filters.'
                        : 'No bin locations found. Create your first bin.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Bin Location' : 'New Bin Location'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-2'>
            {!editing && (
              <div className='grid gap-2'>
                <Label>Warehouse *</Label>
                <Select value={form.warehouseId} onValueChange={v => setForm(f => ({ ...f, warehouseId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select warehouse' />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseList.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editing && (
              <div className='grid gap-2'>
                <Label>Warehouse</Label>
                <Input value={editing.warehouse?.name || ''} disabled className='bg-muted' />
              </div>
            )}
            <div className='grid gap-2'>
              <Label>Bin Code *</Label>
              <Input
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder='e.g. A1-01'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Zone</Label>
              <Input
                value={form.zone}
                onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                placeholder='e.g. Dry Goods'
              />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>Rack</Label>
                <Input
                  value={form.rack}
                  onChange={e => setForm(f => ({ ...f, rack: e.target.value }))}
                  placeholder='e.g. R-01'
                />
              </div>
              <div className='grid gap-2'>
                <Label>Shelf</Label>
                <Input
                  value={form.shelf}
                  onChange={e => setForm(f => ({ ...f, shelf: e.target.value }))}
                  placeholder='e.g. S-01'
                />
              </div>
            </div>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bin Location</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete bin <strong>{deleteConfirm?.code}</strong>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => deleteConfirm && deleteMut.mutate({ id: deleteConfirm.id, warehouseId: deleteConfirm.warehouseId })}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
