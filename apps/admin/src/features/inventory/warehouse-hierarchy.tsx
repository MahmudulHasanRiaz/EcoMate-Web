import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Pencil, Trash2, Zap, Building2, ListTree } from 'lucide-react'

interface Zone {
  id: string
  name: string
  isActive: boolean
  racks: Rack[]
}

interface Rack {
  id: string
  name: string
  isActive: boolean
  shelves: Shelf[]
}

interface Shelf {
  id: string
  name: string
  isActive: boolean
}

interface WarehouseItem {
  id: string
  name: string
  isActive: boolean
}

type EntityType = 'zone' | 'rack' | 'shelf'
type DialogMode = 'create' | 'edit' | null

interface EntityDialog {
  mode: DialogMode
  type: EntityType
  parentId: string | null
  id: string | null
  name: string
  isActive: boolean
}

const emptyDialog = (): EntityDialog => ({
  mode: null, type: 'zone', parentId: null, id: null, name: '', isActive: true,
})

export function WarehouseHierarchy() {
  const queryClient = useQueryClient()
  const [warehouseId, setWarehouseId] = useState('')
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [selectedRackId, setSelectedRackId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: EntityType; id: string; name: string } | null>(null)
  const [dialog, setDialog] = useState<EntityDialog>(emptyDialog)

  const { data: warehouses } = useQuery<WarehouseItem[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const { data: zones, isLoading: zonesLoading } = useQuery<Zone[]>({
    queryKey: ['zones', warehouseId],
    queryFn: () => apiClient.get(`/warehouses/${warehouseId}/zones`).then(r => r.data || []),
    enabled: !!warehouseId,
  })

  const selectedZone = zones?.find(z => z.id === selectedZoneId) ?? null
  const selectedRack = selectedZone?.racks.find(r => r.id === selectedRackId) ?? null

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['zones', warehouseId] })
  }

  const createMut = useMutation({
    mutationFn: ({ type, parentId, name }: { type: EntityType; parentId: string | null; name: string }) => {
      if (type === 'zone') return apiClient.post(`/warehouses/${warehouseId}/zones`, { name })
      if (type === 'rack') return apiClient.post(`/warehouses/${warehouseId}/zones/${parentId}/racks`, { name })
      return apiClient.post(`/warehouses/${warehouseId}/zones/${selectedZoneId}/racks/${parentId}/shelves`, { name })
    },
    onSuccess: () => { invalidate(); setDialog(emptyDialog()); toast.success('Created') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating'),
  })

  const updateMut = useMutation({
    mutationFn: ({ type, id, name, isActive }: { type: EntityType; id: string; name: string; isActive: boolean }) => {
      if (type === 'zone') return apiClient.put(`/warehouses/${warehouseId}/zones/${id}`, { name, isActive })
      if (type === 'rack') return apiClient.put(`/warehouses/${warehouseId}/zones/${selectedZoneId}/racks/${id}`, { name, isActive })
      return apiClient.put(`/warehouses/${warehouseId}/zones/${selectedZoneId}/racks/${selectedRackId}/shelves/${id}`, { name, isActive })
    },
    onSuccess: () => { invalidate(); setDialog(emptyDialog()); toast.success('Updated') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ type, id }: { type: EntityType; id: string }) => {
      if (type === 'zone') return apiClient.delete(`/warehouses/${warehouseId}/zones/${id}`)
      if (type === 'rack') return apiClient.delete(`/warehouses/${warehouseId}/zones/${selectedZoneId}/racks/${id}`)
      return apiClient.delete(`/warehouses/${warehouseId}/zones/${selectedZoneId}/racks/${selectedRackId}/shelves/${id}`)
    },
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast.success('Deleted') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting'),
  })

  const openCreate = (type: EntityType, parentId: string | null) => {
    setDialog({ mode: 'create', type, parentId, id: null, name: '', isActive: true })
  }

  const openEdit = (type: EntityType, id: string, name: string, isActive: boolean) => {
    setDialog({ mode: 'edit', type, parentId: null, id, name, isActive })
  }

  const handleDialogSubmit = () => {
    if (!dialog.name.trim()) { toast.error('Name is required'); return }
    if (dialog.mode === 'create') {
      createMut.mutate({ type: dialog.type, parentId: dialog.parentId, name: dialog.name.trim() })
    } else if (dialog.mode === 'edit' && dialog.id) {
      updateMut.mutate({ type: dialog.type, id: dialog.id, name: dialog.name.trim(), isActive: dialog.isActive })
    }
  }

  const handleSelectZone = (id: string) => {
    setSelectedZoneId(id === selectedZoneId ? null : id)
    setSelectedRackId(null)
  }

  const handleSelectRack = (id: string) => {
    setSelectedRackId(id === selectedRackId ? null : id)
  }

  const activeWarehouses = warehouses?.filter(w => w.isActive) ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Building2 className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Warehouse Hierarchy</h1>
          <p className="text-muted-foreground">Manage Zone → Rack → Shelf structure.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Label className="whitespace-nowrap">Warehouse</Label>
        <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setSelectedZoneId(null); setSelectedRackId(null) }}>
          <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select a warehouse" /></SelectTrigger>
          <SelectContent>
            {activeWarehouses.map(w => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {warehouseId && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Zones Column */}
          <Card className={selectedZone ? 'border-primary/30' : ''}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Zones</CardTitle>
              <Button size="sm" variant="outline" onClick={() => openCreate('zone', null)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {zonesLoading ? (
                <div className="py-8 text-center"><Loader2 className="animate-spin h-5 w-5 mx-auto" /></div>
              ) : !zones?.length ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No zones. Click Add to create one.</div>
              ) : (
                <div className="divide-y">
                  {zones.map(zone => (
                    <div
                      key={zone.id}
                      className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${selectedZoneId === zone.id ? 'bg-primary/5 font-medium' : ''}`}
                      onClick={() => handleSelectZone(zone.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm">{zone.name}</span>
                        <Badge variant={zone.isActive ? 'default' : 'secondary'} className="h-5 text-[10px] px-1.5">
                          {zone.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit('zone', zone.id, zone.name, zone.isActive)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget({ type: 'zone', id: zone.id, name: zone.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Racks Column */}
          <Card className={!selectedZone ? 'opacity-40' : selectedRack ? 'border-primary/30' : ''}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Racks</CardTitle>
              <Button size="sm" variant="outline" disabled={!selectedZone} onClick={() => openCreate('rack', selectedZoneId)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!selectedZone ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Select a zone to view racks.</div>
              ) : !selectedZone.racks.length ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No racks. Click Add to create one.</div>
              ) : (
                <div className="divide-y">
                  {selectedZone.racks.map(rack => (
                    <div
                      key={rack.id}
                      className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${selectedRackId === rack.id ? 'bg-primary/5 font-medium' : ''}`}
                      onClick={() => handleSelectRack(rack.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm">{rack.name}</span>
                        <Badge variant={rack.isActive ? 'default' : 'secondary'} className="h-5 text-[10px] px-1.5">
                          {rack.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit('rack', rack.id, rack.name, rack.isActive)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget({ type: 'rack', id: rack.id, name: rack.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shelves Column */}
          <Card className={!selectedRack ? 'opacity-40' : ''}>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Shelves</CardTitle>
              <Button size="sm" variant="outline" disabled={!selectedRack} onClick={() => openCreate('shelf', selectedRackId)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!selectedRack ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Select a rack to view shelves.</div>
              ) : !selectedRack.shelves.length ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No shelves. Click Add to create one.</div>
              ) : (
                <div className="divide-y">
                  {selectedRack.shelves.map(shelf => (
                    <div key={shelf.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm">{shelf.name}</span>
                        <Badge variant={shelf.isActive ? 'default' : 'secondary'} className="h-5 text-[10px] px-1.5">
                          {shelf.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit('shelf', shelf.id, shelf.name, shelf.isActive)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget({ type: 'shelf', id: shelf.id, name: shelf.name })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialog.mode !== null} onOpenChange={(v) => { if (!v) setDialog(emptyDialog()) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === 'create' ? 'Create' : 'Edit'} {dialog.type.charAt(0).toUpperCase() + dialog.type.slice(1)}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={dialog.name}
                onChange={e => setDialog(d => ({ ...d, name: e.target.value }))}
                placeholder={`${dialog.type} name`}
                onKeyDown={e => { if (e.key === 'Enter') handleDialogSubmit() }}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="entity-active"
                checked={dialog.isActive}
                onChange={e => setDialog(d => ({ ...d, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="entity-active" className="text-sm">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(emptyDialog())}>Cancel</Button>
            <Button onClick={handleDialogSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              {dialog.mode === 'create' ? 'Create' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.type ? deleteTarget.type.charAt(0).toUpperCase() + deleteTarget.type.slice(1) : ''}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This cannot be undone if no bins are assigned.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate({ type: deleteTarget.type, id: deleteTarget.id })}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
