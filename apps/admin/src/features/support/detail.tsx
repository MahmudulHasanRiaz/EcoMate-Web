import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, ArrowLeft } from 'lucide-react'
import { supportEnquiriesApi } from './api'

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function SupportEnquiryDetail({ id }: { id: string }) {
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['support-enquiries', id],
    queryFn: () => supportEnquiriesApi.get(id).then((r) => r.data),
  })

  const updateMut = useMutation({
    mutationFn: (status: 'NEW' | 'REPLIED') => supportEnquiriesApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-enquiries'] })
      toast.success('Enquiry updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update enquiry'),
  })

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-4 ms-auto'>
          <ThemeSwitch /><ProfileDropdown />
        </div>
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <Link to='/op/support-enquiries'>
          <Button variant='ghost' size='sm'>
            <ArrowLeft size={16} className='me-1' /> Back to enquiries
          </Button>
        </Link>

        {isLoading ? (
          <div className='flex items-center justify-center min-h-[200px]'>
            <Loader2 className='animate-spin h-6 w-6' />
          </div>
        ) : isError || !data ? (
          <p className='text-muted-foreground'>Enquiry not found.</p>
        ) : (
          <div className='space-y-6 max-w-3xl'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <h2 className='text-2xl font-bold tracking-tight'>{data.subject || 'Support enquiry'}</h2>
                <p className='text-muted-foreground text-sm mt-1'>
                  From {data.name} · {formatDateTime(data.createdAt)}
                </p>
              </div>
              {data.status === 'NEW' ? <Badge variant='default'>New</Badge> : <Badge variant='secondary'>Replied</Badge>}
            </div>

            <Card>
              <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
              <CardContent className='space-y-2 text-sm'>
                <p><span className='font-semibold'>Name:</span> {data.name}</p>
                <p><span className='font-semibold'>Email:</span> {data.email || '—'}</p>
                <p><span className='font-semibold'>Phone:</span> {data.phone || '—'}</p>
                <p><span className='font-semibold'>Order ID:</span> {data.orderId || '—'}</p>
                {data.status === 'REPLIED' && (
                  <p><span className='font-semibold'>Replied:</span> {formatDateTime(data.repliedAt)}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Message</CardTitle></CardHeader>
              <CardContent>
                <p className='text-sm whitespace-pre-wrap leading-relaxed'>{data.message}</p>
              </CardContent>
            </Card>

            <div className='flex gap-2'>
              {data.status === 'NEW' ? (
                <Button onClick={() => updateMut.mutate('REPLIED')} disabled={updateMut.isPending}>
                  {updateMut.isPending ? 'Saving…' : 'Mark as replied'}
                </Button>
              ) : (
                <Button variant='outline' onClick={() => updateMut.mutate('NEW')} disabled={updateMut.isPending}>
                  {updateMut.isPending ? 'Saving…' : 'Reopen as new'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
