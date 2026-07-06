import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAccessPresetsQuery, useAccessPresetMutations } from './hooks'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { PermissionCheckboxMatrix } from '@/components/permissions/PermissionCheckboxMatrix'

export default function AccessPresetsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string; description: string; permissions: string[] } | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading } = useAccessPresetsQuery(page, search || undefined)
  const { createPreset, updatePreset, deletePreset } = useAccessPresetMutations()

  function openCreate() {
    setName('')
    setDescription('')
    setPermissions([])
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(preset: { id: string; name: string; description: string | null; permissions: string[] }) {
    setEditing({ id: preset.id, name: preset.name, description: preset.description || '', permissions: preset.permissions })
    setName(preset.name)
    setDescription(preset.description || '')
    setPermissions(preset.permissions)
    setDialogOpen(true)
  }

  function handleSave() {
    if (editing) {
      updatePreset.mutate({ id: editing.id, data: { name, description: description || undefined, permissions } })
    } else {
      createPreset.mutate({ name, description: description || undefined, permissions })
    }
    setDialogOpen(false)
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  const listData = data?.data || []
  const totalPages = data?.meta?.totalPages || 1

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
            <h2 className='text-2xl font-bold tracking-tight'>Access Presets</h2>
            <p className='text-muted-foreground'>Manage permission templates for employee roles.</p>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> Add Preset
          </Button>
        </div>

        <form onSubmit={handleSearchSubmit} className='flex gap-2'>
          <div className='relative max-w-sm'>
            <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search presets...'
              className='pl-8'
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
          </div>
        </form>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className='text-center'>Permissions</TableHead>
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
                      No access presets found
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.map(preset => (
                    <TableRow key={preset.id}>
                      <TableCell className='font-medium'>{preset.name}</TableCell>
                      <TableCell className='text-muted-foreground'>{preset.description || '—'}</TableCell>
                      <TableCell className='text-center'>{preset.permissions.length}</TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(preset)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(preset)}>
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
        <DialogContent className='sm:max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Access Preset' : 'Create Access Preset'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder='e.g. Manager' />
            </div>
            <div className='grid gap-2'>
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder='Optional description' />
            </div>
            <div className='grid gap-2'>
              <Label>Permissions</Label>
              <PermissionCheckboxMatrix selected={permissions} onChange={setPermissions} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setDialogOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name || createPreset.isPending || updatePreset.isPending}>
              {editing ? 'Save Changes' : 'Create Preset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Access Preset</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => deleteTarget && deletePreset.mutate(deleteTarget.id)} disabled={deletePreset.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
