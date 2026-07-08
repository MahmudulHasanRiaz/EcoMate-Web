import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeftRight, Edit3, FileText, Package, Filter, Building2, Tag, ShieldCheck, DollarSign, Clock } from 'lucide-react'
import { Link } from '@tanstack/react-router'

interface InventoryDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productDetails: any | null
  onAdjust?: () => void
}

export function InventoryDetailDrawer({ open, onOpenChange, productDetails, onAdjust }: InventoryDetailDrawerProps) {
  if (!productDetails) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex justify-between items-start">
            <div>
              <SheetTitle className="text-xl flex items-center gap-2">
                <Package className="h-5 w-5" />
                {productDetails.name}
              </SheetTitle>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                SKU: {productDetails.sku}
                {productDetails.status === 'negative' && <Badge variant="destructive" className="h-5 text-[10px]">Negative Stock</Badge>}
                {productDetails.status === 'low' && <Badge variant="outline" className="border-amber-500 text-amber-600 h-5 text-[10px]">Low Stock</Badge>}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{productDetails.onHand}</div>
              <div className="text-xs text-muted-foreground">On Hand</div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto bg-muted/10">
          <div className="p-6 space-y-6">
            
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { onOpenChange(false); onAdjust?.(); }} size="sm">
                <Edit3 className="mr-2 h-4 w-4" /> Adjust
              </Button>
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/transfers"><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Link>
              </Button>
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/warehouses"><Building2 className="mr-2 h-4 w-4" /> View Warehouse</Link>
              </Button>
              <Button variant="outline" size="sm">
                <Tag className="mr-2 h-4 w-4" /> View Lot
              </Button>
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/detail"><FileText className="mr-2 h-4 w-4" /> Full Detail Page</Link>
              </Button>
            </div>

            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0 h-auto">
                <TabsTrigger value="summary" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Summary & Cost</TabsTrigger>
                <TabsTrigger value="locations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Locations / Lots</TabsTrigger>
                <TabsTrigger value="ledger" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Ledger & Audit</TabsTrigger>
                <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Pending (Res / Alloc)</TabsTrigger>
              </TabsList>
              
              {/* Summary & Cost */}
              <TabsContent value="summary" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Available</div>
                    <div className="text-xl font-bold mt-1">{productDetails.available}</div>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Reserved</div>
                    <div className="text-xl font-bold mt-1 text-orange-600">{productDetails.reserved}</div>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Allocated</div>
                    <div className="text-xl font-bold mt-1 text-blue-600">{productDetails.allocated}</div>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Total On Hand</div>
                    <div className="text-xl font-bold mt-1">{productDetails.onHand}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4" /> Cost Information</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Unit Cost (Avg)</span>
                      <span className="font-medium">৳150.00</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Inventory Value</span>
                      <span className="font-medium">৳{(productDetails.onHand * 150).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Health & Rules</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Minimum Stock Level</span>
                      <span className="font-medium">20</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Health Status</span>
                      <span className="font-medium text-amber-600">Low Stock</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Locations / Lots */}
              <TabsContent value="locations" className="space-y-4 pt-4">
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Lot/Batch</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Main Warehouse</TableCell>
                        <TableCell><Badge variant="outline">L-2023-11</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">—</TableCell>
                        <TableCell className="text-right">{productDetails.onHand}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              {/* Ledger & Audit */}
              <TabsContent value="ledger" className="space-y-4 pt-4">
                <div className="flex flex-wrap items-center gap-2 mb-2 pb-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2 shrink-0">
                    <Filter className="h-4 w-4" />
                  </div>
                  <Select defaultValue="all_types">
                    <SelectTrigger className="h-8 w-[120px] shrink-0 text-xs bg-background"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_types">All Types</SelectItem>
                      <SelectItem value="receipt">GRN / Receipts</SelectItem>
                      <SelectItem value="transfer">Transfers</SelectItem>
                      <SelectItem value="adjustment">Adjustments</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select defaultValue="all_wh">
                    <SelectTrigger className="h-8 w-[120px] shrink-0 text-xs bg-background"><SelectValue placeholder="Warehouse" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_wh">All Warehouses</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input placeholder="Reference..." className="h-8 w-[120px] shrink-0 text-xs bg-background" />
                </div>
                
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & Ref</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <div className="text-xs font-medium">Today, 10:00 AM</div>
                          <div className="text-[10px] text-blue-600 hover:underline cursor-pointer">GRN-2026-104</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">Main Warehouse</div>
                          <div className="text-[10px] text-muted-foreground">Lot: L-2023-11</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">Purchase Receipt</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">Admin</TableCell>
                        <TableCell className="text-right text-green-600 font-medium">+{productDetails.onHand}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                
                <div className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                  <Clock className="h-3 w-3" /> Last audited: Yesterday, 4:00 PM
                </div>
              </TabsContent>

              {/* Pending Operations */}
              <TabsContent value="pending" className="space-y-4 pt-4">
                <div className="rounded-md border bg-card p-8 text-center">
                  <p className="text-sm text-muted-foreground">No pending reservations or allocations for this item.</p>
                </div>
              </TabsContent>

            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
