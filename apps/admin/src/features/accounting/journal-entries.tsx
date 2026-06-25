import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Eye, FileText, X } from 'lucide-react'
import { accountingApi, type JournalEntryResponse, type JournalEntryLineResponse, type AccountResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function groupAccountsByType(accounts: AccountResponse[]) {
  const groups: Record<string, AccountResponse[]> = {}
  for (const a of accounts) {
    if (!a.isGroup) {
      if (!groups[a.type]) groups[a.type] = []
      groups[a.type].push(a)
    }
  }
  return groups
}

export function JournalEntries() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewEntry, setViewEntry] = useState<JournalEntryResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JournalEntryResponse | null>(null)
  const [form, setForm] = useState({
    periodId: '',
    entryDate: '',
    description: '',
    referenceNo: '',
    lines: [] as { accountId: string; debit: string; credit: string; description: string }[],
  })

  const { data: entriesData, isLoading } = useQuery({
    queryKey: ['journal-entries', page, selectedPeriodId],
    queryFn: () => accountingApi.listJournalEntries({ page, perPage, periodId: selectedPeriodId || undefined }).then(r => r.data),
  })

  const { data: periodsData } = useQuery({
    queryKey: ['periods'],
    queryFn: () => accountingApi.listFinancialPeriods({ perPage: 50 }).then(r => r.data),
  })

  const { data: accountsData } = useQuery({
    queryKey: ['accounts-flat'],
    queryFn: () => accountingApi.listAccounts({ perPage: 200 }).then(r => r.data),
  })

  const periods = Array.isArray(periodsData?.data) ? periodsData.data : []
  const accountsList = Array.isArray(accountsData?.data) ? accountsData.data : []
  const entries = Array.isArray(entriesData?.data) ? entriesData.data : []
  const totalPages = entriesData?.meta?.totalPages || 1
  const accountsByType = groupAccountsByType(accountsList)

  const createMut = useMutation({
    mutationFn: (d: Parameters<typeof accountingApi.createJournalEntry>[0]) => accountingApi.createJournalEntry(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] })
      setDialogOpen(false)
      resetForm()
      toast.success('Journal entry created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating entry'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => accountingApi.deleteJournalEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] })
      setDeleteTarget(null)
      toast.success('Journal entry deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting entry'),
  })

  function resetForm() {
    setForm({ periodId: '', entryDate: '', description: '', referenceNo: '', lines: [] })
  }

  function openCreate() {
    resetForm()
    setDialogOpen(true)
  }

  function addLine() {
    setForm(f => ({ ...f, lines: [...f.lines, { accountId: '', debit: '', credit: '', description: '' }] }))
  }

  function removeLine(index: number) {
    setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }))
  }

  function updateLine(index: number, field: string, value: string) {
    setForm(f => ({
      ...f,
      lines: f.lines.map((line, i) => i === index ? { ...line, [field]: value } : line),
    }))
  }

  const totalDebit = form.lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
  const totalCredit = form.lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && form.lines.length > 0

  function handleCreate() {
    const payload = {
      periodId: form.periodId,
      entryDate: form.entryDate,
      description: form.description,
      referenceNo: form.referenceNo || undefined,
      lines: form.lines.map(l => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description || undefined,
      })),
    }
    createMut.mutate(payload)
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Journal Entries</h2>
            <p className='text-muted-foreground'>Record and manage journal entries.</p>
          </div>
          <Button size='sm' onClick={openCreate}>
            <Plus className='h-4 w-4 mr-1' /> New Entry
          </Button>
        </div>

        <div className='flex items-center gap-2'>
          <Select value={selectedPeriodId} onValueChange={v => { setSelectedPeriodId(v); setPage(1) }}>
            <SelectTrigger className='w-[250px]'>
              <SelectValue placeholder='All periods' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=''>All periods</SelectItem>
              {periods.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className='text-right'>Debit Total</TableHead>
                  <TableHead className='text-right'>Credit Total</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-[80px]'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto text-muted-foreground' />
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className='text-center py-8 text-muted-foreground'>
                      <FileText className='h-8 w-8 mx-auto mb-2' />
                      No journal entries found
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className='font-mono text-xs'>{entry.entryNo}</TableCell>
                      <TableCell className='whitespace-nowrap'>{formatDate(entry.entryDate)}</TableCell>
                      <TableCell className='font-medium'>{entry.description}</TableCell>
                      <TableCell className='text-right font-mono'>{formatCurrency(entry.totalDebit)}</TableCell>
                      <TableCell className='text-right font-mono'>{formatCurrency(entry.totalCredit)}</TableCell>
                      <TableCell className='text-muted-foreground'>{entry.referenceNo || '—'}</TableCell>
                      <TableCell>
                        {entry.isOpening ? <Badge variant='outline'>Opening</Badge> : <Badge variant='secondary'>Standard</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setViewEntry(entry)}>
                            <Eye className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(entry)}>
                            <Trash2 className='h-3.5 w-3.5 text-destructive' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-4 py-3 border-t'>
              <span className='text-sm text-muted-foreground'>Page {page} of {totalPages}</span>
              <div className='flex gap-1'>
                <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      </Main>

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) { setDialogOpen(false) } }}>
        <DialogContent className='sm:max-w-[700px]'>
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>Period</Label>
                <Select
                  value={form.periodId}
                  onValueChange={v => setForm(f => ({ ...f, periodId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select period' />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2'>
                <Label>Entry Date</Label>
                <Input
                  type='date'
                  value={form.entryDate}
                  onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))}
                />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder='Entry description'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Reference No. (optional)</Label>
              <Input
                value={form.referenceNo}
                onChange={e => setForm(f => ({ ...f, referenceNo: e.target.value }))}
                placeholder='INV-001'
              />
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label>Entry Lines</Label>
                <Button variant='outline' size='sm' onClick={addLine}>
                  <Plus className='h-3.5 w-3.5 mr-1' /> Add Line
                </Button>
              </div>

              {form.lines.length === 0 ? (
                <div className='text-center py-4 text-sm text-muted-foreground border rounded-md'>
                  No lines added. Click "Add Line" to add journal entry lines.
                </div>
              ) : (
                <div className='space-y-2'>
                  <div className='grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1'>
                    <div className='col-span-4'>Account</div>
                    <div className='col-span-2 text-right'>Debit</div>
                    <div className='col-span-2 text-right'>Credit</div>
                    <div className='col-span-3'>Description</div>
                    <div className='col-span-1'></div>
                  </div>
                  {form.lines.map((line, i) => (
                    <div key={i} className='grid grid-cols-12 gap-2 items-start'>
                      <div className='col-span-4'>
                        <Select value={line.accountId} onValueChange={v => updateLine(i, 'accountId', v)}>
                          <SelectTrigger className='h-8 text-xs'>
                            <SelectValue placeholder='Account' />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(accountsByType).map(([type, accts]) => (
                              <div key={type}>
                                <div className='px-2 py-1 text-xs font-medium text-muted-foreground uppercase'>
                                  {type}
                                </div>
                                {accts.map(a => (
                                  <SelectItem key={a.id} value={a.id} className='text-xs'>
                                    {a.code} - {a.name}
                                  </SelectItem>
                                ))}
                              </div>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className='col-span-2'>
                        <Input
                          type='number'
                          step='0.01'
                          className='h-8 text-xs text-right'
                          value={line.debit}
                          onChange={e => updateLine(i, 'debit', e.target.value)}
                          placeholder='0.00'
                        />
                      </div>
                      <div className='col-span-2'>
                        <Input
                          type='number'
                          step='0.01'
                          className='h-8 text-xs text-right'
                          value={line.credit}
                          onChange={e => updateLine(i, 'credit', e.target.value)}
                          placeholder='0.00'
                        />
                      </div>
                      <div className='col-span-3'>
                        <Input
                          className='h-8 text-xs'
                          value={line.description}
                          onChange={e => updateLine(i, 'description', e.target.value)}
                          placeholder='Optional'
                        />
                      </div>
                      <div className='col-span-1 flex justify-center pt-1'>
                        <Button variant='ghost' size='icon' className='h-6 w-6' onClick={() => removeLine(i)}>
                          <X className='h-3 w-3' />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className='flex items-center justify-between pt-2 border-t text-sm'>
                <div className='flex items-center gap-3'>
                  <span>Total Debit: <strong className='font-mono'>{formatCurrency(totalDebit)}</strong></span>
                  <span>Total Credit: <strong className='font-mono'>{formatCurrency(totalCredit)}</strong></span>
                </div>
                <div>
                  {isBalanced ? (
                    <Badge variant='outline' className='text-green-600 border-green-300'>Balanced</Badge>
                  ) : form.lines.length > 0 ? (
                    <Badge variant='outline' className='text-destructive border-destructive/50'>Unbalanced</Badge>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!form.periodId || !form.entryDate || !form.description || !isBalanced || createMut.isPending}
            >
              Create Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewEntry} onOpenChange={o => { if (!o) setViewEntry(null) }}>
        <DialogContent className='sm:max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>Journal Entry {viewEntry?.entryNo}</DialogTitle>
          </DialogHeader>
          {viewEntry && (
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-3 text-sm'>
                <div>
                  <span className='text-muted-foreground'>Period:</span>{' '}
                  <span className='font-medium'>{viewEntry.period?.name || viewEntry.periodId}</span>
                </div>
                <div>
                  <span className='text-muted-foreground'>Date:</span>{' '}
                  <span className='font-medium'>{formatDate(viewEntry.entryDate)}</span>
                </div>
                <div className='col-span-2'>
                  <span className='text-muted-foreground'>Description:</span>{' '}
                  <span className='font-medium'>{viewEntry.description}</span>
                </div>
                {viewEntry.referenceNo && (
                  <div className='col-span-2'>
                    <span className='text-muted-foreground'>Reference:</span>{' '}
                    <span className='font-medium'>{viewEntry.referenceNo}</span>
                  </div>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className='text-right'>Debit</TableHead>
                    <TableHead className='text-right'>Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewEntry.lines?.map(line => (
                    <TableRow key={line.id}>
                      <TableCell>{line.account?.code} - {line.account?.name}</TableCell>
                      <TableCell className='text-right font-mono'>{line.debit > 0 ? formatCurrency(line.debit) : ''}</TableCell>
                      <TableCell className='text-right font-mono'>{line.credit > 0 ? formatCurrency(line.credit) : ''}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className='border-t-2 font-medium'>
                    <TableCell>Total</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(viewEntry.totalDebit)}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(viewEntry.totalCredit)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setViewEntry(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Journal Entry</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete this journal entry? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
