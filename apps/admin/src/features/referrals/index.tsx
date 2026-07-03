import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Loader2, Gift } from 'lucide-react'

const referralsApi = {
  list: (params?: { page?: number; perPage?: number }) =>
    apiClient.get('/referrals', { params }),
  getLeads: (id: string, params?: { page?: number; perPage?: number }) =>
    apiClient.get(`/referrals/${id}/leads`, { params }),
}

export function Referrals() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const perPage = 20

  const { data, isLoading } = useQuery({
    queryKey: ['referrals', page],
    queryFn: () => referralsApi.list({ page, perPage }).then(r => r.data),
  })

  const list = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data || []
  const meta = (data as { meta?: { total: number; page: number; perPage: number; totalPages: number } })?.meta

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Referrals</h2><p className='text-muted-foreground'>Track customer referrals and rewards.</p></div>
        </div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead></TableHead><TableHead>Referrer</TableHead><TableHead>Email</TableHead><TableHead>Code</TableHead><TableHead>Referrals</TableHead><TableHead>Reward</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={7} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
               list.length ? list.map((r: Record<string, unknown>) => (
                <ExpandedRow
                  key={r['id'] as string}
                  referral={r}
                  expanded={!!expanded[r['id'] as string]}
                  onToggle={() => toggleExpand(r['id'] as string)}
                />
              )) : <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No referrals yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-center gap-2'>
            <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className='text-sm text-muted-foreground'>Page {meta.page} of {meta.totalPages}</span>
            <Button variant='outline' size='sm' disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        )}
      </Main>
    </>
  )
}

function ExpandedRow({ referral, expanded, onToggle }: { referral: Record<string, unknown>; expanded: boolean; onToggle: () => void }) {
  const ref = referral as { id: string; code: string; totalReferrals: number; totalReward: string; isActive: boolean; referrer: { id: string; firstName: string; lastName: string; email: string; phoneNumber: string }; _count: { leads: number } }

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['referral-leads', ref.id],
    queryFn: () => referralsApi.getLeads(ref.id).then(r => r.data),
    enabled: expanded,
  })

  const leadsList = leadsData && (leadsData as { data?: unknown[] })?.data
    ? (leadsData as { data: unknown[] }).data
    : Array.isArray(leadsData) ? leadsData : []

  return (
    <>
      <TableRow className='cursor-pointer' onClick={onToggle}>
        <TableCell>{expanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}</TableCell>
        <TableCell className='font-medium'>{ref.referrer.firstName} {ref.referrer.lastName}</TableCell>
        <TableCell>{ref.referrer.email}</TableCell>
        <TableCell className='font-mono font-medium'>{ref.code}</TableCell>
        <TableCell>{ref.totalReferrals}</TableCell>
        <TableCell>৳{ref.totalReward}</TableCell>
        <TableCell><Badge className={ref.isActive ? 'bg-green-500' : ''}>{ref.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className='p-0'>
            <div className='bg-muted/30 px-6 py-3'>
              <p className='text-sm font-medium mb-2'>Referral Leads</p>
              {leadsLoading ? (
                <Loader2 className='animate-spin h-4 w-4' />
              ) : leadsList.length ? (
                <div className='space-y-1'>
                  {leadsList.map((l: Record<string, unknown>) => (
                    <div key={l['id'] as string} className='flex items-center gap-3 text-sm'>
                      <span className='w-28 truncate font-medium'>{l['name'] as string || '—'}</span>
                      <span className='w-28 font-mono text-xs'>{l['phone'] as string}</span>
                      <Badge variant='outline' className={l['status'] === 'converted' ? 'bg-green-500/10 text-green-600' : l['status'] === 'expired' ? 'bg-red-500/10 text-red-600' : ''}>
                        {l['status'] as string}
                      </Badge>
                      {!!l['rewardGiven'] && <Gift className='h-3.5 w-3.5 text-green-500' />}
                    </div>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>No leads yet.</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
