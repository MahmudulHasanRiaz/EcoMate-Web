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
import { Building2, Package, MapPin, ArrowLeftRight, Settings, ExternalLink, Loader2, X, Plus, Pencil, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface BinLocation {
  id: string
  warehouseId: string
  code: string
  zone: string | null
  rack: string | null
  shelf: string | null
  isActive: boolean
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
  const [code, setCode] = useState(editBin?.code || '')
  const [zone, setZone] = useState(editBin?.zone || '')
  const [rack, setRack] = useState(editBin?.rack || '')
  const [shelf, setShelf] = useState(editBin?.shelf || '')
  const [pending, setPending] = useState(false)

  const isEdit = !!editBin

  async function handleSubmit() {
    if (!code.trim()) { toast.error('Bin code is required'); return }
    setPending(true)
    try {
      if (isEdit) {
        await apiClient.put(`/warehouses/${warehouseId}/bin-locations/${editBin.id}`, { code: code.trim(), zone: zone.trim() || undefined, rack: rack.trim() || undefined, shelf: shelf.trim() || undefined })
        toast.success('Bin updated')
      } else {
        await apiClient.post(`/warehouses/${warehouseId}/bin-locations`, { code: code.trim(), zone: zone.trim() || undefined, rack: rack.trim() || undefined, shelf: shelf.trim() || undefined })
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
            <Input value={zone} onChange={e => setZone(e.target.value)} placeholder='e.g. Dry Goods' />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1.5'>
              <Label>Rack</Label>
              <Input value={rack} onChange={e => setRack(e.target.value)} placeholder='e.g. R-01' />
            </div>
            <div className='space-y-1.5'>
              <Label>Shelf</Label>
              <Input value={shelf} onChange={e => setShelf(e.target.value)} placeholder='e.g. S-01' />
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

  if (!warehouse) return null

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['warehouse-activity', warehouse.id],
    queryFn: () => apiClient.get('/inventory/logs', { params: { warehouseId: warehouse.id } }).then(r => r.data),
    enabled: open,
  })

  const { data: binLocations, isLoading: binsLoading } = useQuery<BinLocation[]>({
    queryKey: ['warehouse-bins', warehouse.id],
    queryFn: () => apiClient.get(`/warehouses/${warehouse.id}/bin-locations`).then(r => r.data),
    enabled: open,
  })

  const deleteBinMut = useMutation({
    mutationFn: (binId: string) => apiClient.delete(`/warehouses/${warehouse.id}/bin-locations/${binId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-bins', warehouse.id] })
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
      toast.success('Bin deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Delete failed'),
  })

  function refreshBins() {
    queryClient.invalidateQueries({ queryKey: ['warehouse-bins', warehouse.id] })
    queryClient.invalidateQueries({ queryKey: ['warehouses'] })
  }

  const bins = binLocations || []

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
            <Button variant="outline" size="icon" title="Warehouse Settings">
              <Settings className="h-4 w-4" />
            </Button>
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Total Items</div>
                <div className="text-xl font-bold mt-1">—</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Total Value</div>
                <div className="text-xl font-bold mt-1">—</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Bin Locations</div>
                <div className="text-xl font-bold mt-1">{warehouse._count?.binLocations || 0}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Pending Receipts</div>
                <div className="text-xl font-bold mt-1 text-blue-600">—</div>
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
                  <h4 className="text-sm font-medium">Active Bins ({bins.length})</h4>
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
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {binsLoading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6">
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
                            <TableCell className="text-xs">{bin.zone || '-'}</TableCell>
                            <TableCell className="text-xs">{bin.rack || '-'}</TableCell>
                            <TableCell className="text-xs">{bin.shelf || '-'}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"
                                  onClick={() => { setEditBin(bin); setBinDialogOpen(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" title="Delete"
                                  onClick={() => { if (confirm('Delete this bin?')) deleteBinMut.mutate(bin.id) }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
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
                        {activityData?.length ? (
                          activityData.map((log: any, i: number) => (
                            <TableRow key={log.id || i}>
                              <TableCell className="text-xs">{log.createdAt ? new Date(log.createdAt).toLocaleString() : log.date || '-'}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px]">{log.action || log.type || '-'}</Badge></TableCell>
                              <TableCell className="text-xs text-blue-600 cursor-pointer">{log.reference || log.ref || '-'} <ExternalLink className="h-3 w-3 inline" /></TableCell>
                              <TableCell className="text-xs text-muted-foreground">{log.user || log.createdBy || '-'}</TableCell>
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
                      <span>{warehouse.address || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">City</span>
                      <span>{warehouse.city || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Phone</span>
                      <span>{warehouse.phone || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span>{warehouse.email || '-'}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SheetContent>

      <BinFormDialog
        open={binDialogOpen}
        onOpenChange={(v) => { if (!v) setEditBin(null); setBinDialogOpen(v) }}
        warehouseId={warehouse.id}
        editBin={editBin}
        onSaved={refreshBins}
      />
    </Sheet>
  )
}