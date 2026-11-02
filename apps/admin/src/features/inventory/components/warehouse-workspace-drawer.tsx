import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Building2, Package, MapPin, ArrowLeftRight, ExternalLink, Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import { UserBadge } from '@/components/user-badge'
import { Link } from '@tanstack/react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface BinLocation {
  id: string
  warehouseId: string
  code: string
  zoneId: string | null
  rackId: string | null
  shelfId: string | null
  zone?: { id: string; name: string } | null
  rack?: { id: string; name: string } | null
  shelf?: { id: string; name: string } | null
  isActive: boolean
}

interface HierarchyShelf {
  id: string
  name: string
}

interface HierarchyRack {
  id: string
  name: string
  shelves: HierarchyShelf[]
}

interface HierarchyZone {
  id: string
  name: string
  racks: HierarchyRack[]
}

interface WarehouseWorkspaceDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouse: any | null
}

function BinFormDialog({
  open, onOpenChange, warehouseId, editBin, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  warehouseId: string
  editBin?: BinLocation | null
  onSaved: () => void
}) {
  // The parent renders this dialog with key={editBin?.id ?? 'new'}, so the
  // form state below always initializes from the bin actually being edited.
  const [code, setCode] = useState(editBin?.code || '')
  const [zoneId, setZoneId] = useState(editBin?.zoneId || '')
  const [rackId, setRackId] = useState(editBin?.rackId || '')
  const [shelfId, setShelfId] = useState(editBin?.shelfId || '')
  const [pending, setPending] = useState(false)

  const isEdit = !!editBin

  // Cascading hierarchy: zones of this warehouse → racks of the zone →
  // shelves of the rack (same warehouses API as the Bin Locations page).
  const { data: zones } = useQuery<HierarchyZone[]>({
    queryKey: ['zones', warehouseId],
    queryFn: () => apiClient.get(`/warehouses/${warehouseId}/zones`).then(r => r.data || []),
    enabled: open && !!warehouseId,
  })
  const racks = zones?.find(z => z.id === zoneId)?.racks ?? []
  const shelves = racks.find(r => r.id === rackId)?.shelves ?? []

  async function handleSubmit() {
    if (!code.trim()) { toast.error('Bin code is required'); return }
    setPending(true)
    const payload = {
      code: code.trim(),
      zoneId: zoneId || undefined,
      rackId: rackId || undefined,
      shelfId: shelfId || undefined,
    }
    try {
      if (isEdit) {
        await apiClient.put(`/warehouses/${warehouseId}/bin-locations/${editBin.id}`, payload)
        toast.success('Bin updated')
      } else {
        await apiClient.post(`/warehouses/${warehouseId}/bin-locations`, payload)
        toast.success('Bin created')
      }
      onSaved()
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to save bin')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[420px]'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Bin' : 'Add Bin Location'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-2'>
          <div className='space-y-1.5'>
            <Label>Code *</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder='e.g. A1-01' />
          </div>
          <div className='space-y-1.5'>
            <Label>Zone</Label>
            <Select
              value={zoneId || '__none__'}
              onValueChange={(v) => { setZoneId(v === '__none__' ? '' : v); setRackId(''); setShelfId('') }}
            >
              <SelectTrigger><SelectValue placeholder='Select zone' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='__none__'>None</SelectItem>
                {(zones ?? []).map(z => (
                  <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label>Rack</Label>
              <Select
                value={rackId || '__none__'}
                onValueChange={(v) => { setRackId(v === '__none__' ? '' : v); setShelfId('') }}
                disabled={!zoneId}
              >
                <SelectTrigger><SelectValue placeholder='Select rack' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='__none__'>None</SelectItem>
                  {racks.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label>Shelf</Label>
              <Select
                value={shelfId || '__none__'}
                onValueChange={(v) => setShelfId(v === '__none__' ? '' : v)}
                disabled={!rackId}
              >
                <SelectTrigger><SelectValue placeholder='Select shelf' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='__none__'>None</SelectItem>
                  {shelves.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            {isEdit ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WarehouseWorkspaceDrawer({ open, onOpenChange, warehouse }: WarehouseWorkspaceDrawerProps) {
  const queryClient = useQueryClient()
  const [binDialogOpen, setBinDialogOpen] = useState(false)
  const [editBin, setEditBin] = useState<BinLocation | null>(null)
  const [deleteBinConfirm, setDeleteBinConfirm] = useState<BinLocation | null>(null)

  // These must stay ABOVE the `if (!warehouse) return null` below. The drawer is
  // mounted from a list page, so on a cold open the warehouse may not be
  // resolved yet: the early return ran 4 hooks and the next render ran 8,
  // which React rejects as "Rendered more hooks than during the previous
  // render". Guarded with `open && !!warehouseId` instead.
  const warehouseId = warehouse?.id

  const { data: activityRes, isLoading: activityLoading } = useQuery({
    queryKey: ['warehouse-activity', warehouseId],
    queryFn: () => apiClient.get('/inventory/logs', { params: { warehouseId, perPage: 20 } }).then(r => r.data),
    enabled: open && !!warehouseId,
  })

  const { data: binLocations, isLoading: binsLoading } = useQuery<BinLocation[]>({
    queryKey: ['warehouse-bins', warehouseId],
    queryFn: () => apiClient.get(`/warehouses/${warehouseId}/bin-locations`).then(r => r.data),
    enabled: open && !!warehouseId,
  })

  const { data: warehouseStats, isLoading: statsLoading } = useQuery({
    queryKey: ['warehouse-stats', warehouseId],
    queryFn: () => apiClient.get('/inventory/physical', { params: { warehouseId } }).then(r => r.data),
    enabled: open && !!warehouseId,
  })

  const deleteBinMut = useMutation({
    mutationFn: (bin: BinLocation) => apiClient.delete(`/warehouses/${bin.warehouseId}/bin-locations/${bin.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-bins', warehouseId] })
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      queryClient.invalidateQueries({ queryKey: ['all-bin-locations'] })
      setDeleteBinConfirm(null)
      toast.success('Bin deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Delete failed'),
  })

  // Safe to bail now: every hook above has already run on this render.
  if (!warehouse) return null

  function refreshBins() {
    queryClient.invalidateQueries({ queryKey: ['warehouse-bins', warehouse.id] })
    queryClient.invalidateQueries({ queryKey: ['warehouses'] })
  }

  const bins = binLocations || []
  const activityData = activityRes?.data || []
  const stats = Array.isArray(warehouseStats) ? warehouseStats : []
  const totalItems = stats.length
  const totalValue = stats.reduce((sum: number, pi: any) => {
    const price = pi.product?.basePrice || 0
    return sum + (pi.quantity * Number(price))
  }, 0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex justify-between items-start">
            <div>
              <SheetTitle className="text-xl flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {warehouse.name}
              </SheetTitle>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                <Badge variant="outline" className="capitalize">{warehouse.type}</Badge>
                {warehouse.isActive ? (
                  <Badge variant='default' className='bg-green-500 text-[10px]'>Active</Badge>
                ) : (
                  <Badge variant='secondary' className='text-[10px]'>Inactive</Badge>
                )}
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto bg-muted/10">
          <div className="p-6 space-y-6">

            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory" search={{ filter: 'all', warehouse: warehouse.id }}>
                  <Package className="mr-2 h-4 w-4" /> View Filtered Stock
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/transfers">
                  <ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer Stock
                </Link>
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Total Items</div>
                <div className="text-xl font-bold mt-1">{statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : totalItems}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Inventory Value</div>
                <div className="text-xl font-bold mt-1">{statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : `৳${totalValue.toLocaleString()}`}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Bin Locations</div>
                <div className="text-xl font-bold mt-1">{warehouse._count?.binLocations || bins.length}</div>
              </div>
            </div>

            <Tabs defaultValue="bins" className="w-full">
              <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0 h-auto">
                <TabsTrigger value="bins" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Bin Locations</TabsTrigger>
                <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Recent Activity</TabsTrigger>
                <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Warehouse Details</TabsTrigger>
              </TabsList>

              <TabsContent value="bins" className="space-y-4 pt-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-medium">Bins ({bins.length})</h4>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setEditBin(null); setBinDialogOpen(true) }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Bin
                  </Button>
                </div>
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Rack</TableHead>
                        <TableHead>Shelf</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {binsLoading ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : bins.length > 0 ? (
                        bins.map((bin) => (
                          <TableRow key={bin.id}>
                            <TableCell className="font-medium">
                              <MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />
                              {bin.code}
                            </TableCell>
                            <TableCell className="text-xs">{bin.zone?.name || '-'}</TableCell>
                            <TableCell className="text-xs">{bin.rack?.name || '-'}</TableCell>
                            <TableCell className="text-xs">{bin.shelf?.name || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={bin.isActive ? 'default' : 'secondary'} className="text-[10px]">
                                {bin.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                                  onClick={() => { setEditBin(bin); setBinDialogOpen(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" title="Delete"
                                  onClick={() => setDeleteBinConfirm(bin)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                            <Package className="h-4 w-4 mx-auto mb-1" />
                            No bin locations configured.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="activity" className="space-y-4 pt-4">
                {activityLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="rounded-md border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>User</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activityData.length > 0 ? (
                          activityData.map((log: any) => (
                            <TableRow key={log.id}>
                              <TableCell className="text-xs">
                                {log.performedAt ? new Date(log.performedAt).toLocaleString() : '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">{log.type || '—'}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                {log.reason || log.performedBy || '—'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {log.performedBy && log.performedBy.toLowerCase() !== 'system' ? (
                                  <UserBadge email={log.performedBy} showEmail={false} size="sm" />
                                ) : (
                                  log.performedBy || '—'
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                              No recent activity for this warehouse.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="details" className="space-y-4 pt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Contact & Location</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Address</span>
                      <span>{warehouse.address || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">City</span>
                      <span>{warehouse.city || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Phone</span>
                      <span>{warehouse.phone || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span>{warehouse.email || '—'}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SheetContent>

      <BinFormDialog
        key={editBin?.id ?? 'new'}
        open={binDialogOpen}
        onOpenChange={(v) => { if (!v) setEditBin(null); setBinDialogOpen(v) }}
        warehouseId={warehouse.id}
        editBin={editBin}
        onSaved={refreshBins}
      />

      {/* Bin Delete Confirmation Dialog */}
      <Dialog open={!!deleteBinConfirm} onOpenChange={v => { if (!v) setDeleteBinConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bin Location</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete bin <strong>{deleteBinConfirm?.code}</strong>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteBinConfirm(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => deleteBinConfirm && deleteBinMut.mutate(deleteBinConfirm)}
              disabled={deleteBinMut.isPending}
            >
              {deleteBinMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
