import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, Check, Loader2, ImageIcon, Film, Search, Link2, X } from 'lucide-react'
import { PLACEHOLDER_IMAGE } from '@/lib/utils'
import {
  mediaApi,
  uploadApi,
  mediaUrl,
  type MediaResponse,
  type UploadResult,
} from '@/features/media/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  selected: string[]
  onSelect: (urls: string[]) => void
  multiple?: boolean
  /** Filter library to images only by default; pass 'all' to include videos. */
  accept?: 'image' | 'all'
}

type PendingUpload = {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

export function MediaPicker({
  open,
  onOpenChange,
  selected,
  onSelect,
  multiple = true,
  accept = 'image',
}: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [localSelected, setLocalSelected] = useState<string[]>(selected)
  const [dragActive, setDragActive] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [pending, setPending] = useState<PendingUpload[]>([])
  const dropRef = useRef<HTMLDivElement | null>(null)
  const fileInputId = useRef(`media-picker-input-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    if (open) setLocalSelected(selected)
  }, [open, selected])

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'picker', accept, search],
    queryFn: () =>
      mediaApi
        .list({
          page: 1,
          perPage: 60,
          search: search || undefined,
          type: accept === 'image' ? 'image' : undefined,
        })
        .then((r) => r.data),
    enabled: open,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['media'] })
  }

  const ingestFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      const valid = files.filter((f) =>
        accept === 'image' ? f.type.startsWith('image/') : f.type.startsWith('image/') || f.type.startsWith('video/'),
      )
      if (!valid.length) {
        toast.error('No supported files in selection')
        return
      }
      const entries: PendingUpload[] = valid.map((f) => ({
        id: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`,
        name: f.name,
        progress: 0,
        status: 'uploading' as const,
      }))
      setPending((prev) => [...prev, ...entries])
      const justUploaded: string[] = []
      await Promise.all(
        valid.map(async (file, i) => {
          const entry = entries[i]
          try {
            const res = await uploadApi.file(file)
            justUploaded.push(res.data.url)
            setPending((prev) =>
              prev.map((p) => (p.id === entry.id ? { ...p, progress: 100, status: 'done' } : p)),
            )
          } catch (err: unknown) {
            const message =
              (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
              (err as Error)?.message ||
              'Upload failed'
            setPending((prev) =>
              prev.map((p) =>
                p.id === entry.id ? { ...p, progress: 100, status: 'error', error: message } : p,
              ),
            )
            toast.error(`${file.name}: ${message}`)
          }
        }),
      )
      invalidate()
      if (justUploaded.length) {
        setLocalSelected((prev) => {
          if (!multiple) return [justUploaded[justUploaded.length - 1]]
          const set = new Set([...prev, ...justUploaded])
          return Array.from(set)
        })
      }
      window.setTimeout(() => {
        setPending((prev) => prev.filter((p) => p.status === 'uploading'))
      }, 1500)
    },
    [accept, multiple, queryClient],
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
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === dropRef.current) setDragActive(false)
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) await ingestFiles(files)
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (!files.length && url && /^https?:\/\//i.test(url)) {
      setUrlInput(url)
    }
  }

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!open) return
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      let text = ''
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) files.push(f)
        } else if (it.kind === 'string' && it.type === 'text/plain') {
          await new Promise<void>((res) => {
            it.getAsString((s) => {
              text = s
              res()
            })
          })
        }
      }
      if (files.length) {
        await ingestFiles(files)
        return
      }
      if (text && /^https?:\/\/\S+\.(png|jpe?g|webp|gif|svg|avif|mp4|webm)(\?\S*)?$/i.test(text)) {
        setUrlInput(text)
      }
    },
    [open, ingestFiles],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [open, handlePaste])

  const handleUrlImport = async () => {
    const url = urlInput.trim()
    if (!url) return
    setUrlBusy(true)
    try {
      const res: { data: UploadResult } = await uploadApi.fromUrl(url)
      toast.success('Downloaded to library')
      setUrlInput('')
      invalidate()
      setLocalSelected((prev) => {
        if (!multiple) return [res.data.url]
        return Array.from(new Set([...prev, res.data.url]))
      })
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        'Failed to fetch URL'
      toast.error(message)
    } finally {
      setUrlBusy(false)
    }
  }

  const toggle = (url: string) => {
    if (multiple) {
      setLocalSelected((prev) =>
        prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
      )
    } else {
      setLocalSelected([url])
    }
  }

  const handleConfirm = () => {
    onSelect(localSelected)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-5xl max-h-[90vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>Media Library</DialogTitle>
          <p className='text-sm text-muted-foreground'>
            Drag &amp; drop files, paste from clipboard, or import from a URL — everything lands in your
            library first.
          </p>
        </DialogHeader>

        <div className='flex flex-wrap items-center gap-2 mb-3'>
          <div className='relative flex-1 min-w-[220px]'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search files...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-8'
            />
          </div>
          <div className='flex items-center gap-2 min-w-[280px]'>
            <div className='relative flex-1'>
              <Link2 className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
              <Input
                placeholder='Import from URL (https://...)'
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleUrlImport()
                  }
                }}
                className='pl-8'
                disabled={urlBusy}
              />
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={handleUrlImport}
              disabled={!urlInput.trim() || urlBusy}
            >
              {urlBusy ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Fetch'}
            </Button>
          </div>
          <label htmlFor={fileInputId.current} className='cursor-pointer'>
            <Button variant='outline' size='sm' asChild>
              <span>
                <Upload className='h-4 w-4 mr-1' />
                Upload
              </span>
            </Button>
            <input
              id={fileInputId.current}
              type='file'
              accept={accept === 'image' ? 'image/*' : 'image/*,video/*'}
              multiple
              onChange={handleInputChange}
              className='hidden'
            />
          </label>
        </div>

        <div
          ref={dropRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex-1 overflow-y-auto rounded-lg border-2 border-dashed transition-colors ${
            dragActive ? 'border-primary bg-primary/5' : 'border-transparent'
          }`}
        >
          {dragActive && (
            <div className='pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/10 text-primary'>
              <Upload className='h-10 w-10 mb-2' />
              <p className='font-medium'>Drop to upload to library</p>
            </div>
          )}

          {isLoading ? (
            <div className='flex justify-center py-10'>
              <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
            </div>
          ) : (data?.data || []).length === 0 && !pending.length ? (
            <div className='flex flex-col items-center py-12 text-muted-foreground'>
              <ImageIcon className='h-10 w-10 mb-2' />
              <p>No media yet — drag files here or use Upload / URL import above.</p>
            </div>
          ) : (
            <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 p-1'>
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
              {(data?.data || []).map((m: MediaResponse) => {
                const isSel = localSelected.includes(m.url)
                return (
                  <div
                    key={m.id}
                    className={`group relative aspect-square rounded-lg border-2 overflow-hidden bg-muted/30 cursor-pointer transition-all ${
                      isSel
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'border-transparent hover:border-primary/50'
                    }`}
                    onClick={() => toggle(m.url)}
                  >
                    {m.mimeType.startsWith('image/') ? (
                      <img
                        src={mediaUrl(m.url)}
                        alt={m.alt || m.filename}
                        className='w-full h-full object-cover'
                        loading='lazy'
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).src = PLACEHOLDER_IMAGE
                        }}
                      />
                    ) : (
                      <div className='w-full h-full flex items-center justify-center'>
                        <Film className='h-6 w-6 text-muted-foreground' />
                      </div>
                    )}
                    {isSel && (
                      <div className='absolute top-1 right-1 bg-primary rounded-full p-0.5'>
                        <Check className='h-3 w-3 text-primary-foreground' />
                      </div>
                    )}
                    <div className='absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white truncate opacity-0 group-hover:opacity-100 transition-opacity'>
                      {m.filename}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className='flex justify-between items-center pt-3 border-t mt-3'>
          <span className='text-sm text-muted-foreground'>
            {localSelected.length} selected
          </span>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Use {multiple ? `(${localSelected.length})` : ''}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
