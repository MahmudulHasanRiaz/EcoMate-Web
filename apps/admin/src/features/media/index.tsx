import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { Upload, Trash2, Copy, Check, Loader2, ImageIcon, Film, X, Search, Link2, ExternalLink, RefreshCw } from 'lucide-react'
import { SafeImage } from '@/components/safe-image'
import { mediaApi, uploadApi, mediaUrl, type MediaResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Link } from '@tanstack/react-router'

type PendingUpload = {
  id: string
  name: string
  status: 'uploading' | 'done' | 'error'
  error?: string
}

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
  const [dragActive, setDragActive] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [pending, setPending] = useState<PendingUpload[]>([])
  const dropRef = useRef<HTMLDivElement | null>(null)
  const masterRef = useRef<HTMLInputElement>(null)
  const fileInputId = useRef(`media-input-${Math.random().toString(36).slice(2)}`)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const gridGapPx = 8

  // Measure the always-present dropzone so the column count tracks the real
  // content width even before data loads. (Previously the observer was bound to
  // the virtual grid, which only mounts after fetch — gridWidth stayed 0 and the
  // gallery froze at 2 tiny columns while the rest of the row sat empty.)
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const measure = () =>
      setGridWidth(el.clientWidth || el.getBoundingClientRect().width)
    measure()
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGridWidth(entry.contentRect.width || entry.target.clientWidth)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['media', page, search, typeFilter, attachFilter],
    queryFn: () => mediaApi.list({ page, perPage: 48, search: search || undefined, type: typeFilter || undefined, attached: attachFilter || undefined }).then(r => r.data),
  })

  // Fall back to the viewport for the very first paint so a container that is
  // measured only after the effect runs never renders at 2 columns by default.
  const effectiveWidth =
    gridWidth ||
    (typeof window !== 'undefined' ? window.innerWidth : 0)
  const columns = effectiveWidth < 480 ? 2 : effectiveWidth < 640 ? 3 : effectiveWidth < 768 ? 4 : effectiveWidth < 1024 ? 6 : effectiveWidth < 1536 ? 8 : 10
  const items = data?.data ?? []
  const rowCount = items.length ? Math.ceil(items.length / columns) : 0
  const estimatedItemSize = effectiveWidth > 0
    ? Math.max(64, Math.floor((effectiveWidth - (columns - 1) * gridGapPx - 4) / columns))
    : 120

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridContainerRef.current,
    estimateSize: () => estimatedItemSize + gridGapPx,
    overscan: 2,
  })

  // Re-measure virtual rows whenever the container width or column count changes.
  useEffect(() => {
    virtualizer.measure()
  }, [gridWidth, columns, virtualizer])

  const { data: attachDetails } = useQuery({
    queryKey: ['media', 'attachments', selected?.id],
    queryFn: () => selected ? mediaApi.getAttachments(selected.id).then(r => r.data) : null,
    enabled: !!selected,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => mediaApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media'] }); setDeleteTarget(null); toast.success('Deleted'); },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message
      toast.error(message || 'Delete failed')
    },
  })

  const migrateMut = useMutation({
    mutationFn: () => mediaApi.migrateOrphans().then(r => r.data),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['media'] })
      toast.success(`Scanned ${d.scanned} · migrated ${d.migrated} · failed ${d.failed}`)
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message
      toast.error(message || 'Migration failed')
    },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => mediaApi.bulkDelete(ids).then(r => r.data),
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['media'] })
      setSelectedIds(new Set())
      setBulkDeleteOpen(false)
      if (d.failed > 0) {
        toast.warning(`Deleted ${d.succeeded}, ${d.failed} failed`)
      } else {
        toast.success(`Deleted ${d.succeeded} file${d.succeeded === 1 ? '' : 's'}`)
      }
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message
      toast.error(message || 'Bulk delete failed')
    },
  })

  const ingestFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      const entries: PendingUpload[] = files.map((f) => ({
        id: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`,
        name: f.name,
        status: 'uploading' as const,
      }))
      setPending((prev) => [...prev, ...entries])
      await Promise.all(
        files.map(async (file, i) => {
          const entry = entries[i]
          try {
            await uploadApi.file(file)
            setPending((prev) =>
              prev.map((p) => (p.id === entry.id ? { ...p, status: 'done' } : p)),
            )
          } catch (err: unknown) {
            const message =
              (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
              (err as Error)?.message
            setPending((prev) =>
              prev.map((p) =>
                p.id === entry.id ? { ...p, status: 'error', error: message || 'Failed' } : p,
              ),
            )
          }
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['media'] })
      window.setTimeout(() => {
        setPending((prev) => prev.filter((p) => p.status === 'uploading' || p.status === 'error'))
      }, 5000)
    },
    [queryClient],
  )

  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      await ingestFiles(Array.from(files))
      e.target.value = ''
    },
    [ingestFiles],
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (e.currentTarget === dropRef.current) setDragActive(false)
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) await ingestFiles(files)
  }

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) await ingestFiles(files)
    },
    [ingestFiles],
  )
  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        if (isInput) return
        e.preventDefault()
        if (data?.data?.length) {
          setSelectedIds(prev => {
            const next = new Set(prev)
            data.data.forEach(m => next.add(m.id))
            return next
          })
        }
      }
      if (e.key === 'Escape') {
        if (isInput) return
        setSelectedIds(new Set())
        setLastClickedIndex(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [data?.data])

  const pageItemIds = data?.data?.map(m => m.id) ?? []
  const allSelected = pageItemIds.length > 0 && pageItemIds.every(id => selectedIds.has(id))
  const someSelected = pageItemIds.some(id => selectedIds.has(id))

  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  const handleUrlImport = async () => {
    const url = urlInput.trim()
    if (!url) return
    setUrlBusy(true)
    try {
      await uploadApi.fromUrl(url)
      toast.success('Imported to library')
      setUrlInput('')
      queryClient.invalidateQueries({ queryKey: ['media'] })
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message
      toast.error(message || 'Import failed')
    } finally {
      setUrlBusy(false)
    }
  }

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(mediaUrl(url))
    setCopied(id); setTimeout(() => setCopied(null), 2000)
  }

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

  return (
    <>
      <Header fixed>
        <div className='me-auto flex items-center gap-2 min-w-0 w-full max-w-sm md:w-80 lg:w-96'>
          <Search className='h-4 w-4 text-muted-foreground shrink-0' />
          <Input
            placeholder='Search files...'
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); setLastClickedIndex(null); }}
            className='border-0 shadow-none bg-transparent min-w-0'
          />
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex flex-col md:flex-row md:items-end justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Media Gallery</h2>
            <p className='text-muted-foreground'>{data?.meta?.total || 0} files</p>
          </div>
          <div className='flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin'>
            <div className='flex gap-1 border rounded-md p-0.5 shrink-0'>
              {[{ label: 'All', value: '' }, { label: 'Images', value: 'image' }, { label: 'Videos', value: 'video' }].map(f => (
                <Button key={f.value} variant={typeFilter === f.value ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => { setTypeFilter(f.value); setLastClickedIndex(null); }}>
                  {f.label}
                </Button>
              ))}
            </div>
            <div className='flex gap-1 border rounded-md p-0.5 shrink-0'>
              {[{ label: 'All', value: '' }, { label: 'Attached', value: 'yes' }, { label: 'Unattached', value: 'no' }].map(f => (
                <Button key={f.value} variant={attachFilter === f.value ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => { setAttachFilter(f.value); setLastClickedIndex(null); }}>
                  {f.label}
                </Button>
              ))}
            </div>
            <div className='flex items-center gap-1 shrink-0'>
              <div className='relative'>
                <Link2 className='absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground' />
                <Input
                  placeholder='Import URL...'
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleUrlImport()
                    }
                  }}
                  className='pl-8 h-8 text-sm w-40 md:w-52'
                  disabled={urlBusy}
                />
              </div>
              <Button variant='outline' size='sm' onClick={handleUrlImport} disabled={!urlInput.trim() || urlBusy}>
                {urlBusy ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : 'Fetch'}
              </Button>
            </div>
            <Button
              variant='outline'
              size='sm'
              className='shrink-0'
              onClick={() => migrateMut.mutate()}
              disabled={migrateMut.isPending}
            >
              {migrateMut.isPending ? <Loader2 className='h-3.5 w-3.5 mr-1 animate-spin' /> : <RefreshCw className='h-3.5 w-3.5 mr-1' />}
              <span className='hidden sm:inline'>Migrate Orphans</span>
              <span className='sm:hidden'>Migrate</span>
            </Button>
            <label htmlFor={fileInputId.current} className='cursor-pointer shrink-0'>
              <Button asChild size='sm'>
                <span>
                  <Upload className='h-4 w-4 mr-1' />
                  Upload
                </span>
              </Button>
              <input
                id={fileInputId.current}
                type='file'
                accept='image/*,video/*'
                multiple
                onChange={handleInputChange}
                className='hidden'
              />
            </label>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className='flex items-center justify-between bg-primary/5 rounded-lg border px-3 sm:px-4 py-2 sm:py-2.5'>
            <span className='text-sm font-medium'>{selectedIds.size} file{selectedIds.size === 1 ? '' : 's'} selected</span>
            <div className='flex items-center gap-2'>
              <Button variant='ghost' size='sm' onClick={() => { setSelectedIds(new Set()); setLastClickedIndex(null); }}>
                Clear
              </Button>
              <Button variant='destructive' size='sm' onClick={() => setBulkDeleteOpen(true)} disabled={bulkDeleteMut.isPending}>
                <Trash2 className='h-3.5 w-3.5 mr-1' />
                {bulkDeleteMut.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        )}

        <div
          ref={dropRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex-1 rounded-lg border-2 border-dashed transition-colors ${
            dragActive ? 'border-primary bg-primary/5' : 'border-transparent'
          }`}
        >
          {dragActive && (
            <div className='pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-primary rounded-lg'>
              <Upload className='h-10 w-10 mb-2' />
              <p className='font-medium'>Drop files to add to library</p>
            </div>
          )}

          {isLoading ? (
            <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
          ) : data?.data?.length || pending.length ? (
            <div className='flex flex-col h-full'>
              {(data?.data?.length ?? 0) > 0 && (
                <div className='flex items-center gap-2 px-1.5 pt-1 pb-0.5'>
                  <input
                    ref={masterRef}
                    type='checkbox'
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) {
                        setLastClickedIndex(null)
                        setSelectedIds(prev => {
                          const next = new Set(prev)
                          pageItemIds.forEach(id => next.delete(id))
                          return next
                        })
                      } else {
                        setLastClickedIndex(null)
                        setSelectedIds(prev => {
                          const next = new Set(prev)
                          pageItemIds.forEach(id => next.add(id))
                          return next
                        })
                      }
                    }}
                    className='h-4 w-4 rounded cursor-pointer accent-primary'
                  />
                  <span className='text-xs text-muted-foreground truncate'>
                    {allSelected
                      ? `${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'} selected`
                      : someSelected
                        ? `${selectedIds.size} selected — click to select all ${pageItemIds.length}`
                        : `Select all ${pageItemIds.length} item${pageItemIds.length === 1 ? '' : 's'}`
                    }
                  </span>
                </div>
              )}
              {pending.length > 0 && (
                <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 p-1'>
                  {pending.map((p) => (
                    <div
                      key={p.id}
                      className='relative aspect-square rounded-lg border bg-muted/30 flex flex-col items-center justify-center text-xs gap-1 p-2 text-center'
                    >
                      {p.status === 'uploading' ? (
                        <Loader2 className='animate-spin h-5 w-5 text-primary' />
                      ) : p.status === 'error' ? (
                        <X className='h-5 w-5 text-destructive' />
                      ) : (
                        <Check className='h-5 w-5 text-emerald-500' />
                      )}
                      <p className='line-clamp-2 break-all'>{p.name}</p>
                      {p.error && <p className='text-destructive text-[10px]'>{p.error}</p>}
                    </div>
                  ))}
                </div>
              )}
              <div ref={gridContainerRef} className='flex-1 overflow-auto min-h-0 w-full'>
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const rowIdx = virtualRow.index
                    const start = rowIdx * columns
                    const rowItems = items.slice(start, start + columns)
                    return (
                      <div
                        key={virtualRow.key}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                          display: 'grid',
                          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                          columnGap: `${gridGapPx}px`,
                          padding: '0 2px',
                        }}
                      >
                        {rowItems.map((m, colIdx) => {
                          const index = start + colIdx
                          return (
                            <div
                              key={m.id}
                              className={`relative w-full min-w-0 aspect-square rounded-lg border-2 overflow-hidden bg-muted/30 cursor-pointer transition-all group ${selectedIds.has(m.id) ? 'border-primary ring-2 ring-primary/30' : selected?.id === m.id ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
                              onClick={(e) => {
                                if (e.shiftKey) {
                                  e.preventDefault()
                                  const anchor = lastClickedIndex ?? index
                                  const from = Math.min(anchor, index)
                                  const to = Math.max(anchor, index)
                                  setSelectedIds(prev => {
                                    const next = new Set(prev)
                                    for (let i = from; i <= Math.min(to, items.length - 1); i++) next.add(items[i].id)
                                    return next
                                  })
                                  setLastClickedIndex(index)
                                  return
                                }
                                if (e.metaKey || e.ctrlKey) {
                                  e.preventDefault()
                                  setSelectedIds(prev => {
                                    const next = new Set(prev)
                                    if (next.has(m.id)) next.delete(m.id)
                                    else next.add(m.id)
                                    return next
                                  })
                                  setLastClickedIndex(index)
                                  return
                                }
                                setLastClickedIndex(null)
                                if (selected?.id === m.id) { setSelected(null); setDetailOpen(false) }
                                else { setSelected(m); setDetailOpen(true) }
                              }}
                            >
                              <div className='absolute top-1.5 left-1.5 z-10' onClick={e => e.stopPropagation()}>
                                <input
                                  type='checkbox'
                                  checked={selectedIds.has(m.id)}
                                  onChange={() => {
                                    setSelectedIds(prev => {
                                      const next = new Set(prev)
                                      if (next.has(m.id)) next.delete(m.id)
                                      else next.add(m.id)
                                      return next
                                    })
                                    setLastClickedIndex(index)
                                  }}
                                  className='h-4 w-4 rounded cursor-pointer accent-primary'
                                />
                              </div>
                              {m.mimeType.startsWith('image/') ? (
                                <SafeImage src={mediaUrl(m.url)} variant='thumbnail' derivativeManifest={m.derivativeManifest} blurUrl={m.blurUrl} alt={m.alt || m.filename} className='w-full h-full object-cover' />
                              ) : (
                                <div className='w-full h-full flex items-center justify-center'><Film className='h-8 w-8 text-muted-foreground' /></div>
                              )}
                              <div className='absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors' />
                              {(m._count?.attachments ?? 0) > 0 && (
                                <Badge className='absolute bottom-1 left-1 text-xs bg-primary/80'>{m._count?.attachments}</Badge>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>

              {(data?.meta?.totalPages ?? 0) > 1 && (
                <div className='flex items-center justify-between pt-2 px-1'>
                  <span className='text-xs sm:text-sm text-muted-foreground'>Page {page} of {data?.meta?.totalPages ?? 1}</span>
                  <div className='flex gap-2'>
                    <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => { setPage(p => p - 1); setLastClickedIndex(null); }}>
                      <span className='hidden sm:inline'>Previous</span>
                      <span className='sm:hidden'>Prev</span>
                    </Button>
                    <Button variant='outline' size='sm' disabled={page >= (data?.meta?.totalPages ?? 1)} onClick={() => { setPage(p => p + 1); setLastClickedIndex(null); }}>Next</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className='flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg'>
              <ImageIcon className='h-12 w-12 text-muted-foreground mb-3' />
              <p className='text-muted-foreground'>No media files yet</p>
              <p className='text-xs text-muted-foreground mt-1'>Drop files, paste from clipboard, or fetch a URL</p>
              <label className='cursor-pointer mt-3'>
                <Button variant='outline' asChild>
                  <span><Upload className='h-4 w-4 mr-1' />Upload Files</span>
                </Button>
                <input type='file' accept='image/*,video/*' multiple onChange={handleInputChange} className='hidden' />
              </label>
            </div>
          )}
        </div>

        {selected && (
          <>
            {detailOpen && (
              <div className='fixed inset-0 z-40 bg-black/40' onClick={() => { setDetailOpen(false); setSelected(null); }} />
            )}
            <div className={`fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-2xl transition-all duration-300 ${detailOpen ? 'h-64 sm:h-80' : 'h-auto'}`}>
              <div className='max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-start gap-3 sm:gap-6'>
                <button className='absolute top-2 right-3 sm:right-4 text-muted-foreground hover:text-foreground' onClick={() => { setDetailOpen(false); setSelected(null); }}>
                  <X className='h-5 w-5' />
                </button>

                <div className='shrink-0'>
                  {selected.mimeType.startsWith('image/') ? (
                    <SafeImage src={mediaUrl(selected.url)} variant='small' derivativeManifest={selected.derivativeManifest} blurUrl={selected.blurUrl} alt={selected.alt || selected.filename} className='h-14 w-14 sm:h-20 sm:w-20 rounded-lg object-cover border' />
                  ) : (
                    <div className='h-14 w-14 sm:h-20 sm:w-20 rounded-lg border bg-muted flex items-center justify-center'><Film className='h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground' /></div>
                  )}
                </div>

                <div className='flex-1 min-w-0'>
                  <div className='flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2 sm:mb-3'>
                    <div className='min-w-0'>
                      <h3 className='font-medium truncate'>{selected.filename}</h3>
                      <p className='text-xs text-muted-foreground'>{formatSize(selected.size)} · {selected.mimeType} · {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : ''}</p>
                    </div>
                    <div className='flex gap-1.5 sm:ml-auto flex-wrap'>
                      <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => copyUrl(selected.url, selected.id)}>
                        {copied === selected.id ? <Check className='h-3 w-3 mr-1 text-green-600' /> : <Copy className='h-3 w-3 mr-1' />}
                        {copied === selected.id ? 'Copied' : 'Copy URL'}
                      </Button>
                      <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => { setDetailOpen(!detailOpen); }}>
                        <Link2 className='h-3 w-3 mr-1' />
                        <span className='hidden sm:inline'>Attachments</span> ({attachDetails?.length || selected._count?.attachments || 0})
                      </Button>
                      <Button variant='ghost' size='sm' className='h-7 text-xs text-destructive hover:text-destructive' onClick={() => { setDeleteTarget(selected); setSelected(null); setDetailOpen(false); }}>
                        <Trash2 className='h-3 w-3 mr-1' /> Delete
                      </Button>
                    </div>
                  </div>

                  {detailOpen && (
                    <div className='overflow-y-auto max-h-32 sm:max-h-52'>
                      <h4 className='text-xs font-medium text-muted-foreground mb-2'>ATTACHED TO</h4>
                      {!attachDetails || attachDetails.length === 0 ? (
                        <p className='text-sm text-muted-foreground py-4'>Not attached anywhere. This media can be safely deleted.</p>
                      ) : (
                        <div className='space-y-1'>
                          {attachDetails.map((att, i) => (
                            <div key={i} className='flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50'>
                              <Badge variant='outline' className='text-xs capitalize shrink-0'>{att.entityType}</Badge>
                              <span className='flex-1 truncate'>{att.entityName}</span>
                              {att.entityType === 'product' && (
                                <Link to='/op/products' className='text-xs text-primary hover:underline flex items-center gap-1 shrink-0'>
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
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => { if (!o) setBulkDeleteOpen(false) }}
        title={`Delete ${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'}?`}
        desc={`This will permanently delete ${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'} from the library. ${selectedIds.size > 0 ? 'Attached files cannot be deleted unless forced.' : ''}`}
        confirmText='Delete'
        destructive
        handleConfirm={() => bulkDeleteMut.mutate(Array.from(selectedIds))}
      />
    </>
  )
}
