import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeftRight, Edit3, FileText, Package, Filter, Building2, ShieldCheck, DollarSign, Clock, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Link } from '@tanstack/react-router'
import { useInventoryManagement } from '../hooks/use-inventory-management'
import { MOVEMENT_TYPE_LABELS, getMovementTypeBadgeVariant } from '../utils/movement-type-labels'
import { UserBadge } from '@/components/user-badge'

// Managed Stock Ledger entry types (the /inventory/ledger source).
const LEDGER_TYPE_OPTIONS = [
  'INITIAL',
  'ORDER_DEDUCTION',
  'MANUAL_ADD',
  'MANUAL_REMOVE',
  'ADJUSTMENT',
  'RETURN',
  'CANCEL_RELEASE',
  'RESERVE',
  'RELEASE',
]

interface InventoryDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productDetails: any | null
  onAdjust?: () => void
}

export function InventoryDetailDrawer({ open, onOpenChange, productDetails, onAdjust }: InventoryDetailDrawerProps) {
  const { data: imEnabled = true } = useInventoryManagement()
  const [ledgerType, setLedgerType] = useState('all_types')

  const { data: ledgerData, isLoading: ledgerLoading, isError: ledgerError, refetch: refetchLedger } = useQuery({
    queryKey: ['inventory-ledger', productDetails?.id, ledgerType],
    queryFn: () => apiClient.get('/inventory/ledger', {
      params: {
        productId: productDetails.id,
        perPage: 10,
        type: ledgerType !== 'all_types' ? ledgerType : undefined,
      },
    }).then(r => r.data),
    enabled: !!productDetails?.id,
  })

  const { data: physicalData, isLoading: physicalLoading, isError: physicalError, refetch: refetchPhysical } = useQuery({
    queryKey: ['inventory-physical', productDetails?.id],
    queryFn: () => apiClient.get('/inventory/physical', { params: { productId: productDetails.id } }).then(r => r.data),
    enabled: !!productDetails?.id,
  })

  const { data: reservationsData, isLoading: reservationsLoading, isError: reservationsError, refetch: refetchReservations } = useQuery({
    queryKey: ['inventory-reservations', productDetails?.id],
    queryFn: () => apiClient.get('/inventory/physical/reservations', { params: { productId: productDetails.id } }).then(r => r.data),
    enabled: !!productDetails?.id,
  })

  if (!productDetails) return null

  // Callers pass either the drawer's explicit shape
  // (onHand/available/reserved/cost/status) or a raw stock-overview row
  // (managedStockQuantity/availableStock/reservedStock/standardCost ??
  // basePrice, inventoryStatus). Normalize once so every figure below is
  // real for both shapes — previously the overview shape rendered blanks.
  const onHand: number = productDetails.onHand ?? productDetails.managedStockQuantity ?? 0
  const available: number | null = productDetails.available ?? productDetails.availableStock ?? null
  const reserved: number = productDetails.reserved ?? productDetails.reservedStock ?? 0
  const cost: number | null =
    productDetails.cost ?? productDetails.standardCost ?? productDetails.basePrice ?? null
  const status: 'negative' | 'low' | 'optimal' =
    productDetails.status === 'negative' || productDetails.status === 'low'
      ? productDetails.status
      : typeof productDetails.inventoryStatus === 'string' &&
          productDetails.inventoryStatus.toLowerCase().includes('negative')
        ? 'negative'
        : typeof productDetails.inventoryStatus === 'string' &&
            productDetails.inventoryStatus.toLowerCase().includes('low')
          ? 'low'
          : available != null && available < 0
            ? 'negative'
            : available != null &&
                productDetails.lowStockQty != null &&
                available <= productDetails.lowStockQty
              ? 'low'
              : 'optimal'

  const ledgerEntries: any[] = (ledgerData as any)?.data ?? []
  const lastAuditedAt: string | null = ledgerEntries[0]?.performedAt ?? ledgerEntries[0]?.createdAt ?? null
  const reservations: any[] = Array.isArray(reservationsData) ? reservationsData : []

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
                {status === 'negative' && <Badge variant="destructive" className="h-5 text-[10px]">Negative Stock</Badge>}
                {status === 'low' && <Badge variant="outline" className="border-amber-500 text-amber-600 h-5 text-[10px]">Low Stock</Badge>}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{onHand}</div>
              <div className="text-xs text-muted-foreground">On Hand</div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto bg-muted/10">
          <div className="p-6 space-y-6">
            
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-2">
              {productDetails.type !== 'variable' && (
                <Button onClick={() => { onOpenChange(false); onAdjust?.(); }} size="sm">
                  <Edit3 className="mr-2 h-4 w-4" /> Adjust
                </Button>
              )}
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/transfers"><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Link>
              </Button>
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/warehouses"><Building2 className="mr-2 h-4 w-4" /> View Warehouse</Link>
              </Button>
              <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to="/op/inventory/detail" search={{ productId: productDetails.id }}><FileText className="mr-2 h-4 w-4" /> Full Detail Page</Link>
              </Button>
            </div>

            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0 h-auto">
                <TabsTrigger value="summary" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Summary & Cost</TabsTrigger>
                {imEnabled && (
                  <TabsTrigger value="locations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Locations / Lots</TabsTrigger>
                )}
                <TabsTrigger value="ledger" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Ledger & Audit</TabsTrigger>
                {imEnabled && (
                  <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">Pending (Res / Alloc)</TabsTrigger>
                )}
              </TabsList>
              
              {/* Summary & Cost */}
              <TabsContent value="summary" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Available</div>
                    <div className="text-xl font-bold mt-1">{available === null ? '∞' : available}</div>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Reserved</div>
                    <div className="text-xl font-bold mt-1 text-orange-600">{reserved}</div>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs font-medium text-muted-foreground">Total On Hand</div>
                    <div className="text-xl font-bold mt-1">{onHand}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4" /> Cost Information</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Unit Cost (Avg)</span>
                      <span className="font-medium">{cost != null ? `৳${Number(cost).toFixed(2)}` : '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Inventory Value</span>
                      <span className="font-medium">{cost != null ? `৳${(onHand * Number(cost)).toLocaleString()}` : '—'}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Health & Rules</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Low Stock Threshold</span>
                      <span className="font-medium">{productDetails.lowStockQty != null ? productDetails.lowStockQty : '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Health Status</span>
                      <span className={`font-medium ${status === 'negative' ? 'text-red-600' : status === 'low' ? 'text-amber-600' : 'text-green-600'}`}>
                        {status === 'negative' ? 'Negative Stock' : status === 'low' ? 'Low Stock' : 'Optimal'}
                      </span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Locations / Lots */}
              {imEnabled && (
              <TabsContent value="locations" className="space-y-4 pt-4">
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Bin</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Reserved</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {physicalLoading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6">
                            <Loader2 className="animate-spin h-4 w-4 mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : physicalError ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6">
                            <p className="text-sm text-destructive mb-2">Failed to load locations.</p>
                            <Button variant="outline" size="sm" onClick={() => refetchPhysical()}>Retry</Button>
                          </TableCell>
                        </TableRow>
                      ) : Array.isArray(physicalData) && physicalData.length > 0 ? (
                        physicalData.map((pi: any) => {
                          const avail = pi.quantity - pi.reservedQuantity
                          return (
                            <TableRow key={pi.id}>
                              <TableCell className="font-medium">{pi.warehouse?.name || '—'}</TableCell>
                              <TableCell className="text-sm font-mono">{pi.binLocation?.code || '—'}</TableCell>
                              <TableCell className="text-right font-medium">{pi.quantity}</TableCell>
                              <TableCell className="text-right text-orange-600">{pi.reservedQuantity}</TableCell>
                              <TableCell className={`text-right font-medium ${avail < 0 ? 'text-red-600' : ''}`}>{avail}</TableCell>
                            </TableRow>
                          )
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">
                            No physical inventory records found for this product.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
              )}

              {/* Ledger & Audit */}
              <TabsContent value="ledger" className="space-y-4 pt-4">
                <div className="flex flex-wrap items-center gap-2 mb-2 pb-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2 shrink-0">
                    <Filter className="h-4 w-4" />
                  </div>
                  <Select value={ledgerType} onValueChange={setLedgerType}>
                    <SelectTrigger className="h-8 w-[160px] shrink-0 text-xs bg-background"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_types">All Types</SelectItem>
                      {LEDGER_TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>{MOVEMENT_TYPE_LABELS[t] ?? t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="rounded-md border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & Ref</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerLoading ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8">
                            <Loader2 className="animate-spin h-5 w-5 mx-auto" />
                          </TableCell>
                        </TableRow>
                      ) : ledgerError ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8">
                            <p className="text-sm text-destructive mb-2">Failed to load ledger entries.</p>
                            <Button variant="outline" size="sm" onClick={() => refetchLedger()}>Retry</Button>
                          </TableCell>
                        </TableRow>
                      ) : ledgerEntries.length ? (
                        ledgerEntries.map((entry: any) => {
                          // Managed ledger quantities are ABSOLUTE — the sign
                          // lives in `direction` (IN/OUT). Signing by the raw
                          // quantity rendered every entry green/'+'.
                          const isIn = entry.direction
                            ? entry.direction === 'IN'
                            : entry.quantity > 0
                          const performer = entry.performedBy ?? entry.user ?? null
                          return (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <div className="text-xs font-medium">
                                  {(entry.performedAt || entry.createdAt) ? new Date(entry.performedAt || entry.createdAt).toLocaleString() : '—'}
                                </div>
                                <div className="text-[10px] text-blue-600 hover:underline cursor-pointer">{entry.reference || entry.referenceId || '—'}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={getMovementTypeBadgeVariant(entry.type ?? '')} className="text-[10px]">
                                  {MOVEMENT_TYPE_LABELS[entry.type] ?? entry.type ?? '—'}
                                </Badge>
                                {entry.note && <div className="text-[10px] text-muted-foreground mt-1">{entry.note}</div>}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {performer && String(performer).toLowerCase() !== 'system' ? (
                                  <UserBadge email={performer} showEmail={false} size="sm" />
                                ) : (
                                  <Badge variant="secondary" className="text-[10px] h-4">System</Badge>
                                )}
                              </TableCell>
                              <TableCell className={`text-right font-medium ${isIn ? 'text-green-600' : 'text-red-600'}`}>
                                {isIn ? '+' : '−'}{Math.abs(entry.quantity)}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                            No ledger entries found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                
                {lastAuditedAt && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                    <Clock className="h-3 w-3" /> Last audited: {new Date(lastAuditedAt).toLocaleString()}
                  </div>
                )}
              </TabsContent>

              {/* Pending Operations */}
              {imEnabled && (
              <TabsContent value="pending" className="space-y-4 pt-4">
                {reservationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-5 w-5" />
                  </div>
                ) : reservationsError ? (
                  <div className="rounded-md border bg-card p-8 text-center">
                    <p className="text-sm text-destructive mb-2">Failed to load reservations.</p>
                    <Button variant="outline" size="sm" onClick={() => refetchReservations()}>Retry</Button>
                  </div>
                ) : reservations.length > 0 ? (
                  <div className="rounded-md border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Warehouse</TableHead>
                          <TableHead className="text-right">Reserved Qty</TableHead>
                          <TableHead className="text-right">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reservations.map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium text-sm">
                              {r.warehouse?.name || '—'}
                              {r.isManaged && (
                                <Badge variant="secondary" className="ml-2 text-[10px]">Managed</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium text-orange-600">{r.reservedQuantity}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {r.updatedAt
                                ? new Date(r.updatedAt).toLocaleString()
                                : r.createdAt
                                  ? new Date(r.createdAt).toLocaleString()
                                  : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-md border bg-card p-8 text-center">
                    <p className="text-sm text-muted-foreground">No pending reservations or allocations for this item.</p>
                  </div>
                )}
              </TabsContent>
              )}

            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
