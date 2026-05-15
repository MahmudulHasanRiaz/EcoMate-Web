import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Check, Loader2, ImageIcon, Film, Search } from 'lucide-react'
import { mediaApi, uploadApi, mediaUrl, type MediaResponse } from '@/features/media/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  selected: string[]
  onSelect: (urls: string[]) => void
  multiple?: boolean
}

export function MediaPicker({ open, onOpenChange, selected, onSelect, multiple = true }: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [localSelected, setLocalSelected] = useState<string[]>(selected)

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'picker', search],
    queryFn: () => mediaApi.list({ page: 1, perPage: 50, search: search || undefined }).then(r => r.data),
    enabled: open,
  })

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files?.length) return;
    for (let i = 0; i < files.length; i++) {
      await uploadApi.file(files[i]);
    }
    queryClient.invalidateQueries({ queryKey: ['media'] });
    e.target.value = '';
  }, [queryClient])

  const toggle = (url: string) => {
    if (multiple) {
      setLocalSelected(prev => prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]);
    } else {
      setLocalSelected([url]);
    }
  }

  const handleConfirm = () => {
    onSelect(localSelected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl max-h-[85vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>Media Gallery</DialogTitle>
          <p className='text-sm text-muted-foreground'>Select images for this product</p>
        </DialogHeader>
        <div className='flex items-center gap-2 mb-3'>
          <div className='relative flex-1'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <Input placeholder='Search files...' value={search} onChange={e => setSearch(e.target.value)} className='pl-8' />
          </div>
          <label className='cursor-pointer'>
            <Button variant='outline' size='sm' asChild><span><Upload className='h-4 w-4 mr-1' />Upload</span></Button>
            <input type='file' accept='image/*' multiple onChange={handleUpload} className='hidden' />
          </label>
        </div>
        {isLoading ? (
          <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6' /></div>
        ) : (
          <div className='flex-1 overflow-y-auto'>
            <div className='grid grid-cols-4 md:grid-cols-5 gap-2'>
              {(data?.data || []).map((m: MediaResponse) => {
                const isSel = localSelected.includes(m.url);
                return (
                  <div
                    key={m.id}
                    className={`group relative aspect-square rounded-lg border-2 overflow-hidden bg-muted/30 cursor-pointer transition-all ${isSel ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/50'}`}
                    onClick={() => toggle(m.url)}
                  >
                    {m.mimeType.startsWith('image/') ? (
                      <img src={mediaUrl(m.url)} alt={m.filename} className='w-full h-full object-cover' loading='lazy' />
                    ) : (
                      <div className='w-full h-full flex items-center justify-center'><Film className='h-6 w-6 text-muted-foreground' /></div>
                    )}
                    {isSel && (
                      <div className='absolute top-1 right-1 bg-primary rounded-full p-0.5'>
                        <Check className='h-3 w-3 text-primary-foreground' />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {(!data?.data || data.data.length === 0) && (
              <div className='flex flex-col items-center py-12 text-muted-foreground'>
                <ImageIcon className='h-10 w-10 mb-2' />
                <p>No media files</p>
                <label className='cursor-pointer mt-2'>
                  <Button variant='outline' size='sm' asChild><span>Upload</span></Button>
                  <input type='file' accept='image/*' multiple onChange={handleUpload} className='hidden' />
                </label>
              </div>
            )}
          </div>
        )}
        <div className='flex justify-between items-center pt-3 border-t mt-3'>
          <span className='text-sm text-muted-foreground'>{localSelected.length} selected</span>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleConfirm}>Select ({localSelected.length})</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
