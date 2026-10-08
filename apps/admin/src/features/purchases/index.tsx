import { useState, useMemo, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { purchasesApi, type PurchaseResponse, type PurchaseItem, type GrnResponse } from './api'
import { suppliersApi } from '@/features/suppliers/api'
import { productsApi } from '@/features/products/api'
import { ProductSkuCombobox, type LookupRow } from '@/features/inventory/components/product-sku-combobox'
import { dhakaTodayString } from '@/lib/dhaka-time'
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
import { Loader2, Plus, Pencil, Trash2, Package, X, SearchIcon, Receipt, ChevronDown, Eye, Ban, Scissors } from 'lucide-react'

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
}: {
  editing: PurchaseResponse | null
  form: {
    supplierId: string
    orderDate: string
    notes: string
    referenceNo: string
    items: { productId: string; variantId: string | null; quantity: string; totalBill: string; sel: LookupRow | null; lookedUp: boolean }[]
  }
  setForm: (f: any) => void
  suppliers: { id: string; name: string; phone?: string | null }[]
}) {
  const supplierOptions = useMemo(() =>
    suppliers.map(s => ({ id: s.id, label: s.name, subLabel: s.phone || undefined })),
    [suppliers],
  )

  const addItem = () => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: [...prev.items, { productId: '', variantId: null, quantity: '1', totalBill: '0', sel: null, lookedUp: false }],
    }))
  }

  const removeItem = (idx: number) => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }))
  }

  const updateItem = (idx: number, field: string, value: any) => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i !== idx) return item
        // Variant-level pick from the SKU combobox (server rows + scanner):
        // a variable product only ever arrives as its variants.
        if (field === '__sel') {
          const row = value as LookupRow | null
          return {
            ...item,
            productId: row?.productId || '',
            variantId: row?.variantId || null,
            sel: row,
            lookedUp: row != null,
          }
        }
        return { ...item, [field]: value }
      }),
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
            const qty = Number(item.quantity) || 0
            const bill = Number(item.totalBill) || 0
            const unitCost = qty > 0 ? bill / qty : 0

            return (
              <div key={idx} className='rounded-lg border p-3 space-y-3 bg-muted/20'>
                <div className='flex items-start gap-3'>
                  <div className='flex-1 min-w-0'>
                    <ProductSkuCombobox
                      selected={item.sel}
                      onSelect={row => updateItem(idx, '__sel', row as any)}
                      label={idx === 0 ? 'Product / Variant' : undefined}
                      placeholder='Search, scan, or pick a variant...'
                      hideAvailability={item.sel != null && !item.lookedUp}
                    />
                    {item.sel?.variantName == null && item.productId !== '' && (
                      <p className='text-[11px] text-amber-600 mt-1'>Simple product — quantity below applies to the product itself.</p>
                    )}
                  </div>
                  <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0 mt-0.5' onClick={() => removeItem(idx)}>
                    <X className='h-4 w-4' />
                  </Button>
                </div>
                <div className='grid grid-cols-3 gap-3'>
                  <div className='space-y-1'>
                    <Label className='text-xs' htmlFor={`po-qty-${idx}`}>Quantity</Label>
                    <Input
                      id={`po-qty-${idx}`}
                      type='number'
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className='h-8 text-sm'
                      min={1}
                    />
                  </div>
                  <div className='space-y-1'>
                    <Label className='text-xs' htmlFor={`po-bill-${idx}`}>Total Bill (৳)</Label>
                    <Input
                      id={`po-bill-${idx}`}
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

function ShortCloseDialog({
  open,
  onOpenChange,
  purchase,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  purchase: PurchaseResponse | null
  onSubmit: (items: { purchaseItemId: string; qty: number; reason: string }[]) => void
  saving?: boolean
}) {
  const [rows, setRows] = useState<Record<string, { qty: string; reason: string }>>({})

  if (!purchase) return null

  const remainingOf = (item: PurchaseItem) => {
    const received = Number(item.receivedQty) || 0
    const shortClosed = Number((item as any).shortClosedQty) || 0
    return Math.max(0, item.quantity - received - shortClosed)
  }

  const handleSubmit = () => {
    const items: { purchaseItemId: string; qty: number; reason: string }[] = []
    for (const [itemId, v] of Object.entries(rows)) {
      const qty = Number(v.qty || 0)
      if (!(qty > 0)) continue
      if (!v.reason.trim()) {
        toast.error('A reason is required for every short-closed line')
        return
      }
      const item = purchase.items.find(i => i.id === itemId)
      const remaining = item ? remainingOf(item) : 0
      if (qty > remaining) {
        toast.error(`Short-close qty exceeds remaining (${remaining})`)
        return
      }
      items.push({ purchaseItemId: itemId, qty, reason: v.reason.trim() })
    }
    if (items.length === 0) {
      toast.error('Enter at least one short-close quantity with a reason')
      return
    }
    onSubmit(items)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Short Close — {purchase.referenceNo}</DialogTitle>
          <p className='text-xs text-muted-foreground'>
            Supplier আর দেবে না এমন বাকি quantity এখানে close করুন। Short-closed value final purchase value থেকে বাদ যাবে।
          </p>
        </DialogHeader>
        <div className='space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-2'>
          {purchase.items.map(item => {
            const remaining = remainingOf(item)
            if (remaining <= 0) return null
            const r = rows[item.id] || { qty: '', reason: '' }
            const variantStr = item.variant?.attributeValues?.map(av => av.attributeValue.value).join(' / ')
            return (
              <div key={item.id} className='rounded-lg border p-3 space-y-2 bg-muted/10'>
                <p className='text-sm font-medium truncate'>
                  {item.product?.name || item.productId.slice(0, 8)}
                  {variantStr && <span className='font-normal text-muted-foreground'> — {variantStr}</span>}
                </p>
                <p className='text-[11px] text-muted-foreground'>
                  Ordered: {item.quantity} • Received: {item.receivedQty || 0} • Remaining: {remaining}
                </p>
                <div className='grid grid-cols-3 gap-3'>
                  <div className='space-y-1'>
                    <Label className='text-xs' htmlFor={`sc-qty-${item.id}`}>Short qty</Label>
                    <Input
                      id={`sc-qty-${item.id}`}
                      type='number'
                      value={r.qty}
                      onChange={e => setRows(prev => ({ ...prev, [item.id]: { qty: e.target.value, reason: prev[item.id]?.reason || '' } }))}
                      className='h-8 text-sm'
                      min={0}
                      max={remaining}
                    />
                  </div>
                  <div className='space-y-1 col-span-2'>
                    <Label className='text-xs'>Reason *</Label>
                    <Input
                      value={r.reason}
                      onChange={e => setRows(prev => ({ ...prev, [item.id]: { qty: prev[item.id]?.qty || '', reason: e.target.value } }))}
                      className='h-8 text-sm'
                      placeholder='e.g. supplier discontinued'
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            <Scissors className='h-4 w-4 mr-1' /> Short Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelPurchaseDialog({
  open,
  onOpenChange,
  purchase,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  purchase: PurchaseResponse | null
  onSubmit: (reason: string) => void
  saving?: boolean
}) {
  const [reason, setReason] = useState('')

  if (!purchase) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel Purchase — {purchase.referenceNo}</DialogTitle></DialogHeader>
        <p className='text-sm text-muted-foreground'>
          Already-received stock stays in inventory. Every outstanding remainder is short-closed
          with your reason below, so no quantity is left silently pending.
        </p>
        <div className='space-y-1.5'>
          <Label>Reason *</Label>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder='Why is this purchase being cancelled?'
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Back</Button>
          <Button
            variant='destructive'
            disabled={saving}
            onClick={() => {
              if (!reason.trim()) {
                toast.error('A reason is required to cancel')
                return
              }
              onSubmit(reason.trim())
            }}
          >
            {saving && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            Cancel Purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PurchaseDetailDialog({
  open,
  onOpenChange,
  purchaseId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  purchaseId: string | null
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-detail', purchaseId],
    queryFn: () => purchasesApi.get(purchaseId!).then(r => r.data),
    enabled: open && !!purchaseId,
  })
  const p = data as (PurchaseResponse & { summary?: import('./api').PurchaseSummary; events?: import('./api').PurchaseEvent[] }) | undefined
  const summary = p?.summary
  const companyDamage = summary?.totals.companyDamageValue ?? 0
  const sc = p ? getStatusConfig(p.status) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl'>
        <DialogHeader>
          <DialogTitle className='text-lg'>Purchase {p?.referenceNo || ''}</DialogTitle>
          <p className='text-xs text-muted-foreground'>
            {p?.supplier?.name || ''} • {p ? new Date(p.orderDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
          </p>
        </DialogHeader>
        {isLoading || !p ? (
          <div className='flex justify-center py-10'><Loader2 className='animate-spin h-6 w-6' /></div>
        ) : (
          <div className='space-y-4 py-1 max-h-[65vh] overflow-y-auto pr-1'>
            <div className='flex items-center gap-2'>
              {sc && <Badge variant={sc.variant} className={sc.className}>{sc.label}</Badge>}
            </div>

            {/* Summary strip */}
            <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
              {[
                ['Ordered value', `৳${fmt(summary?.totals.orderedValue ?? p.total)}`],
                ['Accepted value', `৳${fmt(summary?.totals.acceptedValue ?? 0)}`],
                ['Short-closed', `৳${fmt(summary?.totals.shortClosedValue ?? 0)}`],
                ['Pending qty', `${summary?.totals.remainingQty ?? 0}`],
                ...(companyDamage > 0 ? [['Damage (co.)', `৳${fmt(companyDamage)}`]] : []),
              ].map(([label, value]) => (
                <div key={label} className='rounded-lg border bg-muted/20 px-3 py-2'>
                  <p className='text-[11px] text-muted-foreground'>{label}</p>
                  <p className='text-sm font-semibold'>{value}</p>
                </div>
              ))}
            </div>

            {/* Product disposition */}
            <div>
              <p className='text-sm font-semibold mb-1.5'>Products</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='text-xs'>Product</TableHead>
                    <TableHead className='text-xs text-right'>Ordered</TableHead>
                    <TableHead className='text-xs text-right'>Received</TableHead>
                    <TableHead className='text-xs text-right'>Accepted</TableHead>
                    <TableHead className='text-xs text-right'>Damage</TableHead>
                    <TableHead className='text-xs text-right'>Short</TableHead>
                    <TableHead className='text-xs text-right'>Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(summary?.items || []).map((s: import('./api').PurchaseDispositionItem) => {
                    const item = p.items.find(i => i.id === s.purchaseItemId)
                    const variantStr = item?.variant?.attributeValues?.map(av => av.attributeValue.value).join(' / ')
                    return (
                      <TableRow key={s.purchaseItemId}>
                        <TableCell className='text-xs'>
                          <span className='font-medium'>{item?.product?.name || s.purchaseItemId.slice(0, 8)}</span>
                          {variantStr && <span className='text-muted-foreground'> — {variantStr}</span>}
                        </TableCell>
                        <TableCell className='text-xs text-right'>{s.ordered}</TableCell>
                        <TableCell className='text-xs text-right'>{s.received}</TableCell>
                        <TableCell className='text-xs text-right text-emerald-600'>{s.accepted}</TableCell>
                        <TableCell className='text-xs text-right text-destructive'>{s.rejected || '—'}</TableCell>
                        <TableCell className='text-xs text-right'>{s.shortClosed || '—'}</TableCell>
                        <TableCell className='text-xs text-right font-medium'>{s.remaining}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Receive history */}
            <div>
              <p className='text-sm font-semibold mb-1.5'>Receive History ({(p.grns || []).length})</p>
              {(p.grns || []).length === 0 && (
                <p className='text-xs text-muted-foreground'>No receives yet.</p>
              )}
              <div className='space-y-2'>
                {(p.grns || []).map(g => (
                  <div key={g.id} className='rounded-lg border p-3 bg-muted/10'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs'>
                      <span className='font-mono font-semibold'>{g.grnNumber}</span>
                      <span className='text-muted-foreground'>{new Date(g.receivedAt || g.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {g.warehouse?.name && <span className='text-muted-foreground'>{g.warehouse.name}</span>}
                      {g.receivedBy && <span className='text-muted-foreground'>by {g.receivedBy.slice(0, 8)}</span>}
                    </div>
                    <div className='mt-1.5 space-y-1'>
                      {g.items.map((l: any) => (
                        <p key={l.id} className='text-xs text-muted-foreground'>
                          {l.acceptedQty} accepted
                          {l.rejectedQty > 0 && <span> • {l.rejectedQty} damage ({l.damageResponsibility || 'supplier'})</span>}
                          {l.freeOfCharge && <span> • free replacement</span>}
                          {l.lineWarehouseId && l.lineWarehouseId !== g.warehouseId && <span> • other location</span>}
                          {' '}• ৳{fmt(l.totalCost)}
                        </p>
                      ))}
                    </div>
                    {g.notes && <p className='text-xs text-muted-foreground mt-1 italic'>{g.notes}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Event trail */}
            {(p.events || []).length > 0 && (
              <div>
                <p className='text-sm font-semibold mb-1.5'>History</p>
                <div className='space-y-1.5'>
                  {p.events!.map(e => (
                    <div key={e.id} className='flex gap-2 text-xs'>
                      <span className='text-muted-foreground shrink-0'>
                        {new Date(e.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  onReceive: (items: { purchaseItemId: string; productId: string; variantId: string | null; receivedQty: number; acceptedQty: number; rejectedQty: number; damageResponsibility: 'supplier' | 'company'; freeOfCharge: boolean; lineWarehouseId?: string }[], notes?: string, warehouseId?: string) => void
  products?: any[]
}) {
  const [received, setReceived] = useState<Record<string, { receivedQty: string; acceptedQty: string; rejectedQty: string; responsibility: 'supplier' | 'company'; freeOfCharge: boolean; lineWarehouseId: string; acceptedTouched: boolean }>>({})
  const [notes, setNotes] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
    enabled: open,
  })
  const activeWarehouses = (warehouses || []).filter((w: any) => w.isActive)

  const productMap = useMemo(() => {
    return new Map(products.map(p => [p.id, p]))
  }, [products])

  if (!purchase) return null

  const lineState = (purchase: PurchaseResponse) => {
    const out = new Map<string, { ordered: number; received: number; shortClosed: number; remaining: number }>()
    for (const item of purchase.items) {
      const received = Number(item.receivedQty) || 0
      const shortClosed = Number((item as any).shortClosedQty) || 0
      out.set(item.id, {
        ordered: item.quantity,
        received,
        shortClosed,
        remaining: Math.max(0, item.quantity - received - shortClosed),
      })
    }
    return out
  }
  const disposition = lineState(purchase)

  const handleReceive = () => {
    if (!selectedWarehouse) {
      toast.error('Select a destination warehouse')
      return
    }
    const items: { purchaseItemId: string; productId: string; variantId: string | null; receivedQty: number; acceptedQty: number; rejectedQty: number; damageResponsibility: 'supplier' | 'company'; freeOfCharge: boolean; lineWarehouseId?: string }[] = []
    for (const [itemId, v] of Object.entries(received)) {
      const rec = Number(v.receivedQty || 0)
      if (!(rec > 0)) continue
      const acc = Number(v.acceptedQty || 0)
      const rej = Number(v.rejectedQty || 0)
      if (acc + rej > rec) {
        toast.error('Accepted + Rejected cannot exceed Received for an item')
        return
      }
      const item = purchase.items.find((i: PurchaseItem) => i.id === itemId)
      const st = disposition.get(itemId)
      if (st && rec > st.remaining) {
        toast.error(`Receive qty exceeds remaining (${st.remaining}) for an item`)
        return
      }
      items.push({
        purchaseItemId: itemId,
        productId: item?.productId || '',
        variantId: item?.variantId || null,
        receivedQty: rec,
        acceptedQty: v.acceptedQty === '' ? rec : acc,
        rejectedQty: rej,
        damageResponsibility: v.responsibility,
        freeOfCharge: v.freeOfCharge,
        ...(v.lineWarehouseId ? { lineWarehouseId: v.lineWarehouseId } : {}),
      })
    }
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
        [itemId]: { receivedQty: '', acceptedQty: '', rejectedQty: '0', responsibility: 'supplier', freeOfCharge: false, lineWarehouseId: '', acceptedTouched: false },
      }))
    }
  }

  const patchItem = (itemId: string, patch: Partial<{ receivedQty: string; acceptedQty: string; rejectedQty: string; responsibility: 'supplier' | 'company'; freeOfCharge: boolean; lineWarehouseId: string; acceptedTouched: boolean }>) => {
    setReceived(prev => {
      const cur = prev[itemId] || { receivedQty: '', acceptedQty: '', rejectedQty: '0', responsibility: 'supplier' as const, freeOfCharge: false, lineWarehouseId: '', acceptedTouched: false }
      return { ...prev, [itemId]: { ...cur, ...patch } }
    })
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
            const r = received[item.id] || { receivedQty: '', acceptedQty: '', rejectedQty: '0', responsibility: 'supplier' as const, freeOfCharge: false, lineWarehouseId: '', acceptedTouched: false }
            // This item's own agreed unit — never another line's lot cost.
            const unitBase = item.quantity > 0 ? Number(item.totalBill || item.totalPrice || 0) / item.quantity : 0
            const st = disposition.get(item.id) || { ordered: item.quantity, received: 0, shortClosed: 0, remaining: item.quantity }

            const product = productMap.get(item.productId) || item.product
            const imgUrl = product?.images?.[0]?.url || product?.images?.[0] || ''
            const sku = item.variant?.sku || product?.sku || item.product?.sku || ''
            const closed = st.remaining <= 0
            return (
              <div key={item.id} className={`rounded-lg border p-3 flex flex-col gap-3 bg-muted/10 ${closed ? 'opacity-60' : ''}`}>
                <div className='flex items-center gap-3 w-full'>
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
                      {item.variant && <span>{item.variant.attributeValues?.map(av => av.attributeValue.value).join(' / ')}</span>}
                      {sku && (
                        <>
                          <span>•</span>
                          <span>SKU: {sku}</span>
                        </>
                      )}
                      <span>•</span>
                      <span>৳{fmt(item.unitPrice)}/unit</span>
                      <span>•</span>
                      <span>Total: ৳{fmt(item.totalBill || item.totalPrice)}</span>
                    </div>
                    <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px]'>
                      <span className='text-muted-foreground'>Ordered: <span className='font-medium text-foreground'>{st.ordered}</span></span>
                      <span className='text-muted-foreground'>Received: <span className='font-medium text-foreground'>{st.received}</span></span>
                      {st.shortClosed > 0 && <span className='text-muted-foreground'>Short-closed: <span className='font-medium'>{st.shortClosed}</span></span>}
                      <span className={st.remaining > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                        Remaining: {st.remaining}{closed ? ' (done)' : ''}
                      </span>
                    </div>
                    {unitBase > 0 && <p className='text-xs text-green-600 truncate'>Expected cost: ৳{unitBase.toFixed(2)}/unit</p>}
                  </div>
                </div>

                {!closed ? (
                <>
                <div className='w-full grid grid-cols-3 gap-3'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs' htmlFor={`rec-now-${item.id}`}>Received (now)</Label>
                    <Input
                      id={`rec-now-${item.id}`}
                      type='number'
                      value={r.receivedQty}
                      onChange={e => {
                        const rec = Number(e.target.value || 0)
                        const rej = Number(r.rejectedQty || 0)
                        patchItem(item.id, { receivedQty: e.target.value, ...(r.acceptedTouched ? {} : { acceptedQty: String(Math.max(0, rec - rej)) }) })
                      }}
                      onFocus={() => initItem(item.id)}
                      className='h-9 text-sm'
                      min={0}
                      max={st.remaining}
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label className='text-xs' htmlFor={`rec-acc-${item.id}`}>Accepted</Label>
                    <Input
                      id={`rec-acc-${item.id}`}
                      type='number'
                      value={r.acceptedQty}
                      onChange={e => patchItem(item.id, { acceptedQty: e.target.value, acceptedTouched: true })}
                      onFocus={() => initItem(item.id)}
                      className='h-9 text-sm'
                      min={0}
                      placeholder='= received'
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label className='text-xs' htmlFor={`rec-rej-${item.id}`}>Rejected</Label>
                    <Input
                      id={`rec-rej-${item.id}`}
                      type='number'
                      value={r.rejectedQty}
                      onChange={e => {
                        const rec = Number(r.receivedQty || 0)
                        const rej = Number(e.target.value || 0)
                        patchItem(item.id, { rejectedQty: e.target.value, ...(r.acceptedTouched ? {} : { acceptedQty: String(Math.max(0, rec - rej)) }) })
                      }}
                      onFocus={() => initItem(item.id)}
                      className='h-9 text-sm'
                      min={0}
                    />
                  </div>
                </div>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-xs'>
                  <label className='flex items-center gap-1.5 text-muted-foreground'>
                    <input
                      type='checkbox'
                      checked={r.freeOfCharge}
                      onChange={e => patchItem(item.id, { freeOfCharge: e.target.checked })}
                      className='h-3.5 w-3.5'
                    />
                    Free replacement (0 cost)
                  </label>
                  {Number(r.rejectedQty || 0) > 0 && !r.freeOfCharge && (
                    <span className='flex items-center gap-2 text-muted-foreground'>
                      Damage cost:
                      <label className='flex items-center gap-1'>
                        <input
                          type='radio'
                          name={`resp-${item.id}`}
                          checked={r.responsibility === 'supplier'}
                          onChange={() => patchItem(item.id, { responsibility: 'supplier' })}
                          className='h-3.5 w-3.5'
                        />
                        Supplier bears
                      </label>
                      <label className='flex items-center gap-1' title='Damage cost spreads onto the accepted units'>
                        <input
                          type='radio'
                          name={`resp-${item.id}`}
                          checked={r.responsibility === 'company'}
                          onChange={() => patchItem(item.id, { responsibility: 'company' })}
                          className='h-3.5 w-3.5'
                        />
                        Company bears
                      </label>
                    </span>
                  )}
                  <label className='flex items-center gap-1.5 text-muted-foreground'>
                    Location:
                    <select
                      value={r.lineWarehouseId}
                      onChange={e => patchItem(item.id, { lineWarehouseId: e.target.value })}
                      className='h-7 rounded-md border border-input bg-background px-1.5 text-xs'
                    >
                      <option value=''>GRN warehouse</option>
                      {activeWarehouses.map((w: any) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                </>
                ) : null}
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
                <div className='flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-2'>
                  <span className='font-mono text-sm font-semibold'>{grn.grnNumber}</span>
                  <Badge variant='outline' className='text-xs'>{grn.status}</Badge>
                  <span className='text-[11px] text-muted-foreground'>
                    {new Date((grn as any).receivedAt || grn.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {(grn as any).warehouse?.name && <span className='text-[11px] text-muted-foreground'>{(grn as any).warehouse.name}</span>}
                </div>
                {(grn as any).notes && <p className='text-[11px] text-muted-foreground italic mb-2'>{(grn as any).notes}</p>}
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
                        <TableCell className='text-xs text-right'>
                          {gitem.rejectedQty}
                          {gitem.rejectedQty > 0 && (
                            <span className='block text-[10px] text-muted-foreground'>
                              {(gitem as any).damageResponsibility === 'company' ? 'co. bears' : 'sup. bears'}
                            </span>
                          )}
                          {(gitem as any).freeOfCharge && (
                            <span className='block text-[10px] text-emerald-600'>free repl.</span>
                          )}
                        </TableCell>
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
  const [shortCloseDialog, setShortCloseDialog] = useState<PurchaseResponse | null>(null)
  const [cancelDialog, setCancelDialog] = useState<PurchaseResponse | null>(null)
  const [detailDialog, setDetailDialog] = useState<PurchaseResponse | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const emptyForm = {
    referenceNo: '',
    supplierId: '',
    orderDate: dhakaTodayString(),
    notes: '',
    items: [{ productId: '', variantId: null, quantity: '1', totalBill: '0', sel: null, lookedUp: false }],
  }
  const [form, setForm] = useState<{
    referenceNo: string
    supplierId: string
    orderDate: string
    notes: string
    items: { productId: string; variantId: string | null; quantity: string; totalBill: string; sel: LookupRow | null; lookedUp: boolean }[]
  }>(emptyForm)

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
      queryClient.invalidateQueries({ queryKey: ['purchase-detail'] })
      setReceiveDialog(null)
      toast.success('Items received via GRN')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error receiving items'),
  })

  const shortCloseMut = useMutation({
    mutationFn: ({ id, items }: { id: string; items: { purchaseItemId: string; qty: number; reason: string }[] }) =>
      purchasesApi.shortClose(id, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-detail'] })
      setShortCloseDialog(null)
      toast.success('Short-close recorded')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error recording short-close'),
  })

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      purchasesApi.cancel(id, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-detail'] })
      setCancelDialog(null)
      toast.success('Purchase cancelled (remainder short-closed)')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error cancelling purchase'),
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
      // Variant linkage survives the edit round-trip: dropping variantId
      // here used to re-post variant stock at product level on the next GRN.
      items: p.items.map(i => {
        const variantName = i.variant?.attributeValues?.map(av => av.attributeValue.value).join(' / ') || null
        return {
          productId: i.productId,
          variantId: i.variantId || null,
          quantity: String(i.quantity),
          totalBill: String(i.totalBill || i.totalPrice || 0),
          sel: {
            productId: i.productId,
            productName: i.product?.name || 'Product',
            variantId: i.variantId || null,
            variantName,
            sku: i.variant?.sku || i.product?.sku || null,
            type: (i.variantId ? 'variant' : 'product') as 'variant' | 'product',
            available: 0,
            image: Array.isArray(i.product?.images) ? (i.product.images[0]?.url || i.product.images[0] || null) : null,
          } as LookupRow,
          lookedUp: false,
        }
      }),
    })
    setOpen(true)
  }

  const handleSave = () => {
    if (!form.supplierId.trim()) {
      toast.error('Please select a supplier')
      return
    }
    const items: { productId: string; variantId: string | null; quantity: number; totalBill: number }[] = []
    for (const i of form.items) {
      if (!i.productId.trim()) continue
      const qty = Number(i.quantity)
      const bill = Number(i.totalBill)
      if (!(qty >= 1)) {
        toast.error('Quantity must be at least 1 for every item')
        return
      }
      if (!(bill >= 0)) {
        toast.error('Total bill cannot be negative')
        return
      }
      items.push({
        productId: i.productId.trim(),
        variantId: i.variantId || null,
        quantity: qty,
        totalBill: bill,
      })
    }
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
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-7 w-7'
                              onClick={() => setDetailDialog(p)}
                              title='Purchase detail & history'
                            >
                              <Eye className='h-3.5 w-3.5' />
                            </Button>
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
                            {(p.status === 'ordered' || p.status === 'partially_received') && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => setShortCloseDialog(p)}
                                title='Short close remaining'
                              >
                                <Scissors className='h-3.5 w-3.5' />
                              </Button>
                            )}
                            {(p.status === 'ordered' || p.status === 'partially_received') && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => setCancelDialog(p)}
                                title='Cancel purchase'
                              >
                                <Ban className='h-3.5 w-3.5' />
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
                            {/* Terms lock once goods move: the backend rejects
                                anything but notes after the first GRN. */}
                            {(p.grns?.length ?? 0) === 0 && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => openEdit(p)}
                                title='Edit purchase'
                              >
                                <Pencil className='h-3.5 w-3.5' />
                              </Button>
                            )}
                            {(p.grns?.length ?? 0) === 0 && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-7 w-7'
                                onClick={() => setDeleteConfirm(p.id)}
                                title='Delete purchase'
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
                                        {Number((item as any).shortClosedQty || 0) > 0 && (
                                          <div className='text-right'>
                                            <p className='text-muted-foreground'>Short</p>
                                            <p className='font-medium'>{(item as any).shortClosedQty}</p>
                                          </div>
                                        )}
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

      <ShortCloseDialog
        open={!!shortCloseDialog}
        onOpenChange={v => { if (!v) setShortCloseDialog(null) }}
        purchase={shortCloseDialog}
        saving={shortCloseMut.isPending}
        onSubmit={items => {
          if (shortCloseDialog) shortCloseMut.mutate({ id: shortCloseDialog.id, items })
        }}
      />

      <CancelPurchaseDialog
        open={!!cancelDialog}
        onOpenChange={v => { if (!v) setCancelDialog(null) }}
        purchase={cancelDialog}
        saving={cancelMut.isPending}
        onSubmit={reason => {
          if (cancelDialog) cancelMut.mutate({ id: cancelDialog.id, reason })
        }}
      />

      <PurchaseDetailDialog
        open={!!detailDialog}
        onOpenChange={v => { if (!v) setDetailDialog(null) }}
        purchaseId={detailDialog?.id || null}
      />
    </>
  )
}
