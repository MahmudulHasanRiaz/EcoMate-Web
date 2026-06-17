import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cmsPagesApi, CmsPage, CreateCmsPageInput } from './cms-pages-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, Save, Plus, Pencil, Trash2, FileText, ExternalLink } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

const emptyForm: CreateCmsPageInput = {
  slug: '',
  title: '',
  content: '',
  isActive: true,
  showInFooter: false,
  sortOrder: 0,
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function CmsPagesSettings() {
  const queryClient = useQueryClient()
  const { data: pages = [], isLoading } = useQuery({
    queryKey: ['cms-pages'],
    queryFn: () => cmsPagesApi.list(),
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<CreateCmsPageInput>(emptyForm)
  const [autoSlug, setAutoSlug] = useState(true)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const createMut = useMutation({
    mutationFn: (data: CreateCmsPageInput) => cmsPagesApi.create(data),
    onSuccess: () => {
      toast.success('Page created')
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] })
      setDrawerOpen(false)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create page'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateCmsPageInput> }) =>
      cmsPagesApi.update(id, data),
    onSuccess: () => {
      toast.success('Page updated')
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] })
      setDrawerOpen(false)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update page'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => cmsPagesApi.remove(id),
    onSuccess: () => {
      toast.success('Page deleted')
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] })
      setDeleteId(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to delete page'),
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setAutoSlug(true)
    setDrawerOpen(true)
  }

  const openEdit = (page: CmsPage) => {
    setEditingId(page.id)
    setForm({
      slug: page.slug,
      title: page.title,
      content: page.content,
      isActive: page.isActive,
      showInFooter: page.showInFooter,
      sortOrder: page.sortOrder,
    })
    setAutoSlug(false)
    setDrawerOpen(true)
  }

  const handleSave = () => {
    if (!form.slug.trim() || !form.title.trim() || !form.content.trim()) {
      toast.error('Slug, title, and content are required')
      return
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>CMS Pages</h2>
        <p className='text-muted-foreground'>
          Manage content pages such as Terms &amp; Conditions, Privacy Policy, Refunds, and About. Pages
          marked as &quot;Show in Footer&quot; appear in the storefront footer automatically.
        </p>
      </div>
      <Separator className='my-6' />

      <Card>
        <CardHeader>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <CardTitle className='flex items-center gap-2'><FileText className='h-5 w-5' /> Pages</CardTitle>
              <CardDescription>All custom content pages. Public URL: <code className='bg-muted px-1 rounded'>/pages/&lt;slug&gt;</code></CardDescription>
            </div>
            <Button onClick={openCreate}>
              <Plus className='h-4 w-4 mr-1' /> New Page
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='flex items-center justify-center min-h-[200px]'><Loader2 className='animate-spin h-6 w-6 text-primary' /></div>
          ) : pages.length === 0 ? (
            <div className='text-center py-10 text-muted-foreground border border-dashed rounded-lg'>
              <FileText className='h-10 w-10 mx-auto mb-2 opacity-50' />
              <p>No pages yet. Click &quot;New Page&quot; to create your first one.</p>
            </div>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead className='w-[80px] text-center'>Footer</TableHead>
                    <TableHead className='w-[80px] text-center'>Active</TableHead>
                    <TableHead className='w-[120px] text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className='font-medium'>{p.title}</TableCell>
                      <TableCell>
                        <code className='text-xs bg-muted px-1.5 py-0.5 rounded'>{p.slug}</code>
                      </TableCell>
                      <TableCell className='text-center'>
                        {p.showInFooter ? <span className='text-green-600 text-xs font-medium'>Yes</span> : <span className='text-muted-foreground text-xs'>—</span>}
                      </TableCell>
                      <TableCell className='text-center'>
                        {p.isActive ? <span className='text-green-600 text-xs font-medium'>Yes</span> : <span className='text-muted-foreground text-xs'>No</span>}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-1'>
                          {p.isActive && (
                            <a
                              href={`/pages/${p.slug}`}
                              target='_blank'
                              rel='noreferrer'
                              className='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                              title='View page'
                            >
                              <ExternalLink className='h-3.5 w-3.5' />
                            </a>
                          )}
                          <Button variant='ghost' size='icon' onClick={() => openEdit(p)} title='Edit'>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' onClick={() => setDeleteId(p.id)} title='Delete' className='text-destructive hover:text-destructive'>
                            <Trash2 className='h-3.5 w-3.5' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className='max-w-5xl w-full max-h-[90vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Page' : 'New Page'}</DialogTitle>
            <DialogDescription>
              Write your page content. HTML is supported (renders as raw HTML on the storefront).
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='page-title'>Title</Label>
                <Input
                  id='page-title'
                  value={form.title}
                  onChange={e => {
                    const v = e.target.value
                    setForm(f => ({
                      ...f,
                      title: v,
                      slug: autoSlug && !editingId ? slugify(v) : f.slug,
                    }))
                  }}
                  placeholder='Terms & Conditions'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='page-slug'>Slug</Label>
                <Input
                  id='page-slug'
                  value={form.slug}
                  onChange={e => {
                    setAutoSlug(false)
                    setForm(f => ({ ...f, slug: slugify(e.target.value) }))
                  }}
                  placeholder='terms-and-conditions'
                />
                <p className='text-xs text-muted-foreground'>URL: <code>/pages/{form.slug || '...'}</code></p>
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='page-content'>Content</Label>
              <RichTextEditor
                value={form.content}
                onChange={content => setForm(f => ({ ...f, content }))}
                placeholder='<h2>Terms & Conditions</h2><p>Your content here...</p>'
              />
            </div>
            <div className='grid gap-4 md:grid-cols-3'>
              <div className='flex items-center justify-between p-3 border rounded-lg'>
                <div>
                  <Label className='text-sm font-medium'>Active</Label>
                  <p className='text-xs text-muted-foreground'>Visible to the public</p>
                </div>
                <Switch
                  checked={form.isActive ?? true}
                  onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                />
              </div>
              <div className='flex items-center justify-between p-3 border rounded-lg'>
                <div>
                  <Label className='text-sm font-medium'>Show in Footer</Label>
                  <p className='text-xs text-muted-foreground'>Display a link</p>
                </div>
                <Switch
                  checked={form.showInFooter ?? false}
                  onCheckedChange={v => setForm(f => ({ ...f, showInFooter: v }))}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='page-sort'>Sort Order</Label>
                <Input
                  id='page-sort'
                  type='number'
                  value={form.sortOrder ?? 0}
                  onChange={e => setForm(f => ({ ...f, sortOrder: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
              {editingId ? 'Update Page' : 'Create Page'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this page?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the page. Anyone with the URL will see a 404. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMut.mutate(deleteId)}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {deleteMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
