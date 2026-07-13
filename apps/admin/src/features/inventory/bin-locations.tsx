import { useState, useEffect } from 'react'
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
  zoneId: string | null
  rackId: string | null
  shelfId: string | null
  isActive: boolean
  warehouse: { id: string; name: string }
  zone?: { id: string; name: string } | null
  rack?: { id: string; name: string } | null
  shelf?: { id: string; name: string } | null
  createdAt: string
}

interface WarehouseItem {
  id: string
  name: string
  isActive: boolean
}

interface Zone {
  id: string
  name: string
  racks: Rack[]
}

interface Rack {
  id: string
  name: string
  shelves: Shelf[]
}

interface Shelf {
  id: string
  name: string
}

interface BinForm {
  code: string
  zoneId: string
  rackId: string
  shelfId: string
  warehouseId: string
}

const emptyForm: BinForm = { code: '', zoneId: '', rackId: '', shelfId: '', warehouseId: '' }

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

  // Fetch zones for selected warehouse
  const { data: zones } = useQuery<Zone[]>({
    queryKey: ['zones', form.warehouseId],
    queryFn: () => apiClient.get(`/warehouses/${form.warehouseId}/zones`).then(r => r.data || []),
    enabled: !!form.warehouseId,
  })

  // Derive racks from selected zone
  const selectedZone = zones?.find(z => z.id === form.zoneId)
  const racks = selectedZone?.racks ?? []

  // Derive shelves from selected rack
  const selectedRack = racks.find(r => r.id === form.rackId)
  const shelves = selectedRack?.shelves ?? []

  // Reset dependent fields when parent changes
  useEffect(() => {
    if (form.warehouseId) {
      setForm(f => ({ ...f, zoneId: '', rackId: '', shelfId: '' }))
    }
  }, [form.warehouseId])

  useEffect(() => {
    if (form.zoneId) {
      setForm(f => ({ ...f, rackId: '', shelfId: '' }))
    }
  }, [form.zoneId])

  useEffect(() => {
    if (form.rackId) {
      setForm(f => ({ ...f, shelfId: '' }))
    }
  }, [form.rackId])

  const createMut = useMutation({
    mutationFn: (data: { code: string; warehouseId: string; zoneId?: string; rackId?: string; shelfId?: string }) =>
      apiClient.post(`/warehouses/${data.warehouseId}/bin-locations`, {
        code: data.code,
        zoneId: data.zoneId || undefined,
        rackId: data.rackId || undefined,
        shelfId: data.shelfId || undefined,
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
    mutationFn: ({ id, warehouseId, data }: { id: string; warehouseId: string; data: { code: string; zoneId?: string; rackId?: string; shelfId?: string } }) =>
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
      zoneId: bin.zoneId || '',
      rackId: bin.rackId || '',
      shelfId: bin.shelfId || '',
      warehouseId: bin.warehouseId,
    })
    setOpen(true)
  }

  const handleSubmit = () => {
    if (!form.code.trim()) { toast.error('Bin code is required'); return }
    if (!form.warehouseId) { toast.error('Warehouse is required'); return }
    if (editing) {
      updateMut.mutate({ id: editing.id, warehouseId: editing.warehouseId, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  const warehouseNameById = (id: string) => warehouses?.find(w => w.id === id)?.name || id

  const formatHierarchy = (bin: BinLocation) => {
    const parts: string[] = []
    if (bin.zone?.name) parts.push(bin.zone.name)
    if (bin.rack?.name) parts.push(bin.rack.name)
    if (bin.shelf?.name) parts.push(bin.shelf.name)
    return parts.length > 0 ? parts.join(' / ') : '-'
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Bin Locations</h1>
            <p className='text-muted-foreground'>Manage warehouse storage hierarchy (Zone → Rack → Shelf → Bin).</p>
          </div>
          <Button onClick={openCreate}>
            <Plus className='mr-2 h-4 w-4' /> Add Bin
          </Button>
        </div>

        <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search bins..." className="pl-9 bg-background" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="w-[180px] bg-background"><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {warehouses?.filter(w => w.isActive).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin Code</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Zone / Rack / Shelf</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="animate-spin h-5 w-5 mx-auto" /></TableCell></TableRow>
                ) : !bins?.length ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No bin locations found.</TableCell></TableRow>
                ) : (
                  bins.map(bin => (
                    <TableRow key={bin.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {bin.code}
                        </div>
                      </TableCell>
                      <TableCell>{warehouseNameById(bin.warehouseId)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatHierarchy(bin)}</TableCell>
                      <TableCell>
                        <Badge variant={bin.isActive ? 'default' : 'secondary'}>{bin.isActive ? 'Active' : 'Inactive'}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(bin)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirm(bin)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); setForm(emptyForm) } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Bin Location' : 'Add Bin Location'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Warehouse *</Label>
              <Select value={form.warehouseId} onValueChange={(v) => setForm(f => ({ ...f, warehouseId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                <SelectContent>
                  {warehouses?.filter(w => w.isActive).map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Bin Code *</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. A-01-01" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Zone</Label>
                <Select value={form.zoneId} onValueChange={(v) => setForm(f => ({ ...f, zoneId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Zone" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {zones?.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rack</Label>
                <Select value={form.rackId} onValueChange={(v) => setForm(f => ({ ...f, rackId: v }))} disabled={!form.zoneId}>
                  <SelectTrigger><SelectValue placeholder="Rack" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {racks.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Shelf</Label>
                <Select value={form.shelfId} onValueChange={(v) => setForm(f => ({ ...f, shelfId: v }))} disabled={!form.rackId}>
                  <SelectTrigger><SelectValue placeholder="Shelf" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {shelves.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setForm(emptyForm) }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bin Location</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete bin <strong>{deleteConfirm?.code}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMut.mutate({ id: deleteConfirm.id, warehouseId: deleteConfirm.warehouseId })}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
