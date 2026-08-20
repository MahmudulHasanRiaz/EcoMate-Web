import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Wallet, Plus, Loader2 } from 'lucide-react'
import { marketingApi, money, fmtDate } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  confirmed: 'outline',
  posted: 'default',
  partially_consumed: 'default',
  fully_consumed: 'outline',
  archived: 'secondary',
}

export function MarketingFunding() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const perPage = 10
  const [dialogOpen, setDialogOpen] = useState(false)
  const [postTarget, setPostTarget] = useState<{ id: string } | null>(null)
  const [fundingAccountId, setFundingAccountId] = useState('')
  const [form, setForm] = useState({
    adAccountId: '',
    fundingSource: 'BANK',
    fundingDate: new Date().toISOString().slice(0, 10),
    currency: 'USD',
    currencyAmount: '',
    baseCurrency: 'BDT',
    baseAmount: '',
    effectiveRate: '',
    reference: '',
    remarks: '',
  })

  const { data } = useQuery({
    queryKey: ['marketing-funding', page],
    queryFn: () => marketingApi.funding.list({ page, perPage }).then(r => r.data),
  })
  const { data: summary } = useQuery({
    queryKey: ['marketing-funding-summary'],
    queryFn: () => marketingApi.funding.summary().then(r => r.data),
  })
  const { data: accounts } = useQuery({
    queryKey: ['marketing-ad-accounts-funding'],
    queryFn: () => marketingApi.adAccounts.list({ page: 1, perPage: 100 }).then(r => r.data),
  })
  const { data: accountTree } = useQuery({
    queryKey: ['accounts-tree'],
    queryFn: () => (apiGetAccountsTree()),
  })

  const fundingAccounts = Array.isArray(accountTree)
    ? (accountTree as any[]).flatMap((a: any) => [a, ...(a.children || [])]).filter((a: any) => a.type === 'asset' && !a.isGroup)
    : []

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['marketing-funding'] })
    queryClient.invalidateQueries({ queryKey: ['marketing-funding-summary'] })
  }

  const createMut = useMutation({
    mutationFn: () => marketingApi.funding.create({
      adAccountId: form.adAccountId,
      fundingSource: form.fundingSource,
      fundingDate: form.fundingDate,
      currency: form.currency,
      currencyAmount: parseFloat(form.currencyAmount),
      baseCurrency: form.baseCurrency,
      baseAmount: form.baseAmount ? parseFloat(form.baseAmount) : undefined,
      effectiveRate: form.effectiveRate ? parseFloat(form.effectiveRate) : undefined,
      reference: form.reference || undefined,
      remarks: form.remarks || undefined,
    }),
    onSuccess: () => {
      toast.success('Funding entry created (draft)')
      setDialogOpen(false)
      setForm({ ...form, currencyAmount: '', baseAmount: '', effectiveRate: '', reference: '', remarks: '' })
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create funding'),
  })

  const confirmMut = useMutation({
    mutationFn: (id: string) => marketingApi.funding.confirm(id),
    onSuccess: () => { toast.success('Funding confirmed'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Confirm failed'),
  })

  const postMut = useMutation({
    mutationFn: (id: string) => marketingApi.funding.post(id, fundingAccountId),
    onSuccess: () => { toast.success('Funding posted to accounting (journal entry created)'); setPostTarget(null); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Posting failed'),
  })

  const archiveMut = useMutation({
    mutationFn: (id: string) => marketingApi.funding.archive(id),
    onSuccess: () => { toast.success('Funding archived'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Archive failed'),
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => marketingApi.funding.remove(id),
    onSuccess: () => { toast.success('Draft funding deleted'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Delete failed'),
  })

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Funding</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" />Add funding</Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(summary ?? []).map((s) => (
            <Card key={s.adAccountId}>
              <CardContent className="p-4">
                <p className="text-sm font-medium">{s.adAccountName ?? 'Ad account'}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{money(s.remainingAmount)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  received {money(s.receivedAmount)} · consumed {money(s.consumedAmount)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-4">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad account</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Base (BDT)</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.data ?? []).map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-sm font-medium">{f.adAccount?.name}</TableCell>
                    <TableCell className="text-sm">{fmtDate(f.fundingDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(f.currencyAmount).toFixed(2)} {f.currency}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(f.baseAmount))}</TableCell>
                    <TableCell className="text-sm">{f.fundingSource}</TableCell>
                    <TableCell><Badge variant={STATUS_BADGE[f.status]}>{f.status.split('_').join(' ')}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {f.status === 'draft' && (
                          <Button variant="outline" size="sm" onClick={() => confirmMut.mutate(f.id)}>Confirm</Button>
                        )}
                        {f.status === 'confirmed' && (
                          <Button variant="outline" size="sm" onClick={() => { setPostTarget(f); setFundingAccountId('') }}>Post</Button>
                        )}
                        {f.status === 'posted' && <span className="text-xs text-muted-foreground">JE linked</span>}
                        {f.status === 'fully_consumed' && (
                          <Button variant="ghost" size="sm" onClick={() => archiveMut.mutate(f.id)}>Archive</Button>
                        )}
                        {f.status === 'draft' && (
                          <Button variant="ghost" size="sm" onClick={() => removeMut.mutate(f.id)}>Delete</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t p-3">
              <p className="text-sm text-muted-foreground">Page {page} of {data?.totalPages ?? 1}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </Main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add funding entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Ad account</Label>
              <Select value={form.adAccountId} onValueChange={(v) => setForm({ ...form, adAccountId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select ad account" /></SelectTrigger>
                <SelectContent>
                  {(accounts?.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Funding source</Label>
              <Select value={form.fundingSource} onValueChange={(v) => setForm({ ...form, fundingSource: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['BANK', 'DEBIT_CARD', 'CREDIT_CARD', 'WALLET', 'CASH', 'VIRTUAL_CARD'].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Funding date</Label><Input type="date" value={form.fundingDate} onChange={(e) => setForm({ ...form, fundingDate: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Currency</Label>
                <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </div>
              <div>
                <Label>Amount (currency)</Label>
                <Input type="number" step="0.01" value={form.currencyAmount} onChange={(e) => setForm({ ...form, currencyAmount: e.target.value })} placeholder="120.00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Base amount (BDT) — optional</Label>
                <Input type="number" step="0.01" value={form.baseAmount} onChange={(e) => setForm({ ...form, baseAmount: e.target.value })} placeholder="15000" />
              </div>
              <div>
                <Label>Effective rate — optional</Label>
                <Input type="number" step="0.0001" value={form.effectiveRate} onChange={(e) => setForm({ ...form, effectiveRate: e.target.value })} placeholder="125.00" />
              </div>
            </div>
            <div>
              <Label>Reference</Label>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="bank ref / card no" />
            </div>
            <div>
              <Label>Remarks</Label>
              <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={!form.adAccountId || !form.currencyAmount || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!postTarget} onOpenChange={(o) => !o && setPostTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Post funding to accounting</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Creates a journal entry: Dr Marketing Expenses / Cr funding account. Closed financial periods block posting.
            </p>
            <div>
              <Label>Funding (credit) account</Label>
              <Select value={fundingAccountId} onValueChange={setFundingAccountId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select asset account" /></SelectTrigger>
                <SelectContent>
                  {fundingAccounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostTarget(null)}>Cancel</Button>
            <Button disabled={!fundingAccountId || postMut.isPending} onClick={() => postTarget && postMut.mutate(postTarget.id)}>
              {postMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Post entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

async function apiGetAccountsTree() {
  const { accountingApi } = await import('@/features/accounting/api')
  return accountingApi.getAccountTree().then(r => r.data)
}