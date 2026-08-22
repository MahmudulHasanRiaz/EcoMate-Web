import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CreditCard, Plus, Loader2, ArrowRightLeft, CheckCircle2, FileText, AlertTriangle } from 'lucide-react'
import { marketingApi, money, fmtDate, type MarketingPaymentResponse, type CreditDueResponse, type AdAccountResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  reconciled: 'default',
  needs_review: 'destructive',
  failed: 'destructive',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  reconciled: 'Reconciled',
  needs_review: 'Needs review',
  failed: 'Failed',
}

export function MarketingPayments() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const perPage = 20
  const [addOpen, setAddOpen] = useState(false)
  const [reconcileTarget, setReconcileTarget] = useState<MarketingPaymentResponse | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')

  const { data } = useQuery({
    queryKey: ['marketing-payments', page, filterStatus],
    queryFn: () => marketingApi.payments.list({ page, perPage, status: filterStatus || undefined }).then(r => r.data),
  })
  const { data: adAccounts } = useQuery({
    queryKey: ['marketing-ad-accounts-payments'],
    queryFn: () => marketingApi.adAccounts.list({ page: 1, perPage: 100 }).then(r => r.data),
  })
  const { data: creditDue } = useQuery({
    queryKey: ['marketing-credit-due'],
    queryFn: () => marketingApi.payments.creditDue().then(r => r.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['marketing-payments'] })
    queryClient.invalidateQueries({ queryKey: ['marketing-credit-due'] })
  }

  const postMut = useMutation({
    mutationFn: (id: string) => marketingApi.payments.post(id),
    onSuccess: () => { toast.success('Posted to accounting'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Post failed'),
  })

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Payment Activity</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === 'all' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-[160px] h-8"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="reconciled">Reconciled</SelectItem>
              <SelectItem value="needs_review">Needs review</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" />Record payment</Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <CreditDueCards creditDue={creditDue} />

        <Card className="mt-4">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad Account</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Platform Amount</TableHead>
                  <TableHead className="text-right">Actual BDT</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      No payments recorded yet. Click "Record payment" to add one.
                    </TableCell>
                  </TableRow>
                )}
                {(data?.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm font-medium">{p.adAccount?.name}</TableCell>
                    <TableCell className="text-sm">{fmtDate(p.paymentDate)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {Number(p.platformAmount).toFixed(2)} {p.platformCurrency}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {p.actualCost ? money(Number(p.actualCost)) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{p.sourceAccount?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[p.status] ?? 'secondary'}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {p.status === 'pending' && (
                          <Button variant="outline" size="sm" onClick={() => setReconcileTarget(p)}>
                            <ArrowRightLeft className="mr-1 h-3 w-3" />Reconcile
                          </Button>
                        )}
                        {p.status === 'reconciled' && !p.journalEntryId && (
                          <Button variant="outline" size="sm" onClick={() => postMut.mutate(p.id)} disabled={postMut.isPending}>
                            <FileText className="mr-1 h-3 w-3" />Post
                          </Button>
                        )}
                        {p.status === 'reconciled' && p.journalEntryId && (
                          <span className="text-xs text-muted-foreground">Posted</span>
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

      <AddPaymentDialog open={addOpen} onOpenChange={setAddOpen} adAccounts={adAccounts?.data ?? []} onSuccess={invalidate} />
      {reconcileTarget && (
        <ReconcileDialog payment={reconcileTarget} open={true} onOpenChange={() => setReconcileTarget(null)} onSuccess={invalidate} />
      )}
    </>
  )
}

function CreditDueCards({ creditDue }: { creditDue?: CreditDueResponse[] }) {
  if (!creditDue || creditDue.length === 0) return null

  const totals = creditDue.reduce(
    (acc, c) => ({
      totalCredit: acc.totalCredit + c.totalCredit,
      due: acc.due + c.due,
      netPosition: acc.netPosition + c.netPosition,
    }),
    { totalCredit: 0, due: 0, netPosition: 0 },
  )

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Prepaid Credit</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-600">{money(totals.totalCredit)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Amount Due</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-red-600">{money(totals.due)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Net Position</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${totals.netPosition >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {totals.netPosition >= 0 ? '+' : ''}{money(totals.netPosition)}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function AddPaymentDialog({
  open,
  onOpenChange,
  adAccounts,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  adAccounts: AdAccountResponse[]
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    adAccountId: '',
    platformAmount: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    sourceAccountId: '',
    notes: '',
  })

  const { data: accounts } = useQuery({
    queryKey: ['accounts-tree-payments'],
    queryFn: async () => {
      const { accountingApi } = await import('@/features/accounting/api')
      return accountingApi.getAccountTree().then(r => r.data)
    },
  })

  const walletAccounts = Array.isArray(accounts)
    ? (accounts as any[]).flatMap((a: any) => [a, ...(a.children || [])]).filter(
        (a: any) => a.type === 'asset' && !a.isGroup && !['marketing-prepaid', 'marketing-expense', 'marketing-payable'].includes(a.code)
      )
    : []

  const selectedAdAccount = adAccounts.find((a) => a.id === form.adAccountId)

  const createMut = useMutation({
    mutationFn: () => marketingApi.payments.create({
      adAccountId: form.adAccountId,
      platformAmount: parseFloat(form.platformAmount),
      platformCurrency: selectedAdAccount?.currency,
      paymentDate: form.paymentDate,
      sourceAccountId: form.sourceAccountId || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      toast.success('Payment recorded (pending reconciliation)')
      onOpenChange(false)
      setForm({ adAccountId: '', platformAmount: '', paymentDate: new Date().toISOString().slice(0, 10), sourceAccountId: '', notes: '' })
      onSuccess()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record payment'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Manually record a platform payment that was not automatically imported. Reconcile with actual BDT cost to derive the FX rate.
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Ad Account</Label>
            <Select value={form.adAccountId} onValueChange={(v) => setForm({ ...form, adAccountId: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select ad account" /></SelectTrigger>
              <SelectContent>
                {adAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Platform amount</Label>
              <Input type="number" step="0.01" value={form.platformAmount} onChange={(e) => setForm({ ...form, platformAmount: e.target.value })} placeholder="100.00" />
            </div>
            <div>
              <Label>Currency</Label>
              <Input value={selectedAdAccount?.currency ?? 'USD'} disabled />
            </div>
          </div>
          <div>
            <Label>Payment date</Label>
            <Input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
          </div>
          <div>
            <Label>Paid from (accounting wallet)</Label>
            <Select value={form.sourceAccountId} onValueChange={(v) => setForm({ ...form, sourceAccountId: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select wallet account" /></SelectTrigger>
              <SelectContent>
                {walletAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Payment reference" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!form.adAccountId || !form.platformAmount || createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReconcileDialog({
  payment,
  open,
  onOpenChange,
  onSuccess,
}: {
  payment: MarketingPaymentResponse
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const [actualCost, setActualCost] = useState('')
  const [sourceAccountId, setSourceAccountId] = useState(payment.sourceAccountId ?? '')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [feeAmount, setFeeAmount] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [notes, setNotes] = useState('')

  const platformAmount = Number(payment.platformAmount)
  const actualCostNum = parseFloat(actualCost) || 0
  const derivedRate = platformAmount > 0 && actualCostNum > 0
    ? Math.round((actualCostNum / platformAmount) * 10000) / 10000
    : 0

  const { data: accounts } = useQuery({
    queryKey: ['accounts-tree-reconcile'],
    queryFn: async () => {
      const { accountingApi } = await import('@/features/accounting/api')
      return accountingApi.getAccountTree().then(r => r.data)
    },
  })

  const walletAccounts = Array.isArray(accounts)
    ? (accounts as any[]).flatMap((a: any) => [a, ...(a.children || [])]).filter(
        (a: any) => a.type === 'asset' && !a.isGroup && !['marketing-prepaid', 'marketing-expense', 'marketing-payable'].includes(a.code)
      )
    : []

  const reconcileMut = useMutation({
    mutationFn: () => marketingApi.payments.reconcile(payment.id, {
      actualCost: actualCostNum,
      feeAmount: feeAmount ? parseFloat(feeAmount) : undefined,
      taxAmount: taxAmount ? parseFloat(taxAmount) : undefined,
    }),
    onSuccess: () => {
      toast.success('Payment reconciled')
      onOpenChange(false)
      onSuccess()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Reconciliation failed'),
  })

  const postMut = useMutation({
    mutationFn: () => marketingApi.payments.post(payment.id),
    onSuccess: () => { toast.success('Posted to accounting'); onOpenChange(false); onSuccess() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Post failed'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reconcile payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Ad Account</span><span className="font-medium">{payment.adAccount?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Platform amount</span><span className="font-medium tabular-nums">{Number(payment.platformAmount).toFixed(2)} {payment.platformCurrency}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Payment date</span><span className="font-medium">{fmtDate(payment.paymentDate)}</span></div>
          </div>

          <div>
            <Label>Actual BDT cost</Label>
            <Input type="number" step="0.01" value={actualCost} onChange={(e) => setActualCost(e.target.value)} placeholder="6600" />
          </div>

          {derivedRate > 0 && (
            <p className="text-xs text-muted-foreground">
              Effective rate: <span className="font-mono font-medium">{derivedRate.toFixed(4)} BDT / {payment.platformCurrency}</span>
            </p>
          )}

          <div>
            <Label>Accounting wallet</Label>
            <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select wallet used for payment" /></SelectTrigger>
              <SelectContent>
                {walletAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                Advanced breakdown
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Fee</Label>
                  <Input type="number" step="0.01" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <Label>Tax</Label>
                  <Input type="number" step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!actualCost || !sourceAccountId || reconcileMut.isPending}
            onClick={() => reconcileMut.mutate()}
          >
            {reconcileMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reconcile'}
          </Button>
          {payment.status === 'reconciled' && !payment.journalEntryId && (
            <Button
              variant="default"
              disabled={postMut.isPending}
              onClick={() => postMut.mutate()}
            >
              {postMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Post to accounting'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
