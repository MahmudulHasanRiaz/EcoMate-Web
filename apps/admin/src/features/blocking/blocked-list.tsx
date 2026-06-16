import { useState } from 'react'
import { format } from 'date-fns'
import { Search, Shield, ShieldOff, Ban, Plus, Loader2, X } from 'lucide-react'
import { useBlockedEntries, useBlockEntryMutations } from './hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { toast } from 'sonner'

type FilterType = 'all' | 'ip' | 'phone' | 'active' | 'whitelisted'

export function BlockedListPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const { data: entries, isLoading } = useBlockedEntries(filter === 'all' || filter === 'active' || filter === 'whitelisted' ? undefined : filter, search || undefined)
  const mut = useBlockEntryMutations()
  const [blockDialog, setBlockDialog] = useState<'ip' | 'phone' | null>(null)
  const [newValue, setNewValue] = useState('')
  const [newReason, setNewReason] = useState('')

  const filtered = entries?.filter(e => {
    if (filter === 'active') return e.isActive
    if (filter === 'whitelisted') return e.whitelisted
    return true
  }) || []

  const handleBlock = () => {
    if (!blockDialog || !newValue.trim()) return
    mut.create.mutate(
      { type: blockDialog, value: newValue.trim(), reason: newReason || undefined },
      {
        onSuccess: () => {
          toast.success(`${blockDialog === 'ip' ? 'IP' : 'Phone'} blocked`)
          setBlockDialog(null)
          setNewValue('')
          setNewReason('')
        },
        onError: () => toast.error('Failed to block'),
      }
    )
  }

  const handleUnblock = (type: string, id: string) => {
    mut.unblock.mutate({ type, id }, {
      onSuccess: () => toast.success('Unblocked'),
      onError: () => toast.error('Failed to unblock'),
    })
  }

  const handleWhitelist = (type: string, id: string) => {
    mut.whitelist.mutate({ type, id }, {
      onSuccess: () => toast.success('Whitelist toggled'),
      onError: () => toast.error('Failed to toggle whitelist'),
    })
  }

  const tabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ip', label: 'IPs' },
    { key: 'phone', label: 'Phones' },
    { key: 'active', label: 'Active' },
    { key: 'whitelisted', label: 'Whitelisted' },
  ]

  return (
    <>
      <Header fixed>
        <div className='me-auto flex items-center gap-2'>
          <div className='relative'>
            <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search IP or phone...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='h-9 w-64 pl-8'
            />
          </div>
          <Dialog open={blockDialog === 'ip'} onOpenChange={(o) => { setBlockDialog(o ? 'ip' : null); if (!o) { setNewValue(''); setNewReason('') } }}>
            <DialogTrigger asChild>
              <Button variant='outline' size='sm' onClick={() => setBlockDialog('ip')}>
                <Plus className='h-4 w-4 mr-1' /> Block IP
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Block IP Address</DialogTitle></DialogHeader>
              <div className='space-y-3'>
                <div>
                  <Label>IP Address</Label>
                  <Input placeholder='192.168.1.1' value={newValue} onChange={(e) => setNewValue(e.target.value)} />
                </div>
                <div>
                  <Label>Reason</Label>
                  <Input placeholder='Suspicious activity' value={newReason} onChange={(e) => setNewReason(e.target.value)} />
                </div>
                <Button onClick={handleBlock} disabled={!newValue.trim() || mut.create.isPending}>
                  {mut.create.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-1' /> : <Ban className='h-4 w-4 mr-1' />}
                  Block IP
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={blockDialog === 'phone'} onOpenChange={(o) => { setBlockDialog(o ? 'phone' : null); if (!o) { setNewValue(''); setNewReason('') } }}>
            <DialogTrigger asChild>
              <Button variant='outline' size='sm' onClick={() => setBlockDialog('phone')}>
                <Plus className='h-4 w-4 mr-1' /> Block Phone
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Block Phone Number</DialogTitle></DialogHeader>
              <div className='space-y-3'>
                <div>
                  <Label>Phone Number</Label>
                  <Input placeholder='017XXXXXXXX' value={newValue} onChange={(e) => setNewValue(e.target.value)} />
                </div>
                <div>
                  <Label>Reason</Label>
                  <Input placeholder='Order abuse' value={newReason} onChange={(e) => setNewReason(e.target.value)} />
                </div>
                <Button onClick={handleBlock} disabled={!newValue.trim() || mut.create.isPending}>
                  {mut.create.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-1' /> : <Ban className='h-4 w-4 mr-1' />}
                  Block Phone
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Blocked Items</h2>
          <p className='text-muted-foreground'>Manage blocked IP addresses and phone numbers.</p>
        </div>

        <div className='flex items-center gap-2'>
          {tabs.map(tab => (
            <Button
              key={tab.key}
              variant={filter === tab.key ? 'default' : 'ghost'}
              size='sm'
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className='flex justify-center py-12'>
            <Loader2 className='animate-spin h-8 w-8' />
          </div>
        ) : (
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Block Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Blocked At</TableHead>
                  <TableHead>Blocked By</TableHead>
                  <TableHead>Auto</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>WL</TableHead>
                  <TableHead className='w-32'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className='text-center py-8 text-muted-foreground'>
                      No blocked items found
                    </TableCell>
                  </TableRow>
                ) : filtered.map((entry) => (
                  <TableRow key={`${entry.entryType}-${entry.id}`}>
                    <TableCell>
                      <Badge variant='outline' className='uppercase text-xs'>
                        {entry.entryType}
                      </Badge>
                    </TableCell>
                    <TableCell className='font-mono text-xs max-w-[180px] truncate' title={entry.value}>
                      {entry.value}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.blockType === 'full' ? 'destructive' : 'secondary'} className='text-xs'>
                        {entry.blockType === 'full' ? 'Full' : 'Order'}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground max-w-[200px] truncate' title={entry.reason || ''}>
                      {entry.reason || '-'}
                    </TableCell>
                    <TableCell className='text-nowrap text-xs'>
                      {format(new Date(entry.blockedAt), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell className='text-xs'>{entry.blockedBy || '-'}</TableCell>
                    <TableCell>
                      {entry.autoBlocked ? <Badge variant='outline' className='text-xs text-amber-600'>Auto</Badge> : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.isActive ? 'default' : 'secondary'} className='text-xs'>
                        {entry.isActive ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.whitelisted ? (
                        <Shield className='h-4 w-4 text-green-500' />
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-7 w-7'
                          onClick={() => handleUnblock(entry.entryType, entry.id)}
                          disabled={!entry.isActive || mut.unblock.isPending}
                          title='Unblock'
                        >
                          <ShieldOff className='h-3.5 w-3.5' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-7 w-7'
                          onClick={() => handleWhitelist(entry.entryType, entry.id)}
                          disabled={mut.whitelist.isPending}
                          title={entry.whitelisted ? 'Remove whitelist' : 'Add to whitelist'}
                        >
                          <Shield className={`h-3.5 w-3.5 ${entry.whitelisted ? 'text-green-500' : 'text-muted-foreground'}`} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>
    </>
  )
}
