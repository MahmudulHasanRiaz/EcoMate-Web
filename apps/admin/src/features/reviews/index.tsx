import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SafeImage } from '@/components/safe-image'
import { Loader2, Star, Trash2, Check, MessageSquareText, EyeOff } from 'lucide-react'

const reviewsApi = {
  list: (status?: string) => apiClient.get('/reviews', { params: status ? { status } : {} }),
  approve: (id: string) => apiClient.patch(`/reviews/${id}/approve`),
  delete: (id: string) => apiClient.delete(`/reviews/${id}`),
}

interface ReviewItem {
  id: string
  customerName: string
  rating: number
  text: string | null
  approved: boolean
  createdAt: string
  product: { id: string; name: string; slug: string; images: unknown }
}

function getProductImage(product: ReviewItem['product']): string | null {
  if (!product.images) return null
  if (typeof product.images === 'string') return product.images
  if (Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images[0]
    return typeof first === 'string' ? first : null
  }
  return null
}

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className='flex items-center gap-0.5'>
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          size={size}
          className={s <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}
        />
      ))}
    </div>
  )
}

export function Reviews() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'all' | 'pending' | 'approved'>('pending')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const statusParam = tab === 'all' ? undefined : tab

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['reviews', statusParam],
    queryFn: () => reviewsApi.list(statusParam).then(r => r.data),
  })

  const list: ReviewItem[] = Array.isArray(reviews) ? reviews : []

  const approveMut = useMutation({
    mutationFn: (id: string) => reviewsApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
      toast.success('Review approved')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error approving review'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => reviewsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
      setDeleteConfirm(null)
      toast.success('Review deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting review'),
  })

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-4 ms-auto'>
          <ThemeSwitch /><ProfileDropdown />
        </div>
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Reviews</h2>
            <p className='text-muted-foreground'>Manage customer product reviews.</p>
          </div>
        </div>

        <div className='flex gap-2 items-center'>
          {(['pending', 'approved', 'all'] as const).map(t => (
            <Button
              key={t}
              variant={tab === t ? 'default' : 'outline'}
              size='sm'
              onClick={() => setTab(t)}
              className='capitalize'
            >
              {t === 'pending' && <EyeOff className='h-3.5 w-3.5 mr-1' />}
              {t === 'approved' && <Check className='h-3.5 w-3.5 mr-1' />}
              {t}
            </Button>
          ))}
        </div>

        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Review</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='w-24'></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className='text-center py-12'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
              ) : list.length ? list.map((r: ReviewItem) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className='flex items-center gap-2 max-w-[200px]'>
                      {(() => { const img = getProductImage(r.product); return img ? <SafeImage src={img} alt='' className='w-8 h-8 rounded object-cover flex-shrink-0' thumbWidth={40} thumbHeight={40} /> : null })()}
                      <span className='truncate text-sm font-medium'>{r.product.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className='text-sm'>{r.customerName}</TableCell>
                  <TableCell><StarRating rating={r.rating} /></TableCell>
                  <TableCell className='max-w-[250px]'>
                    <p className='text-sm text-muted-foreground truncate'>{r.text || <span className='italic'>No text</span>}</p>
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground whitespace-nowrap'>
                    {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </TableCell>
                  <TableCell>
                    {r.approved ? (
                      <Badge variant='outline' className='text-green-600 border-green-200 bg-green-50'>
                        <Check className='h-3 w-3 mr-1' /> Approved
                      </Badge>
                    ) : (
                      <Badge variant='outline' className='text-amber-600 border-amber-200 bg-amber-50'>
                        <EyeOff className='h-3 w-3 mr-1' /> Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className='flex gap-1'>
                      {!r.approved && (
                        <Button variant='ghost' size='sm' className='h-8 text-xs' onClick={() => approveMut.mutate(r.id)}>
                          <Check className='h-3.5 w-3.5 mr-1 text-green-600' />
                          Approve
                        </Button>
                      )}
                      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={() => setDeleteConfirm(r.id)}>
                        <Trash2 className='h-3.5 w-3.5 text-destructive' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className='text-center py-12 text-muted-foreground'>
                  <MessageSquareText className='h-8 w-8 mx-auto mb-2 opacity-40' />
                  <p>No {tab !== 'all' ? tab : ''} reviews found</p>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Main>

      <Dialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Review</DialogTitle></DialogHeader>
          <p className='text-sm text-muted-foreground'>Are you sure? This cannot be undone.</p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm)}>
              {deleteMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
