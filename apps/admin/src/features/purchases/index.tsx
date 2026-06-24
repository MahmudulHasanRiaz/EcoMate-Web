import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { purchasesApi, type PurchaseResponse, type PurchaseItem } from './api'
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
import { Loader2, Plus, Pencil, Trash2, Eye, Package, X, SearchIcon } from 'lucide-react'

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
}: {
  editing: PurchaseResponse | null
  form: {
    referenceNo: string
    supplierId: string
    orderDate: string
    notes: string
    items: { productId: string; quantity: string; unitPrice: string }[]
  }
  setForm: (f: any) => void
}) {
  const addItem = () => {
    setForm((prev: typeof form) => ({
      ...prev,
      items: [...prev.items, { productId: '', quantity: '1', unitPrice: '0' }],
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
    <>
      <div className='space-y-1.5'>
        <Label>Reference No</Label>
        <Input
          value={form.referenceNo}
          onChange={e => setForm((prev: typeof form) => ({ ...prev, referenceNo: e.target.value }))}
          placeholder='e.g. PO-2024-001'
        />
      </div>
      <div className='space-y-1.5'>
        <Label>Supplier ID</Label>
        <Input
          value={form.supplierId}
          onChange={e => setForm((prev: typeof form) => ({ ...prev, supplierId: e.target.value }))}
          placeholder='Enter supplier ID'
        />
      </div>
      <div className='space-y-1.5'>
        <Label>Order Date</Label>
        <Input
          type='date'
          value={form.orderDate}
          onChange={e => setForm((prev: typeof form) => ({ ...prev, orderDate: e.target.value }))}
        />
      </div>
      <div className='space-y-1.5'>
        <Label>Items</Label>
        <div className='space-y-2'>
          {form.items.map((item, idx) => (
            <div key={idx} className='flex items-end gap-2'>
              <div className='flex-1 space-y-1'>
                <Label className='text-xs'>Product ID</Label>
                <Input
                  value={item.productId}
                  onChange={e => updateItem(idx, 'productId', e.target.value)}
                  placeholder='Product ID'
                  className='h-8 text-xs'
                />
              </div>
              <div className='w-20 space-y-1'>
                <Label className='text-xs'>Qty</Label>
                <Input
                  type='number'
                  value={item.quantity}
                  onChange={e => updateItem(idx, 'quantity', e.target.value)}
                  className='h-8 text-xs'
                  min={1}
                />
              </div>
              <div className='w-24 space-y-1'>
                <Label className='text-xs'>Unit Price</Label>
                <Input
                  type='number'
                  value={item.unitPrice}
                  onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                  className='h-8 text-xs'
                  min={0}
                  step='0.01'
                />
              </div>
              <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0' onClick={() => removeItem(idx)}>
                <X className='h-3.5 w-3.5' />
              </Button>
            </div>
          ))}
          <Button variant='outline' size='sm' onClick={addItem} className='w-full'>
            <Plus className='h-3.5 w-3.5 mr-1' /> Add Item
          </Button>
        </div>
      </div>
      <div className='space-y-1.5'>
        <Label>Notes</Label>
        <Textarea
          value={form.notes}
          onChange={e => setForm((prev: typeof form) => ({ ...prev, notes: e.target.value }))}
          placeholder='Optional notes...'
          rows={3}
        />
      </div>
    </>
  )
}

function ReceiveItemsDialog({
  open,
  onOpenChange,
  purchase,
  onReceive,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  purchase: PurchaseResponse | null
  onReceive: (items: { itemId: string; receivedQty: number }[]) => void
}) {
  const [received, setReceived] = useState<Record<string, string>>({})

  if (!purchase) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive Items - {purchase.referenceNo}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3 py-2'>
          {purchase.items.map((item: PurchaseItem) => (
            <div key={item.id} className='flex items-center gap-3 rounded-lg border p-3'>
              <div className='flex-1 min-w-0'>
                <p className='text-sm font-medium truncate'>Product: {item.productId}</p>
                <p className='text-xs text-muted-foreground'>Ordered: {item.quantity} x ৳{fmt(item.unitPrice)}</p>
              </div>
              <div className='w-24 space-y-1'>
                <Label className='text-xs'>Receive</Label>
                <Input
                  type='number'
                  value={received[item.id] ?? ''}
                  onChange={e =>
                    setReceived(prev => ({ ...prev, [item.id]: e.target.value }))
                  }
                  placeholder='Qty'
                  className='h-8 text-xs'
                  min={0}
                  max={item.quantity}
                />
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => {
            const items = Object.entries(received)
              .filter(([, qty]) => qty && Number(qty) > 0)
              .map(([itemId, qty]) => ({ itemId, receivedQty: Number(qty) }))
            if (items.length === 0) {
              toast.error('Enter at least one item quantity')
              return
            }
            onReceive(items)
          }}>
            <Package className='h-4 w-4 mr-1' /> Receive Items
          </Button>
        </DialogFooter>
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

  const emptyForm = {
    referenceNo: '',
    supplierId: '',
    orderDate: new Date().toISOString().slice(0, 10),
    notes: '',
    items: [{ productId: '', quantity: '1', unitPrice: '0' }],
  }
  const [form, setForm] = useState(emptyForm)

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
    mutationFn: ({ id, items }: { id: string; items: { itemId: string; receivedQty: number }[] }) =>
      purchasesApi.receiveItems(id, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] })
      setReceiveDialog(null)
      toast.success('Items received')
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
        unitPrice: String(i.unitPrice),
      })),
    })
    setOpen(true)
  }

  const handleSave = () => {
    if (!form.referenceNo.trim()) {
      toast.error('Reference No is required')
      return
    }
    if (!form.supplierId.trim()) {
      toast.error('Supplier ID is required')
      return
    }
    const items = form.items
      .filter(i => i.productId.trim())
      .map(i => ({
        productId: i.productId.trim(),
        quantity: Number(i.quantity) || 1,
        unitPrice: Number(i.unitPrice) || 0,
      }))
    if (items.length === 0) {
      toast.error('At least one item is required')
      return
    }
    const payload = {
      referenceNo: form.referenceNo.trim(),
      supplierId: form.supplierId.trim(),
      orderDate: form.orderDate,
      notes: form.notes.trim() || undefined,
      items,
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
                  <TableHead>Reference No</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Total</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead className='w-24'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : list.length ? (
                  list.map((p: PurchaseResponse) => {
                    const sc = getStatusConfig(p.status)
                    return (
                      <TableRow key={p.id}>
                        <TableCell className='font-mono text-sm font-semibold'>
                          {p.referenceNo}
                        </TableCell>
                        <TableCell>
                          {p.supplier?.name || (
                            <span className='text-muted-foreground text-sm'>Supplier #{p.supplierId.slice(0, 8)}</span>
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
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Purchase Order' : 'New Purchase Order'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4 py-2 max-h-[60vh] overflow-y-auto'>
            <PurchaseForm editing={editing} form={form} setForm={setForm} />
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
              {editing ? 'Update' : 'Create'}
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

      <ReceiveItemsDialog
        open={!!receiveDialog}
        onOpenChange={v => { if (!v) setReceiveDialog(null) }}
        purchase={receiveDialog}
        onReceive={(items) => {
          if (receiveDialog) {
            receiveMut.mutate({ id: receiveDialog.id, items })
          }
        }}
      />
    </>
  )
}
