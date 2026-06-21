import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, Plus, Pencil, Trash2, Tags as TagsIcon, Merge, Copy, Check } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'

const tagsApi = {
  list: () => apiClient.get('/tags'),
  create: (d: { name: string; slug: string }) => apiClient.post('/tags', d),
  update: (id: string, d: { name?: string; slug?: string }) => apiClient.put(`/tags/${id}`, d),
  delete: (id: string) => apiClient.delete(`/tags/${id}`),
  bulkDelete: (ids: string[]) => apiClient.post('/tags/bulk-delete', { ids }),
  merge: (keepId: string, removeId: string) => apiClient.post('/tags/merge', { keepId, removeId }),
}

interface TagItem {
  id: string
  name: string
  slug: string
  productCount: number
  _count?: { products: number }
}

const getStorefrontUrl = () => {
  if (typeof window === 'undefined') return ''
  const { hostname, protocol } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3000'
  }
  if (hostname.startsWith('admin.')) {
    return `${protocol}//${hostname.substring(6)}`
  }
  return window.location.origin
}

export function Tags() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TagItem | null>(null)
  const [form, setForm] = useState({ name: '', slug: '' })
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeKeep, setMergeKeep] = useState('')
  const [mergeRemove, setMergeRemove] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data: tags, isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list().then(r => r.data),
  })

  const list: TagItem[] = Array.isArray(tags) ? tags : (tags as { data?: TagItem[] })?.data || []

  const filtered = list.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase())
  )

  const saveMut = useMutation({
    mutationFn: (d: { name: string; slug: string }) =>
      editing ? tagsApi.update(editing.id, d) : tagsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setOpen(false)
      setEditing(null)
      setForm({ name: '', slug: '' })
      toast.success(editing ? 'Tag updated' : 'Tag created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => tagsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setSelectedIds(prev => prev.filter(i => i !== deleteConfirm))
      setDeleteConfirm(null)
      toast.success('Tag deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => tagsApi.bulkDelete(ids),
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setSelectedIds([])
      toast.success(`${ids.length} tags deleted`)
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const mergeMut = useMutation({
    mutationFn: (d: { keepId: string; removeId: string }) => tagsApi.merge(d.keepId, d.removeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setMergeOpen(false)
      setMergeKeep('')
      setMergeRemove('')
      toast.success('Tags merged')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const openEdit = (tag: TagItem) => {
    setEditing(tag)
    setForm({ name: tag.name, slug: tag.slug })
    setOpen(true)
  }

  const handleSave = () => {
    if (!form.name.trim()) return
    saveMut.mutate({
      name: form.name.trim(),
      slug: form.slug.trim() || form.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map(t => t.id))
    }
  }

  const getProductCount = (t: TagItem) =>
    t._count?.products ?? t.productCount ?? 0

  const copyTagLink = (slug: string, id: string) => {
    const storefrontUrl = getStorefrontUrl()
    navigator.clipboard.writeText(`${storefrontUrl}/products/tags/${slug}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 me-auto'>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search tags...' className='h-8 w-48 lg:w-64' />
        </div>
        <ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Tags</h2><p className='text-muted-foreground'>Manage product tags.</p></div>
          <div className='flex gap-2'>
            {selectedIds.length >= 2 && (
              <Button variant='outline' size='sm' onClick={() => { setMergeKeep(''); setMergeRemove(''); setMergeOpen(true) }}>
                <Merge className='h-4 w-4 mr-1' /> Merge ({selectedIds.length})
              </Button>
            )}
            {selectedIds.length > 0 && (
              <Button variant='destructive' size='sm' onClick={() => bulkDeleteMut.mutate(selectedIds)}>
                <Trash2 className='h-4 w-4 mr-1' /> Delete ({selectedIds.length})
              </Button>
            )}
            <Button size='sm' onClick={() => { setEditing(null); setForm({ name: '', slug: '' }); setOpen(true) }}>
              <Plus className='h-4 w-4 mr-1' /> Add Tag
            </Button>
          </div>
        </div>

        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.length === filtered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Link</TableHead>
                <TableHead className='text-center'>Products</TableHead>
                <TableHead className='w-20'></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
              ) : filtered.length ? filtered.map((t: TagItem) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Checkbox checked={selectedIds.includes(t.id)} onCheckedChange={() => toggleSelect(t.id)} />
                  </TableCell>
                  <TableCell className='font-medium'>
                    <div className='flex items-center gap-2'>
                      <TagsIcon className='h-4 w-4 text-muted-foreground' />
                      {t.name}
                    </div>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{t.slug}</TableCell>
                  <TableCell>
                    <Button variant='ghost' size='sm' className='h-7 text-xs gap-1 px-2' onClick={() => copyTagLink(t.slug, t.id)}>
                      {copiedId === t.id ? <Check className='h-3 w-3 text-green-500' /> : <Copy className='h-3 w-3' />}
                      <span className='text-muted-foreground'>/{t.slug}</span>
                    </Button>
                  </TableCell>
                  <TableCell className='text-center'>
                    <Badge variant='outline'>{getProductCount(t)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className='flex gap-1'>
                      <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(t)}>
                        <Pencil className='h-3.5 w-3.5' />
                      </Button>
                      <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteConfirm(t.id)}>
                        <Trash2 className='h-3.5 w-3.5 text-destructive' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>No tags found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Main>

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Tag' : 'New Tag'}</DialogTitle></DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='space-y-1.5'>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => {
                  setForm({
                    name: e.target.value,
                    slug: editing ? form.slug : e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
                  })
                }}
                placeholder='e.g. Summer Collection'
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder='summer-collection' />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Tag</DialogTitle></DialogHeader>
          <p className='text-sm text-muted-foreground'>Are you sure you want to delete this tag? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge Tags</DialogTitle></DialogHeader>
          <div className='space-y-4 py-2'>
            <p className='text-sm text-muted-foreground'>Merge products from the "Remove" tag into the "Keep" tag. The "Remove" tag will be deleted.</p>
            <div className='space-y-1.5'>
              <Label>Keep Tag</Label>
              <select
                className='w-full rounded-md border px-3 py-2 text-sm bg-background'
                value={mergeKeep}
                onChange={e => setMergeKeep(e.target.value)}
              >
                <option value=''>Select tag to keep...</option>
                {list.filter(t => t.id !== mergeRemove).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({getProductCount(t)} products)</option>
                ))}
              </select>
            </div>
            <div className='space-y-1.5'>
              <Label>Remove Tag</Label>
              <select
                className='w-full rounded-md border px-3 py-2 text-sm bg-background'
                value={mergeRemove}
                onChange={e => setMergeRemove(e.target.value)}
              >
                <option value=''>Select tag to remove...</option>
                {list.filter(t => t.id !== mergeKeep).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({getProductCount(t)} products)</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setMergeOpen(false); setMergeKeep(''); setMergeRemove('') }}>Cancel</Button>
            <Button onClick={() => mergeMut.mutate({ keepId: mergeKeep, removeId: mergeRemove })} disabled={!mergeKeep || !mergeRemove}>
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
