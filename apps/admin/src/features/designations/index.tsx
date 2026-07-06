import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useDesignationsQuery, useDesignationMutations } from './hooks'
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

export default function DesignationsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string; level: number } | null>(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading } = useDesignationsQuery()
  const { createDesignation, updateDesignation, deleteDesignation } = useDesignationMutations()

  function openCreate() {
    setName('')
    setLevel('')
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(designation: { id: string; name: string; level: number }) {
    setEditing({ id: designation.id, name: designation.name, level: designation.level })
    setName(designation.name)
    setLevel(String(designation.level))
    setDialogOpen(true)
  }

  function handleSave() {
    const payload: { name: string; level?: number } = { name }
    if (level) payload.level = Number(level)

    if (editing) {
      updateDesignation.mutate({ id: editing.id, data: payload })
    } else {
      createDesignation.mutate(payload)
    }
    setDialogOpen(false)
  }

  const listData = data || []

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
            <h2 className='text-2xl font-bold tracking-tight'>Designations</h2>
            <p className='text-muted-foreground'>Manage job designations for employees.</p>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Designation
          </Button>
        </div>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-[80px]'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto text-muted-foreground' />
                    </TableCell>
                  </TableRow>
                ) : listData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className='text-center py-8 text-muted-foreground'>
                      No designations found
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.map(designation => (
                    <TableRow key={designation.id}>
                      <TableCell className='font-medium'>{designation.name}</TableCell>
                      <TableCell>{designation.level}</TableCell>
                      <TableCell>
                        <Badge variant={designation.isActive ? 'success' : 'secondary'}>
                          {designation.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(designation)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(designation)}>
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
            <DialogTitle>{editing ? 'Edit Designation' : 'Create Designation'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder='e.g. Senior Developer' />
            </div>
            <div className='grid gap-2'>
              <Label>Level</Label>
              <Input type='number' min={0} value={level} onChange={e => setLevel(e.target.value)} placeholder='0' />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setDialogOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name || createDesignation.isPending || updateDesignation.isPending}>
              {editing ? 'Save Changes' : 'Create Designation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Designation</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => deleteTarget && deleteDesignation.mutate(deleteTarget.id)} disabled={deleteDesignation.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
