import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Receipt } from 'lucide-react'
import { expensesApi, EXPENSE_CATEGORIES, type ExpenseResponse, type ExpenseCategory } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'

const CATEGORY_LABELS: Record<ExpenseCategory, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map(c => [c.value, c.label])
) as Record<ExpenseCategory, string>

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function Expenses() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage] = useState(10)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseResponse | null>(null)
  const [form, setForm] = useState({
    description: '',
    category: '' as ExpenseCategory | '',
    amount: '',
    taxAmount: '',
    expenseDate: '',
    paymentMethod: '',
    referenceNo: '',
    notes: '',
  })
  const [deleteTarget, setDeleteTarget] = useState<ExpenseResponse | null>(null)

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['expenses-summary'],
    queryFn: () => expensesApi.summary().then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', page, perPage],
    queryFn: () => expensesApi.list({ page, perPage }).then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (d: Parameters<typeof expensesApi.create>[0]) => expensesApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] })
      setDialogOpen(false)
      resetForm()
      toast.success('Expense created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating expense'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Parameters<typeof expensesApi.update>[1] }) => expensesApi.update(id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] })
      setDialogOpen(false)
      setEditing(null)
      resetForm()
      toast.success('Expense updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating expense'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => expensesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] })
      setDeleteTarget(null)
      toast.success('Expense deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting expense'),
  })

  function resetForm() {
    setForm({ description: '', category: '', amount: '', taxAmount: '', expenseDate: '', paymentMethod: '', referenceNo: '', notes: '' })
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(expense: ExpenseResponse) {
    setEditing(expense)
    setForm({
      description: expense.description,
      category: expense.category,
      amount: String(expense.amount),
      taxAmount: expense.taxAmount ? String(expense.taxAmount) : '',
      expenseDate: expense.expenseDate.slice(0, 10),
      paymentMethod: expense.paymentMethod || '',
      referenceNo: expense.referenceNo || '',
      notes: expense.notes || '',
    })
    setDialogOpen(true)
  }

  function handleSave() {
    const payload = {
      description: form.description,
      category: form.category as ExpenseCategory,
      amount: parseFloat(form.amount) || 0,
      taxAmount: form.taxAmount ? parseFloat(form.taxAmount) : undefined,
      expenseDate: form.expenseDate,
      paymentMethod: form.paymentMethod || undefined,
      referenceNo: form.referenceNo || undefined,
      notes: form.notes || undefined,
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, d: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const summaryData = Array.isArray(summary) ? summary : []
  const grandTotal = summaryData.reduce((sum, s) => sum + s.total, 0)
  const listData = data?.data || []
  const totalPages = data?.meta?.totalPages || 1

  const categoryBadgeClass = (cat: ExpenseCategory) => {
    const map: Partial<Record<ExpenseCategory, string>> = {
      utilities: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      rent: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
      salaries: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      marketing: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
      supplies: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      maintenance: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      travel: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
      shipping: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
      taxes: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
      insurance: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
      software: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
      food_and_beverages: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
      office_expenses: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300',
      professional_fees: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
      other: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
    }
    return map[cat] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Expenses</h2>
            <p className='text-muted-foreground'>Track and manage business expenses.</p>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Expense
          </Button>
        </div>

        {summaryLoading ? (
          <Card>
            <CardContent className='flex justify-center py-8'>
              <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
            </CardContent>
          </Card>
        ) : summaryData.length === 0 ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-8 text-muted-foreground'>
              <Receipt className='h-10 w-10 mb-2' />
              <p>No expense data yet</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className='text-lg'>Category Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'>
                {summaryData.map(s => (
                  <div key={s.category} className='rounded-lg border p-3'>
                    <Badge variant='secondary' className={categoryBadgeClass(s.category)}>
                      {CATEGORY_LABELS[s.category]}
                    </Badge>
                    <div className='mt-2'>
                      <span className='text-sm font-semibold'>{formatCurrency(s.total)}</span>
                      <span className='text-xs text-muted-foreground ml-1'>({s.count})</span>
                    </div>
                  </div>
                ))}
                <div className='rounded-lg border bg-muted/50 p-3'>
                  <span className='text-sm font-medium text-muted-foreground'>Grand Total</span>
                  <div className='mt-1 text-base font-bold'>{formatCurrency(grandTotal)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className='text-right'>Amount</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead className='w-[80px]'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto text-muted-foreground' />
                    </TableCell>
                  </TableRow>
                ) : listData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>
                      No expenses found
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.map(expense => (
                    <TableRow key={expense.id}>
                      <TableCell className='whitespace-nowrap'>{formatDate(expense.expenseDate)}</TableCell>
                      <TableCell className='font-medium'>{expense.description}</TableCell>
                      <TableCell>
                        <Badge variant='secondary' className={categoryBadgeClass(expense.category)}>
                          {CATEGORY_LABELS[expense.category]}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right font-mono'>{formatCurrency(expense.amount)}</TableCell>
                      <TableCell className='text-muted-foreground'>{expense.paymentMethod || '—'}</TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(expense)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(expense)}>
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
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-4 py-3 border-t'>
              <span className='text-sm text-muted-foreground'>
                Page {page} of {totalPages}
              </span>
              <div className='flex items-center gap-1'>
                <Button
                  variant='outline'
                  size='icon'
                  className='h-8 w-8'
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className='h-4 w-4' />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size='icon'
                    className='h-8 w-8'
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button
                  variant='outline'
                  size='icon'
                  className='h-8 w-8'
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </Main>

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) { setDialogOpen(false); setEditing(null) } }}>
        <DialogContent className='sm:max-w-[500px]'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Expense' : 'Add Expense'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder='Office supplies, rent payment...'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={v => setForm(f => ({ ...f, category: v as ExpenseCategory }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select category' />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>Amount</Label>
                <Input
                  type='number'
                  step='0.01'
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder='0.00'
                />
              </div>
              <div className='grid gap-2'>
                <Label>Tax Amount (optional)</Label>
                <Input
                  type='number'
                  step='0.01'
                  value={form.taxAmount}
                  onChange={e => setForm(f => ({ ...f, taxAmount: e.target.value }))}
                  placeholder='0.00'
                />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Expense Date</Label>
              <Input
                type='date'
                value={form.expenseDate}
                onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))}
              />
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>Payment Method (optional)</Label>
                <Input
                  value={form.paymentMethod}
                  onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  placeholder='Cash, Bank, Card...'
                />
              </div>
              <div className='grid gap-2'>
                <Label>Reference No. (optional)</Label>
                <Input
                  value={form.referenceNo}
                  onChange={e => setForm(f => ({ ...f, referenceNo: e.target.value }))}
                  placeholder='INV-001'
                />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Notes (optional)</Label>
              <textarea
                className='flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none'
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder='Additional notes...'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setDialogOpen(false); setEditing(null) }}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!form.description || !form.category || !form.amount || !form.expenseDate || createMut.isPending || updateMut.isPending}
            >
              {editing ? 'Save Changes' : 'Create Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete this expense? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
