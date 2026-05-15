import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, Trash2, Copy, Check, Loader2, ImageIcon, Film, X, Search, Link2, ExternalLink } from 'lucide-react'
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
import { Link } from '@tanstack/react-router'

export function Media() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [attachFilter, setAttachFilter] = useState<string>('')
  const [selected, setSelected] = useState<MediaResponse | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MediaResponse | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const { data: attachDetails } = useQuery({
    queryKey: ['media', 'attachments', selected?.id],
    queryFn: () => selected ? mediaApi.getAttachments(selected.id).then(r => r.data) : null,
    enabled: !!selected,
  })

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
                  onClick={() => {
                    if (selected?.id === m.id) { setSelected(null); setDetailOpen(false); }
                    else { setSelected(m); setDetailOpen(true); }
                  }}
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
          <>
            {detailOpen && (
              <div className='fixed inset-0 z-40 bg-black/40' onClick={() => { setDetailOpen(false); setSelected(null); }} />
            )}
            <div className={`fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-2xl transition-all duration-300 ${detailOpen ? 'h-80' : 'h-auto'}`}>
              <div className='max-w-7xl mx-auto px-6 py-3 flex items-start gap-6'>
                <button className='absolute top-2 right-4 text-muted-foreground hover:text-foreground' onClick={() => { setDetailOpen(false); setSelected(null); }}>
                  <X className='h-5 w-5' />
                </button>

                <div className='shrink-0'>
                  {selected.mimeType.startsWith('image/') ? (
                    <img src={mediaUrl(selected.url)} alt='' className='h-20 w-20 rounded-lg object-cover border' />
                  ) : (
                    <div className='h-20 w-20 rounded-lg border bg-muted flex items-center justify-center'><Film className='h-8 w-8 text-muted-foreground' /></div>
                  )}
                </div>

                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-3 mb-3'>
                    <div>
                      <h3 className='font-medium truncate'>{selected.filename}</h3>
                      <p className='text-xs text-muted-foreground'>{formatSize(selected.size)} · {selected.mimeType} · {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : ''}</p>
                    </div>
                    <div className='flex gap-1.5 ml-auto'>
                      <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => copyUrl(selected.url, selected.id)}>
                        {copied === selected.id ? <Check className='h-3 w-3 mr-1 text-green-600' /> : <Copy className='h-3 w-3 mr-1' />}
                        {copied === selected.id ? 'Copied' : 'Copy URL'}
                      </Button>
                      <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => { setDetailOpen(!detailOpen); }}>
                        <Link2 className='h-3 w-3 mr-1' />
                        Attachments ({attachDetails?.length || selected._count?.attachments || 0})
                      </Button>
                      <Button variant='ghost' size='sm' className='h-7 text-xs text-destructive hover:text-destructive' onClick={() => { setDeleteTarget(selected); setSelected(null); setDetailOpen(false); }}>
                        <Trash2 className='h-3 w-3 mr-1' /> Delete
                      </Button>
                    </div>
                  </div>

                  {detailOpen && (
                    <div className='overflow-y-auto max-h-52'>
                      <h4 className='text-xs font-medium text-muted-foreground mb-2'>ATTACHED TO</h4>
                      {!attachDetails || attachDetails.length === 0 ? (
                        <p className='text-sm text-muted-foreground py-4'>Not attached anywhere. This media can be safely deleted.</p>
                      ) : (
                        <div className='space-y-1'>
                          {attachDetails.map((att, i) => (
                            <div key={i} className='flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50'>
                              <Badge variant='outline' className='text-xs capitalize'>{att.entityType}</Badge>
                              <span className='flex-1 truncate'>{att.entityName}</span>
                              {att.entityType === 'product' && (
                                <Link to='/products' className='text-xs text-primary hover:underline flex items-center gap-1 shrink-0'>
                                  View <ExternalLink className='h-3 w-3' />
                                </Link>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </Main>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} title='Delete Media' desc={`Delete "${deleteTarget?.filename}"?`} confirmText='Delete' destructive handleConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} />
    </>
  )
}
