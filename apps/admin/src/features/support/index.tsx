import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Loader2, MailOpen } from 'lucide-react'
import { supportEnquiriesApi, type SupportEnquiry } from './api'

function statusBadge(status: SupportEnquiry['status']) {
  return status === 'NEW' ? (
    <Badge variant='default'>New</Badge>
  ) : (
    <Badge variant='secondary'>Replied</Badge>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function SupportEnquiries() {
  const [tab, setTab] = useState<'all' | 'NEW' | 'REPLIED'>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['support-enquiries', tab],
    queryFn: () =>
      supportEnquiriesApi
        .list({ status: tab === 'all' ? undefined : tab, perPage: 100 })
        .then((r) => r.data),
  })

  const list: SupportEnquiry[] = data?.data ?? []

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
            <h2 className='text-2xl font-bold tracking-tight'>Support Enquiries</h2>
            <p className='text-muted-foreground text-sm mt-1'>
              Messages sent from the storefront support page. Mark each one replied once you have answered it.
            </p>
          </div>
        </div>

        <div className='flex gap-2 items-center'>
          {(['all', 'NEW', 'REPLIED'] as const).map((t) => (
            <Button
              key={t}
              variant={tab === t ? 'default' : 'outline'}
              size='sm'
              onClick={() => setTab(t)}
            >
              {t === 'all' ? 'All' : t === 'NEW' ? 'New' : 'Replied'}
            </Button>
          ))}
        </div>

        <div className='rounded-lg border bg-card'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className='text-center py-12'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-12'>
                    <MailOpen className='h-8 w-8 mx-auto mb-2 text-muted-foreground' />
                    <p className='text-muted-foreground text-sm'>No enquiries{tab === 'all' ? '' : ` with status ${tab === 'NEW' ? 'New' : 'Replied'}`} yet.</p>
                  </TableCell>
                </TableRow>
              ) : (
                list.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className='font-medium'>{e.name}</TableCell>
                    <TableCell className='max-w-[240px] truncate'>{e.subject || '—'}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {e.email || e.phone || '—'}
                    </TableCell>
                    <TableCell className='text-sm'>{e.orderId || '—'}</TableCell>
                    <TableCell className='text-sm'>{formatDate(e.createdAt)}</TableCell>
                    <TableCell>{statusBadge(e.status)}</TableCell>
                    <TableCell>
                      <Link to='/op/support-enquiries/$id' params={{ id: e.id }}>
                        <Button variant='outline' size='sm'>View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Main>
    </>
  )
}
