import { useState, useMemo, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { purchasesApi, type PurchaseResponse, type PurchaseItem, type GrnResponse } from './api'
import { suppliersApi } from '@/features/suppliers/api'
import { productsApi } from '@/features/products/api'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Pencil, Trash2, Package, X, SearchIcon, Receipt, ChevronDown } from 'lucide-react'

const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; className: string }> = {
  draft: { variant: 'outline', label: 'Draft', className: 'text-gray-500 border-gray-300 dark:border-gray-600 bg-gray-100/50 dark:bg-gray-800/50' },
  ordered: { variant: 'default', label: 'Ordered', className: 'text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 bg-blue-100/50 dark:bg-blue-900/30' },
  partially_received: { variant: 'secondary', label: 'Partial', className: 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 bg-amber-100/50 dark:bg-amber-900/30' },
  received: { variant: 'default', label: 'Received', className: 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-900/30' },
  cancelled: { variant: 'destructive', label: 'Cancelled', className: 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-900/30' },
}

function getStatusConfig(status: string) {
  return statusConfig[status] || { variant: 'outline' as const, label: status, className: '' }
}

function fmt(v: number | string) {
  return Number(v).toFixed(2)
}

function EmptyState() {
  return (
    <div className='flex flex-col items-center justify-center py-16 px-4'>
      <div className='h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4'>
        <Package className='h-8 w-8 text-muted-foreground' />
      </div>
      <h3 className='text-lg font-semibold mb-1'>No purchase orders</h3>
      <p className='text-sm text-muted-foreground text-center max-w-sm'>
        No purchase orders yet. Create your first purchase order to get started.
      </p>
    </div>
  )
}

function PurchaseForm({
  editing,
  form,
  setForm,
  suppliers,
  products,
}: {
  editing: PurchaseResponse | null
  form: {
    supplierId: string
    orderDate: string
    notes: string
    referenceNo: string
    items: { productId: string; quantity: string; totalBill: string }[]
  }
  setForm: (f: any) => void
  suppliers: { id: string; name: string; phone?: string | null }[]
  products: { id: string; name: string; images: any; sku?: string | null }[]
}) {
  const supplierOptions = useMemo(() =>
    suppliers.map(s => ({ id: s.id, label: s.name, subLabel: s.phone || undefined })),
    [suppliers],
  )

  const productOptions = useMemo(() =>
    products.map(p => {
      const imgs = Array.isArray(p.images) ? p.images : []
      const imgUrl = imgs[0]?.url || imgs[0] || ''
      return {
        id: p.id,
        label: p.name,
        subLabel: p.sku || undefined,
        icon: imgUrl ? (
          <img src={imgUrl} alt='' className='h-7 w-7 rounded object-cover' />
        ) : undefined,
      }
    }),
    [products],
  )

  const productMap = useMemo(() => {
    const m = new Map(products.map(p => [p.id, p]))
    return m
  }, [products])

  const addItem = () => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: [...prev.items, { productId: '', quantity: '1', totalBill: '0' }],
    }))
  }

  const removeItem = (idx: number) => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }))
  }

  const updateItem = (idx: number, field: string, value: string) => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    }))
  }

  return (
    <div className='space-y-5'>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <div className='space-y-1.5'>
          <Label>Supplier <span className='text-destructive'>*</span></Label>
          <SearchableSelect
            options={supplierOptions}
            value={form.supplierId}
            onChange={v => setForm((prev: typeof form) => ({ ...prev, supplierId: v }))}
            placeholder='Search & select supplier...'
            searchPlaceholder='Type supplier name...'
            emptyMessage='No suppliers found'
            triggerClassName='h-9'
          />
        </div>
        <div className='space-y-1.5'>
          <Label>Order Date</Label>
          <Input
            type='date'
            value={form.orderDate}
            onChange={e => setForm((prev: typeof form) => ({ ...prev, orderDate: e.target.value }))}
            className='h-9'
          />
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label>Vendor Invoice Ref <span className='text-xs text-muted-foreground'>(optional — আপনার সরবরাহকারীর দেয়া ইনভয়েস নম্বর)</span></Label>
        <Input
          value={form.referenceNo}
          onChange={e => setForm((prev: typeof form) => ({ ...prev, referenceNo: e.target.value }))}
          placeholder='e.g. INV-2024-001'
          className='h-9'
        />
        <p className='text-xs text-muted-foreground'>System PO number (PO-YYMMDD-XXXX) auto-generated on save.</p>
        </div>

      <div className='space-y-1.5'>
        <div className='flex items-center justify-between'>
          <Label>Items <span className='text-destructive'>*</span></Label>
          {form.items.length > 0 && (
            <span className='text-xs text-muted-foreground'>
              Total: ৳{form.items.reduce((s, i) => s + (Number(i.totalBill) || 0), 0).toFixed(2)}
            </span>
          )}
        </div>
        <div className='space-y-3'>
          {form.items.map((item, idx) => {
            const prod = productMap.get(item.productId)
            const imgs = prod?.images ? (Array.isArray(prod.images) ? prod.images : []) : []
            const imgUrl = imgs[0]?.url || imgs[0] || ''
            const qty = Number(item.quantity) || 0
            const bill = Number(item.totalBill) || 0
            const unitCost = qty > 0 ? bill / qty : 0

            return (
              <div key={idx} className='rounded-lg border p-3 space-y-3 bg-muted/20'>
                <div className='flex items-start gap-3'>
                  <div className='h-14 w-14 rounded-md bg-muted flex-shrink-0 overflow-hidden border'>
                    {imgUrl ? (
                      <img src={imgUrl} alt='' className='h-full w-full object-cover' />
                    ) : (
                      <div className='h-full w-full flex items-center justify-center text-muted-foreground'>
                        <Package className='h-5 w-5' />
                      </div>
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <SearchableSelect
                      options={productOptions}
                      value={item.productId}
                      onChange={v => updateItem(idx, 'productId', v)}
                      placeholder='Search & select product...'
                      searchPlaceholder='Type product name or SKU...'
                      emptyMessage='No products found'
                      triggerClassName='h-9 text-sm'
                      className='w-[320px]'
                    />
                  </div>
                  <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0 mt-0.5' onClick={() => removeItem(idx)}>
                    <X className='h-4 w-4' />
                  </Button>
                </div>
                <div className='grid grid-cols-3 gap-3'>
                  <div className='space-y-1'>
                    <Label className='text-xs'>Quantity</Label>
                    <Input
                      type='number'
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className='h-8 text-sm'
                      min={1}
                    />
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-xs'>Total Bill (৳)</Label>
                    <Input
                      type='number'
                      value={item.totalBill}
                      onChange={e => updateItem(idx, 'totalBill', e.target.value)}
                      className='h-8 text-sm'
                      min={0}
                      step='0.01'
                    />
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-xs'>Unit Cost</Label>
                    <div className='h-8 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-medium'>
                      {unitCost > 0 ? `৳${unitCost.toFixed(2)}` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <Button variant='outline' size='sm' onClick={addItem} className='w-full'>
            <Plus className='h-3.5 w-3.5 mr-1' /> Add Item
          </Button>
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label>Notes <span className='text-xs text-muted-foreground'>(optional)</span></Label>
        <Textarea
          value={form.notes}
          onChange={e => setForm((prev: typeof form) => ({ ...prev, notes: e.target.value }))}
          placeholder='Additional notes...'
          rows={2}
        />
      </div>
    </div>
  )
}

function ReceiveGrnDialog({
  open,
  onOpenChange,
  purchase,
  onReceive,
  products = [],
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  purchase: PurchaseResponse | null
  onReceive: (items: { purchaseItemId: string; productId: string; receivedQty: number; acceptedQty: number; rejectedQty: number }[], notes?: string, warehouseId?: string) => void
  products?: any[]
}) {
  const [received, setReceived] = useState<Record<string, { receivedQty: string; acceptedQty: string; rejectedQty: string }>>({})
  const [notes, setNotes] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
    enabled: open,
  })

  const productMap = useMemo(() => {
    return new Map(products.map(p => [p.id, p]))
  }, [products])

  if (!purchase) return null

  const handleReceive = () => {
    if (!selectedWarehouse) {
      toast.error('Select a destination warehouse')
      return
    }
    const items = Object.entries(received)
      .filter(([, v]) => v.receivedQty && Number(v.receivedQty) > 0)
      .map(([itemId, v]) => {
        const item = purchase.items.find((i: PurchaseItem) => i.id === itemId)
        return {
          purchaseItemId: itemId,
          productId: item?.productId || '',
          receivedQty: Number(v.receivedQty || 0),
          acceptedQty: Number(v.acceptedQty || v.receivedQty || 0),
          rejectedQty: Number(v.rejectedQty || 0),
        }
      })
    if (items.length === 0) {
      toast.error('Enter at least one item quantity')
      return
    }
    onReceive(items, notes || undefined, selectedWarehouse)
  }

  const initItem = (itemId: string) => {
    if (!received[itemId]) {
      setReceived(prev => ({
        ...prev,
        [itemId]: { receivedQty: '', acceptedQty: '', rejectedQty: '0' },
      }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Receive Items — {purchase.referenceNo}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-2'>
          <div className='space-y-2'>
            <Label>Destination Warehouse *</Label>
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger>
                <SelectValue placeholder='Select warehouse to receive into' />
              </SelectTrigger>
              <SelectContent>
                {(warehouses || []).filter((w: any) => w.isActive).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className='text-xs text-muted-foreground'>
            প্রতিটি আইটেমের জন্য কতটা রিসিভ করছেন তা দিন। Accepted = ভালো কন্ডিশনে পাওয়া, Rejected = খারাপ/ড্যামেজড।
          </p>
          {purchase.items.map((item: PurchaseItem) => {
            const r = received[item.id] || { receivedQty: '', acceptedQty: '', rejectedQty: '0' }
            const cost = purchase.costingLots?.[0]?.unitCost
              ? Number(purchase.costingLots[0].unitCost)
              : (item.totalBill && item.quantity ? Number(item.totalBill) / item.quantity : 0)
            
            const product = productMap.get(item.productId) || item.product
            const imgUrl = product?.images?.[0]?.url || product?.images?.[0] || ''
            const sku = product?.sku || item.product?.sku || ''
            return (
              <div key={item.id} className='rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 bg-muted/10'>
                <div className='flex items-center gap-3 w-full sm:w-2/5 sm:flex-shrink-0'>
                  <div className='w-12 h-12 rounded-md bg-muted overflow-hidden flex-shrink-0 border'>
                    {imgUrl ? (
                      <img src={imgUrl} alt='' className='w-full h-full object-cover' />
                    ) : (
                      <div className='h-full w-full flex items-center justify-center text-muted-foreground'>
                        <Package className='h-5 w-5' />
                      </div>
                    )}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium truncate' title={product?.name}>{product?.name || item.productId.slice(0, 8)}</p>
                    <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-xs text-muted-foreground'>
                      <span className='font-medium text-foreground'>Ordered: {item.quantity}</span>
                      {sku && (
                        <>
                          <span>•</span>
                          <span>SKU: {sku}</span>
                        </>
                      )}
                      <span>•</span>
                      <span>৳{fmt(item.unitPrice)}/unit</span>
                      <span className='hidden sm:inline'>•</span>
                      <span className='hidden sm:inline'>Total: ৳{fmt(item.totalBill || item.totalPrice)}</span>
                    </div>
                    {item.variant && <p className='text-xs text-muted-foreground truncate'>{item.variant.attributeValues?.map(av => av.attributeValue.value).join(' / ')}</p>}
                    {cost > 0 && <p className='text-xs text-green-600 truncate'>Expected cost: ৳{cost.toFixed(2)}</p>}
                  </div>
                </div>

                <div className='w-full sm:flex-1 grid grid-cols-3 gap-3'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Received</Label>
                    <Input
                      type='number'
                      value={r.receivedQty}
                      onChange={e => {
                        const val = e.target.value
                        setReceived(prev => ({
                          ...prev,
                          [item.id]: { ...prev[item.id] || { acceptedQty: '', rejectedQty: '0' }, receivedQty: val },
                        }))
                      }}
                      onFocus={() => initItem(item.id)}
                      className='h-9 text-sm'
                      min={0}
                      max={item.quantity}
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Accepted</Label>
                    <Input
                      type='number'
                      value={r.acceptedQty}
                      onChange={e => {
                        const val = e.target.value
                        setReceived(prev => ({
                          ...prev,
                          [item.id]: { ...prev[item.id] || { receivedQty: '', rejectedQty: '0' }, acceptedQty: val },
                        }))
                      }}
                      onFocus={() => initItem(item.id)}
                      className='h-9 text-sm'
                      min={0}
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Rejected</Label>
                    <Input
                      type='number'
                      value={r.rejectedQty}
                      onChange={e => {
                        const val = e.target.value
                        setReceived(prev => ({
                          ...prev,
                          [item.id]: { ...prev[item.id] || { receivedQty: '', acceptedQty: '' }, rejectedQty: val },
                        }))
                      }}
                      onFocus={() => initItem(item.id)}
                      className='h-9 text-sm'
                      min={0}
                    />
                  </div>
                </div>
              </div>
            )
          })}
          <div className='space-y-1'>
            <Label className='text-xs'>GRN Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder='Optional notes for this GRN...'
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleReceive}>
            <Package className='h-4 w-4 mr-1' /> Create GRN & Receive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GrnViewDialog({
  open,
  onOpenChange,
  purchase,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  purchase: PurchaseResponse | null
}) {
  const { data: grns } = useQuery({
    queryKey: ['purchase-grns', purchase?.id],
    queryFn: () => purchasesApi.getGrns(purchase!.id).then(r => r.data),
    enabled: !!purchase,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>GRNs — {purchase?.referenceNo}</DialogTitle>
        </DialogHeader>
        {grns?.length === 0 ? (
          <div className='text-center py-8 text-muted-foreground'>No GRNs yet</div>
        ) : (
          <div className='space-y-3 max-h-[60vh] overflow-y-auto'>
            {grns?.map((grn: GrnResponse) => (
              <div key={grn.id} className='rounded-lg border p-3'>
                <div className='flex items-center justify-between mb-2'>
                  <span className='font-mono text-sm font-semibold'>{grn.grnNumber}</span>
                  <Badge variant='outline' className='text-xs'>{grn.status}</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='text-xs'>Product</TableHead>
                      <TableHead className='text-xs text-right'>Received</TableHead>
                      <TableHead className='text-xs text-right'>Accepted</TableHead>
                      <TableHead className='text-xs text-right'>Rejected</TableHead>
                      <TableHead className='text-xs text-right'>Unit Cost</TableHead>
                      <TableHead className='text-xs text-right'>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grn.items.map((gitem: any) => (
                      <TableRow key={gitem.id}>
                        <TableCell className='text-xs'>{gitem.purchaseItem?.product?.name || gitem.productId.slice(0, 8)}</TableCell>
                        <TableCell className='text-xs text-right'>{gitem.receivedQty}</TableCell>
                        <TableCell className='text-xs text-right'>{gitem.acceptedQty}</TableCell>
                        <TableCell className='text-xs text-right'>{gitem.rejectedQty}</TableCell>
                        <TableCell className='text-xs text-right'>৳{fmt(gitem.unitCost)}</TableCell>
                        <TableCell className='text-xs text-right'>৳{fmt(gitem.totalCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function Purchases() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PurchaseResponse | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [receiveDialog, setReceiveDialog] = useState<PurchaseResponse | null>(null)
  const [grnViewDialog, setGrnViewDialog] = useState<PurchaseResponse | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const emptyForm = {
    referenceNo: '',
    supplierId: '',
    orderDate: new Date().toISOString().slice(0, 10),
    notes: '',
    items: [{ productId: '', quantity: '1', totalBill: '0' }],
  }
  const [form, setForm] = useState(emptyForm)

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => suppliersApi.list().then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []),
  })
  const allSuppliers = Array.isArray(suppliers) ? suppliers : []

  const { data: productsData } = useQuery({
    queryKey: ['products-list'],
    queryFn: () => productsApi.list({ perPage: 200 }).then(r => r.data.data),
  })
  const allProducts = Array.isArray(productsData) ? productsData : []

  const productMap = useMemo(() => {
    return new Map(allProducts.map(p => [p.id, p]))
  }, [allProducts])

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', page, search],
    queryFn: () =>
      purchasesApi
        .list({ page, perPage, search: search || undefined })
        .then(r => r.data),
  })

  const list: PurchaseResponse[] = data?.data || []
  const totalPages = data?.meta?.totalPages || 1

  const createMut = useMutation({
    mutationFn: (d: any) => purchasesApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      setOpen(false)
      setForm(emptyForm)
      toast.success('Purchase order created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating purchase'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => purchasesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm)
      toast.success('Purchase order updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating purchase'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => purchasesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      setDeleteConfirm(null)
      toast.success('Purchase order deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting purchase'),
  })

  const receiveMut = useMutation({
    mutationFn: ({ id, items, notes, warehouseId }: { id: string; items: any[]; notes?: string; warehouseId: string }) =>
      purchasesApi.createGrn(id, { warehouseId, items, notes }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-grns', variables.id] })
      setReceiveDialog(null)
      toast.success('Items received via GRN')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error receiving items'),
  })

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setOpen(true)
  }

  const openEdit = (p: PurchaseResponse) => {
    setEditing(p)
    setForm({
      referenceNo: p.referenceNo,
      supplierId: p.supplierId,
      orderDate: p.orderDate.slice(0, 10),
      notes: p.notes || '',
      items: p.items.map(i => ({
        productId: i.productId,
        quantity: String(i.quantity),
        totalBill: String(i.totalBill || i.totalPrice || 0),
      })),
    })
    setOpen(true)
  }

  const handleSave = () => {
    if (!form.supplierId.trim()) {
      toast.error('Please select a supplier')
      return
    }
    const items = form.items
      .filter(i => i.productId.trim())
      .map(i => ({
        productId: i.productId.trim(),
        quantity: Number(i.quantity) || 1,
        totalBill: Number(i.totalBill) || 0,
      }))
    if (items.length === 0) {
      toast.error('At least one item is required')
      return
    }
    const payload: any = {
      supplierId: form.supplierId.trim(),
      orderDate: form.orderDate || undefined,
      notes: form.notes.trim() || undefined,
      items,
    }
    if (form.referenceNo.trim()) {
      payload.referenceNo = form.referenceNo.trim()
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

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
              <h2 className='text-2xl font-bold tracking-tight'>Purchase Orders</h2>
            </div>
            <p className='text-muted-foreground text-sm'>
              {data?.meta?.total || 0} purchase orders found
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Purchase
          </Button>
        </div>

        <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10'>
          <CardContent className='p-3'>
            <div className='relative w-[220px]'>
              <SearchIcon className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
              <Input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder='Search purchases...'
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
                  <TableHead className='w-8'></TableHead>
                  <TableHead>Reference No</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Total</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead className='w-28'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : list.length ? (
                  list.map((p: PurchaseResponse) => {
                    const sc = getStatusConfig(p.status)
                    const isExpanded = expandedId === p.id
                    return (
                      <Fragment key={p.id}>
                      <TableRow className={isExpanded ? 'bg-muted/30' : ''}>
                        <TableCell className='w-8'>
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : p.id)}
                            className='p-0.5 hover:bg-muted rounded transition-colors'
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                        </TableCell>
                        <TableCell className='font-mono text-sm font-semibold'>
                          {p.referenceNo}
                        </TableCell>
                        <TableCell>
                          {p.supplier?.name || (
                            <span className='text-muted-foreground text-sm'>Unknown Supplier</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={sc.variant} className={sc.className}>
                            {sc.label}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-right font-semibold'>
                          ৳{fmt(p.total)}
                        </TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {new Date(p.orderDate).toLocaleDateString('en-US', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </TableCell>
                        <TableCell>
                          <div className='flex gap-1'>
                            {(p.status === 'ordered' || p.status === 'partially_received') && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => setReceiveDialog(p)}
                                title='Receive Items'
                              >
                                <Package className='h-3.5 w-3.5' />
                              </Button>
                            )}
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-7 w-7'
                              onClick={() => setGrnViewDialog(p)}
                              title='View GRNs'
                            >
                              <Receipt className='h-3.5 w-3.5' />
                            </Button>
                            {(p.status === 'draft' || p.status === 'ordered') && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => openEdit(p)}
                              >
                                <Pencil className='h-3.5 w-3.5' />
                              </Button>
                            )}
                            {p.status === 'draft' && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => setDeleteConfirm(p.id)}
                              >
                                <Trash2 className='h-3.5 w-3.5 text-destructive' />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className='hover:bg-transparent'>
                          <TableCell colSpan={7} className='p-0 border-b'>
                            <div className='bg-muted/20 px-4 py-3 space-y-2'>
                              {p.items.length === 0 ? (
                                <p className='text-sm text-muted-foreground text-center py-4'>No items</p>
                              ) : (
                                p.items.map((item: PurchaseItem, idx: number) => {
                                  const product = productMap.get(item.productId) || item.product
                                  const imgs = product?.images ? (Array.isArray(product.images) ? product.images : []) : []
                                  const imgUrl = imgs[0]?.url || imgs[0] || ''
                                  const variantStr = item.variant?.attributeValues?.map(av => av.attributeValue.value).join(' / ')
                                  const sku = product?.sku || item.product?.sku || ''
                                  return (
                                    <div key={item.id} className='flex items-center gap-3 rounded-lg border bg-background p-2.5'>
                                      <div className='flex items-center justify-center w-6 text-xs text-muted-foreground font-medium'>
                                        {idx + 1}
                                      </div>
                                      <div className='h-11 w-11 rounded-md bg-muted overflow-hidden border flex-shrink-0'>
                                        {imgUrl ? (
                                          <img src={imgUrl} alt='' className='h-full w-full object-cover' />
                                        ) : (
                                          <div className='h-full w-full flex items-center justify-center text-muted-foreground'>
                                            <Package className='h-4 w-4' />
                                          </div>
                                        )}
                                      </div>
                                      <div className='flex-1 min-w-0'>
                                        <p className='text-sm font-medium truncate'>{product?.name || item.productId.slice(0, 8)}</p>
                                        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                                          {variantStr && <span>{variantStr}</span>}
                                          {sku && <span>SKU: {sku}</span>}
                                        </div>
                                      </div>
                                      <div className='flex items-center gap-4 text-xs shrink-0'>
                                        <div className='text-right'>
                                          <p className='text-muted-foreground'>Qty</p>
                                          <p className='font-medium'>{item.quantity}</p>
                                        </div>
                                        <div className='text-right'>
                                          <p className='text-muted-foreground'>Unit Price</p>
                                          <p className='font-medium'>৳{fmt(item.unitPrice)}</p>
                                        </div>
                                        <div className='text-right'>
                                          <p className='text-muted-foreground'>Total</p>
                                          <p className='font-medium'>৳{fmt(item.totalBill || item.totalPrice)}</p>
                                        </div>
                                        <div className='text-right'>
                                          <p className='text-muted-foreground'>Received</p>
                                          <p className='font-medium'>{item.receivedQty || 0}</p>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className='p-0'>
                      <EmptyState />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className='flex items-center justify-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className='text-sm text-muted-foreground'>
              Page {page} of {totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </Main>

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent className='max-w-3xl'>
          <DialogHeader>
            <DialogTitle className='text-lg'>{editing ? 'Edit Purchase Order' : 'New Purchase Order'}</DialogTitle>
            <p className='text-xs text-muted-foreground'>
              সাপ্লায়ার সিলেক্ট করুন, প্রোডাক্ট ও কোয়ান্টিটি দিন, মোট বিল দিন। সিস্টেম অটো কস্টিং প্রাইস ক্যালকুলেট করবে।
            </p>
          </DialogHeader>
          <div className='max-h-[65vh] overflow-y-auto pr-1'>
            <PurchaseForm
              editing={editing}
              form={form}
              setForm={setForm}
              suppliers={allSuppliers}
              products={allProducts}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {(createMut.isPending || updateMut.isPending) && (
                <Loader2 className='animate-spin h-4 w-4 mr-1' />
              )}
              {editing ? 'Update' : 'Create Purchase Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Purchase Order</DialogTitle></DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete this purchase order? This action cannot be undone.
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

      <ReceiveGrnDialog
        open={!!receiveDialog}
        onOpenChange={v => { if (!v) setReceiveDialog(null) }}
        purchase={receiveDialog}
        products={allProducts}
        onReceive={(items, notes, warehouseId) => {
          if (receiveDialog && warehouseId) {
            receiveMut.mutate({ id: receiveDialog.id, items, notes, warehouseId })
          }
        }}
      />

      <GrnViewDialog
        open={!!grnViewDialog}
        onOpenChange={v => { if (!v) setGrnViewDialog(null) }}
        purchase={grnViewDialog}
      />
    </>
  )
}
