import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useDepartmentsQuery, useDepartmentMutations } from './hooks'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { DepartmentResponse } from './api'

export default function DepartmentsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: string } | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActiveField, setIsActiveField] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading } = useDepartmentsQuery()
  const { createDepartment, updateDepartment, deleteDepartment } = useDepartmentMutations()

  function openCreate() {
    setName('')
    setDescription('')
    setIsActiveField(true)
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(department: DepartmentResponse) {
    setEditing({ id: department.id })
    setName(department.name)
    setDescription(department.description || '')
    setIsActiveField(department.isActive)
    setDialogOpen(true)
  }

  function handleSave() {
    const payload: { name: string; description?: string; isActive: boolean } = {
      name,
      description: description || undefined,
      isActive: isActiveField,
    }
    if (!name) return

    if (editing) {
      updateDepartment.mutate({ id: editing.id, data: payload })
    } else {
      createDepartment.mutate(payload)
    }
    setDialogOpen(false)
    setEditing(null)
  }

  const listData = data?.data || []

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Departments</h2>
            <p className='text-muted-foreground'>Manage departments for employees.</p>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Department
          </Button>
        </div>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
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
                      No departments found
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.map(department => (
                    <TableRow key={department.id}>
                      <TableCell className='font-medium'>{department.name}</TableCell>
                      <TableCell className='text-muted-foreground'>{department.slug}</TableCell>
                      <TableCell className='text-muted-foreground max-w-[240px] truncate'>
                        {department.description || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={department.isActive ? 'default' : 'secondary'}>
                          {department.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {new Date(department.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(department)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(department)}>
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
      </Main>

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) { setDialogOpen(false); setEditing(null) } }}>
        <DialogContent className='sm:max-w-[450px]'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Department' : 'Create Department'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder='e.g. Engineering' />
            </div>
            <div className='grid gap-2'>
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder='Optional description' />
            </div>
            <div className='flex items-center gap-2'>
              <input
                type='checkbox'
                id='is-active-field'
                className='h-4 w-4 rounded border-input'
                checked={isActiveField}
                onChange={e => setIsActiveField(e.target.checked)}
              />
              <Label htmlFor='is-active-field'>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setDialogOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name || createDepartment.isPending || updateDepartment.isPending}>
              {editing ? 'Save Changes' : 'Create Department'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Department</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => deleteTarget && deleteDepartment.mutate(deleteTarget.id)} disabled={deleteDepartment.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}