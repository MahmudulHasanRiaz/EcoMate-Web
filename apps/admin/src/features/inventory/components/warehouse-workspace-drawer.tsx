import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Building2, Package, MapPin, Truck, ArrowLeftRight, Settings, ExternalLink, Loader2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface WarehouseWorkspaceDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouse: any | null
}

export function WarehouseWorkspaceDrawer({ open, onOpenChange, warehouse }: WarehouseWorkspaceDrawerProps) {
  if (!warehouse) return null

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['warehouse-activity', warehouse.id],
    queryFn: () => apiClient.get('/inventory/logs', { params: { warehouseId: warehouse.id } }).then(r => r.data),
    enabled: open,
  })

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
                {/* TODO: Replace with GET /api/warehouses/:id/stats */}
                <div className="text-xl font-bold mt-1">1,245</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Total Value</div>
                {/* TODO: Replace with GET /api/warehouses/:id/stats */}
                <div className="text-xl font-bold mt-1">৳450k</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Bin Locations</div>
                <div className="text-xl font-bold mt-1">{warehouse._count?.binLocations || 0}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">Pending Receipts</div>
                {/* TODO: Replace with GET /api/purchase-orders?warehouseId=...&status=pending */}
                <div className="text-xl font-bold mt-1 text-blue-600">3</div>
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
                  <h4 className="text-sm font-medium">Active Bins</h4>
                  <Button variant="ghost" size="sm" className="text-xs h-7">Manage Bins</Button>
                </div>
                {/* TODO: Replace hardcoded data with GET /api/warehouses/:id/bin-locations */}
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bin Code</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead className="text-right">Items Stored</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {warehouse._count?.binLocations ? (
                        <>
                          <TableRow>
                            <TableCell className="font-medium"><MapPin className="h-3 w-3 inline mr-1 text-muted-foreground"/> A1-01</TableCell>
                            <TableCell>Dry Goods</TableCell>
                            <TableCell className="text-right">145</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium"><MapPin className="h-3 w-3 inline mr-1 text-muted-foreground"/> B2-12</TableCell>
                            <TableCell>Cold Storage</TableCell>
                            <TableCell className="text-right">32</TableCell>
                          </TableRow>
                        </>
                      ) : (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
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
    </Sheet>
  )
}
