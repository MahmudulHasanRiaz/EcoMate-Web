import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, Trash2, Copy, Check, Loader2, ImageIcon, Film, X, Search } from 'lucide-react'
import { mediaApi, uploadApi, mediaUrl, type MediaResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function Media() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [attachFilter, setAttachFilter] = useState<string>('')
  const [selected, setSelected] = useState<MediaResponse | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['media', page, search, typeFilter, attachFilter],
    queryFn: () => mediaApi.list({ page, perPage: 24, search: search || undefined, type: typeFilter || undefined, attached: attachFilter || undefined }).then(r => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => mediaApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media'] }); setDeleteTarget(null); toast.success('Deleted'); },
  })

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadApi.file(files[i]);
      } catch { toast.error(`Failed: ${files[i].name}`); }
    }
    queryClient.invalidateQueries({ queryKey: ['media'] });
    toast.success(`${files.length} file(s) uploaded`);
    e.target.value = '';
  }, [queryClient])

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(mediaUrl(url));
    setCopied(id); setTimeout(() => setCopied(null), 2000);
  }

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

  return (
    <>
      <Header fixed>
        <div className='me-auto flex items-center gap-2 w-80'>
          <Search className='h-4 w-4 text-muted-foreground shrink-0' />
          <Input
            placeholder='Search files...'
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className='border-0 shadow-none bg-transparent'
          />
        </div>
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Media Gallery</h2>
            <p className='text-muted-foreground'>{data?.meta?.total || 0} files</p>
          </div>
          <div className='flex items-center gap-2'>
            <div className='flex gap-1 border rounded-md p-0.5'>
              {[{ label: 'All', value: '' }, { label: 'Images', value: 'image' }, { label: 'Videos', value: 'video' }].map(f => (
                <Button key={f.value} variant={typeFilter === f.value ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setTypeFilter(f.value)}>
                  {f.label}
                </Button>
              ))}
            </div>
            <div className='flex gap-1 border rounded-md p-0.5'>
              {[{ label: 'All', value: '' }, { label: 'Attached', value: 'yes' }, { label: 'Unattached', value: 'no' }].map(f => (
                <Button key={f.value} variant={attachFilter === f.value ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setAttachFilter(f.value)}>
                  {f.label}
                </Button>
              ))}
            </div>
            <label className='cursor-pointer'>
              <Button asChild><span><Upload className='h-4 w-4 mr-1' />Upload</span></Button>
              <input type='file' accept='image/*,video/*' multiple onChange={handleUpload} className='hidden' />
            </label>
          </div>
        </div>

        {isLoading ? (
          <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
        ) : data?.data?.length ? (
          <>
            <div className='grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2'>
              {data.data.map(m => (
                <div
                  key={m.id}
                  className={`group relative aspect-square rounded-lg border-2 overflow-hidden bg-muted/30 cursor-pointer transition-all ${selected?.id === m.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
                  onClick={() => setSelected(selected?.id === m.id ? null : m)}
                >
                  {m.mimeType.startsWith('image/') ? (
                    <img src={mediaUrl(m.url)} alt={m.filename} className='w-full h-full object-cover' loading='lazy' />
                  ) : (
                    <div className='w-full h-full flex items-center justify-center'><Film className='h-8 w-8 text-muted-foreground' /></div>
                  )}
                  <div className='absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors' />
                  {(m._count?.attachments ?? 0) > 0 && (
                    <Badge className='absolute bottom-1 left-1 text-xs bg-primary/80'>{m._count?.attachments}</Badge>
                  )}
                  {selected?.id === m.id && (
                    <div className='absolute top-1 right-1'>
                      <Button variant='secondary' size='icon' className='h-6 w-6 rounded-full' onClick={(e) => { e.stopPropagation(); deleteMut.mutate(m.id); }}>
                        <Trash2 className='h-3 w-3 text-destructive' />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {data.meta.totalPages > 1 && (
              <div className='flex items-center justify-between pt-2'>
                <span className='text-sm text-muted-foreground'>Page {page} of {data.meta.totalPages}</span>
                <div className='flex gap-2'>
                  <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant='outline' size='sm' disabled={page >= data.meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className='flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg'>
            <ImageIcon className='h-12 w-12 text-muted-foreground mb-3' />
            <p className='text-muted-foreground'>No media files yet</p>
            <label className='cursor-pointer mt-3'>
              <Button variant='outline' asChild><span><Upload className='h-4 w-4 mr-1' />Upload Files</span></Button>
              <input type='file' accept='image/*,video/*' multiple onChange={handleUpload} className='hidden' />
            </label>
          </div>
        )}

        {selected && (
          <div className='fixed bottom-4 left-1/2 -translate-x-1/2 bg-background border rounded-lg shadow-lg px-4 py-3 flex items-center gap-4 z-50'>
            <img src={mediaUrl(selected.url)} alt='' className='h-10 w-10 rounded object-cover' />
            <div className='min-w-0'>
              <p className='text-sm font-medium truncate max-w-48'>{selected.filename}</p>
              <p className='text-xs text-muted-foreground'>{formatSize(selected.size)} - {selected.mimeType}</p>
            </div>
            <Button variant='outline' size='sm' onClick={() => copyUrl(selected.url, selected.id)}>
              {copied === selected.id ? <Check className='h-3.5 w-3.5 mr-1 text-green-600' /> : <Copy className='h-3.5 w-3.5 mr-1' />}
              {copied === selected.id ? 'Copied' : 'Copy URL'}
            </Button>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => { setDeleteTarget(selected); setSelected(null); }}>
              <Trash2 className='h-4 w-4 text-destructive' />
            </Button>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setSelected(null)}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        )}
      </Main>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} title='Delete Media' desc={`Delete "${deleteTarget?.filename}"?`} confirmText='Delete' destructive handleConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} />
    </>
  )
}
