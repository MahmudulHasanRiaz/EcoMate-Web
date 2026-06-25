import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { expenseCategoriesApi, type ExpenseCategoryResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const CATEGORY_COLORS: Record<string, string> = {
  utilities: '#3B82F6',
  rent: '#8B5CF6',
  salaries: '#10B981',
  marketing: '#F97316',
  supplies: '#EAB308',
  maintenance: '#EF4444',
  travel: '#6366F1',
  shipping: '#14B8A6',
  taxes: '#F43F5E',
  insurance: '#06B6D4',
  software: '#8B5CF6',
  food_and_beverages: '#EC4899',
  office_expenses: '#64748B',
  professional_fees: '#D97706',
  other: '#6B7280',
}

export function ExpenseCategories() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseCategoryResponse | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '', color: '#6B7280', sortOrder: 0 })
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategoryResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => expenseCategoriesApi.list().then(r => r.data),
  })

  const categories = Array.isArray(data) ? data : []

  const createMut = useMutation({
    mutationFn: (d: any) => expenseCategoriesApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expense-categories'] }); setDialogOpen(false); resetForm(); toast.success('Category created') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating category'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: any }) => expenseCategoriesApi.update(id, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expense-categories'] }); setDialogOpen(false); setEditing(null); resetForm(); toast.success('Category updated') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating category'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => expenseCategoriesApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expense-categories'] }); setDeleteTarget(null); toast.success('Category deleted') },
    onError: (e: any) => toast.error(e.response?.data?.message || e.message || 'Error deleting category'),
  })

  function resetForm() {
    setForm({ name: '', slug: '', description: '', color: '#6B7280', sortOrder: 0 })
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(cat: ExpenseCategoryResponse) {
    setEditing(cat)
    setForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || '',
      color: cat.color || '#6B7280',
      sortOrder: cat.sortOrder,
    })
    setDialogOpen(true)
  }

  function handleSave() {
    const payload = {
      name: form.name,
      slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: form.description || undefined,
      color: form.color || undefined,
      sortOrder: form.sortOrder,
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, d: payload })
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
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Expense Categories</h2>
            <p className='text-muted-foreground'>Manage expense categories for tracking and reporting.</p>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Category
          </Button>
        </div>

        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
            ) : categories.length === 0 ? (
              <div className='text-center py-12 text-muted-foreground'>No expense categories yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-10'>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead className='text-center'>Expenses</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='w-20'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat, i) => (
                    <TableRow key={cat.id}>
                      <TableCell className='text-xs text-muted-foreground'>{i + 1}</TableCell>
                      <TableCell className='font-medium'>
                        <div className='flex items-center gap-2'>
                          <div className='h-4 w-4 rounded-full border' style={{ backgroundColor: cat.color || CATEGORY_COLORS[cat.slug] || '#6B7280' }} />
                          {cat.name}
                        </div>
                      </TableCell>
                      <TableCell className='text-sm text-muted-foreground font-mono'>{cat.slug}</TableCell>
                      <TableCell>
                        <code className='text-xs bg-muted px-1.5 py-0.5 rounded'>{cat.color || CATEGORY_COLORS[cat.slug] || '—'}</code>
                      </TableCell>
                      <TableCell className='text-center'>{cat._count?.expenses || 0}</TableCell>
                      <TableCell>
                        {cat.isActive ? <Badge className='bg-green-500 text-xs'>Active</Badge> : <Badge variant='secondary' className='text-xs'>Inactive</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(cat)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(cat)}>
                            <Trash2 className='h-3.5 w-3.5 text-destructive' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Main>

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) { setDialogOpen(false); setEditing(null) } }}>
        <DialogContent className='sm:max-w-[480px]'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Expense Category' : 'New Expense Category'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='grid gap-2'>
              <Label>Name <span className='text-destructive'>*</span></Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }))}
                placeholder='e.g. Office Supplies'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Slug <span className='text-destructive'>*</span></Label>
              <Input
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                placeholder='office-supplies'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder='Brief description of this category...'
                rows={2}
              />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>Color</Label>
                <div className='flex items-center gap-2'>
                  <input
                    type='color'
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className='h-9 w-9 rounded border cursor-pointer bg-transparent'
                  />
                  <Input
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className='font-mono text-xs'
                  />
                </div>
              </div>
              <div className='grid gap-2'>
                <Label>Sort Order</Label>
                <Input
                  type='number'
                  min={0}
                  value={form.sortOrder}
                  onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setDialogOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.slug || createMut.isPending || updateMut.isPending}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader><DialogTitle>Delete Category</DialogTitle></DialogHeader>
          <p className='text-sm text-muted-foreground'>
            {deleteTarget?._count?.expenses
              ? `Cannot delete "${deleteTarget.name}": ${deleteTarget._count.expenses} expense(s) use this category.`
              : `Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            {(!deleteTarget?._count?.expenses) && (
              <Button variant='destructive' onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} disabled={deleteMut.isPending}>
                {deleteMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
                Delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
