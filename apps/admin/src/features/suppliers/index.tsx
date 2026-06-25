import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, Banknote, Receipt } from 'lucide-react'
import { suppliersApi, type SupplierResponse, type SupplierPaymentResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

function fmt(v: number | string) {
  return Number(v).toFixed(2)
}

const paymentMethods = ['cash', 'bank', 'bkash', 'nagad', 'rocket', 'card', 'other']

export function Suppliers() {
  const queryClient = useQueryClient()
  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => suppliersApi.list().then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<SupplierResponse | null>(null)
  const [payingSupplier, setPayingSupplier] = useState<SupplierResponse | null>(null)
  const [viewingPayments, setViewingPayments] = useState<SupplierResponse | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentMethod: 'cash',
    reference: '',
    paidAt: new Date().toISOString().slice(0, 10),
    notes: '',
  })
  const [form, setForm] = useState({
    name: '', slug: '', contactPerson: '', email: '', phone: '',
    address: '', city: '', country: 'Bangladesh', taxId: '', paymentTerms: '', notes: '', isActive: true,
  })

  const createMut = useMutation({
    mutationFn: suppliersApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); setShowCreate(false); setForm({ name: '', slug: '', contactPerson: '', email: '', phone: '', address: '', city: '', country: 'Bangladesh', taxId: '', paymentTerms: '', notes: '', isActive: true }); toast.success('Created') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); setEditing(null); toast.success('Updated') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: suppliersApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Deleted') },
  })

  const paymentMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.createPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setPayingSupplier(null)
      setPaymentForm({ amount: '', paymentMethod: 'cash', reference: '', paidAt: new Date().toISOString().slice(0, 10), notes: '' })
      toast.success('Payment recorded')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error recording payment'),
  })

  const openEdit = (supplier: SupplierResponse) => {
    setEditing(supplier)
    setForm({
      name: supplier.name, slug: supplier.slug, contactPerson: supplier.contactPerson || '',
      email: supplier.email || '', phone: supplier.phone || '', address: supplier.address || '',
      city: supplier.city || '', country: supplier.country || 'Bangladesh', taxId: supplier.taxId || '',
      paymentTerms: supplier.paymentTerms || '', notes: supplier.notes || '', isActive: supplier.isActive,
    })
  }

  const allSuppliers = Array.isArray(suppliers) ? suppliers : []

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Suppliers</h2>
            <p className='text-muted-foreground'>Manage product suppliers.</p>
          </div>
          <Button size='sm' onClick={() => setShowCreate(true)}><Plus className='h-4 w-4' /> Add Supplier</Button>
        </div>

        {isLoading ? <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div> : (
          <Card>
            <CardContent className='pt-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Total Purchases</TableHead>
                    <TableHead className='text-right'>Total Paid</TableHead>
                    <TableHead className='text-right'>Balance</TableHead>
                    <TableHead className='w-32'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allSuppliers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className='text-center py-12 text-muted-foreground'>No suppliers found</TableCell>
                    </TableRow>
                  ) : (
                    allSuppliers.map((supplier: SupplierResponse) => (
                      <TableRow key={supplier.id}>
                        <TableCell>
                          <div className='font-medium'>{supplier.name}</div>
                          <div className='text-xs text-muted-foreground'>{supplier.slug}</div>
                        </TableCell>
                        <TableCell>
                          <div className='text-sm'>{supplier.contactPerson || '-'}</div>
                          <div className='text-xs text-muted-foreground'>{supplier.phone || supplier.email || '-'}</div>
                        </TableCell>
                        <TableCell>
                          {supplier.isActive ? (
                            <Badge variant='default' className='bg-green-500 text-xs'>Active</Badge>
                          ) : (
                            <Badge variant='secondary' className='text-xs'>Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-right font-medium'>৳{fmt(supplier.totalPurchases || 0)}</TableCell>
                        <TableCell className='text-right font-medium'>৳{fmt(supplier.totalPaid || 0)}</TableCell>
                        <TableCell className='text-right'>
                          <span className={`font-semibold ${(supplier.balance || 0) > 0 ? 'text-green-600' : (supplier.balance || 0) < 0 ? 'text-red-600' : ''}`}>
                            ৳{fmt(supplier.balance || 0)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className='flex gap-1'>
                            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(supplier)} title='Edit'>
                              <Pencil className='h-3.5 w-3.5' />
                            </Button>
                            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => {
                              setPayingSupplier(supplier)
                              setPaymentForm({ amount: String(supplier.balance || 0), paymentMethod: 'cash', reference: '', paidAt: new Date().toISOString().slice(0, 10), notes: '' })
                            }} title='Make Payment'>
                              <Banknote className='h-3.5 w-3.5' />
                            </Button>
                            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setViewingPayments(supplier)} title='View Payments'>
                              <Receipt className='h-3.5 w-3.5' />
                            </Button>
                            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(supplier.id)} title='Delete'>
                              <Trash2 className='h-3.5 w-3.5 text-destructive' />
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
        )}
      </Main>

      <Dialog open={showCreate || !!editing} onOpenChange={o => { if (!o) { setShowCreate(false); setEditing(null) } }}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => {
                const name = e.target.value
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                setForm(f => ({ ...f, name, slug: editing ? f.slug : slug }))
              }} placeholder='e.g. TechSource Ltd' />
            </div>
            <div className='grid gap-2'>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>Contact Person</Label>
                <Input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder='e.g. John Doe' />
              </div>
              <div className='grid gap-2'>
                <Label>Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder='e.g. john@example.com' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder='e.g. +880 1234 567890' />
              </div>
              <div className='grid gap-2'>
                <Label>Tax ID</Label>
                <Input value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder='e.g. BIN 123456' />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder='e.g. 123, Gulshan Avenue' />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-2'>
                <Label>City</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder='e.g. Dhaka' />
              </div>
              <div className='grid gap-2'>
                <Label>Country</Label>
                <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Payment Terms</Label>
              <Input value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} placeholder='e.g. Net 30' />
            </div>
            <div className='grid gap-2'>
              <Label>Notes</Label>
              <textarea
                className='flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder='Additional notes...'
              />
            </div>
            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' className='rounded border-gray-300' checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setShowCreate(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={() => editing ? updateMut.mutate({ id: editing.id, data: form }) : createMut.mutate(form)} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? 'Save Changes' : 'Create Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payingSupplier} onOpenChange={v => { if (!v) setPayingSupplier(null) }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Make Payment - {payingSupplier?.name}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-2'>
            <div className='grid gap-2'>
              <Label>Amount (৳)</Label>
              <Input
                type='number'
                value={paymentForm.amount}
                onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                min={0}
                step='0.01'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Payment Method</Label>
              <select
                className='flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                value={paymentForm.paymentMethod}
                onChange={e => setPaymentForm(f => ({ ...f, paymentMethod: e.target.value }))}
              >
                {paymentMethods.map(m => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className='grid gap-2'>
              <Label>Reference / Transaction ID</Label>
              <Input
                value={paymentForm.reference}
                onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))}
                placeholder='Optional'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Payment Date</Label>
              <Input
                type='date'
                value={paymentForm.paidAt}
                onChange={e => setPaymentForm(f => ({ ...f, paidAt: e.target.value }))}
              />
            </div>
            <div className='grid gap-2'>
              <Label>Notes</Label>
              <textarea
                className='flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                value={paymentForm.notes}
                onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                placeholder='Optional notes...'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPayingSupplier(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!Number(paymentForm.amount) || Number(paymentForm.amount) <= 0) {
                  toast.error('Enter a valid amount')
                  return
                }
                if (payingSupplier) {
                  paymentMut.mutate({
                    id: payingSupplier.id,
                    data: {
                      amount: Number(paymentForm.amount),
                      paymentMethod: paymentForm.paymentMethod,
                      reference: paymentForm.reference || undefined,
                      paidAt: paymentForm.paidAt,
                      notes: paymentForm.notes || undefined,
                    },
                  })
                }
              }}
              disabled={paymentMut.isPending}
            >
              {paymentMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingPayments} onOpenChange={v => { if (!v) setViewingPayments(null) }}>
        <DialogContent className='max-w-xl'>
          <DialogHeader>
            <DialogTitle>Payment History - {viewingPayments?.name}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3 py-2 max-h-[50vh] overflow-y-auto'>
            {viewingPayments?.payments && viewingPayments.payments.length > 0 ? (
              viewingPayments.payments.map((pmt: SupplierPaymentResponse) => (
                <div key={pmt.id} className='rounded-lg border p-3 space-y-1'>
                  <div className='flex items-center justify-between'>
                    <span className='font-semibold text-green-600'>+৳{fmt(pmt.amount)}</span>
                    <Badge variant='outline' className='text-xs'>{pmt.paymentMethod || 'N/A'}</Badge>
                  </div>
                  <div className='flex items-center justify-between text-xs text-muted-foreground'>
                    <span>{new Date(pmt.paidAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    {pmt.reference && <span>Ref: {pmt.reference}</span>}
                  </div>
                  {pmt.notes && <p className='text-xs text-muted-foreground'>{pmt.notes}</p>}
                  {pmt.invoices && pmt.invoices.length > 0 && (
                    <div className='text-xs text-muted-foreground'>
                      Invoices: {pmt.invoices.map(i => i.invoiceNo).join(', ')}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className='text-center py-8 text-muted-foreground text-sm'>
                No payments recorded for this supplier.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setViewingPayments(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
