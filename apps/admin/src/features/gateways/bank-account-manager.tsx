import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { gatewayApi, type BankAccount, type BankAccountInput } from './api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Pencil, Plus, Trash2, Landmark } from 'lucide-react'

const EMPTY_FORM: BankAccountInput = {
  bankName: '',
  accountHolderName: '',
  accountNumber: '',
  branchName: '',
  routingNumber: '',
  accountType: 'SAVINGS',
  isActive: true,
}

function AccountForm({
  initial,
  onCancel,
  onSubmit,
  busy,
}: {
  initial?: BankAccount
  onCancel: () => void
  onSubmit: (data: BankAccountInput) => void
  busy: boolean
}) {
  const [form, setForm] = useState<BankAccountInput>(
    initial
      ? {
          bankName: initial.bankName,
          accountHolderName: initial.accountHolderName,
          accountNumber: initial.accountNumber,
          branchName: initial.branchName,
          routingNumber: initial.routingNumber,
          accountType: initial.accountType,
          isActive: initial.isActive,
        }
      : EMPTY_FORM,
  )
  const set = (key: keyof BankAccountInput, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }))

  const valid =
    form.bankName.trim() !== '' &&
    form.accountHolderName.trim() !== '' &&
    form.accountNumber.trim() !== '' &&
    form.branchName.trim() !== '' &&
    form.routingNumber.trim() !== ''

  return (
    <div className='rounded-lg border bg-background p-3 space-y-3'>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='ba-bankName' className='text-xs font-semibold'>Bank Name</Label>
          <Input id='ba-bankName' className='h-9' value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder='e.g. Dutch-Bangla Bank' />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='ba-accountHolderName' className='text-xs font-semibold'>Account Holder Name</Label>
          <Input id='ba-accountHolderName' className='h-9' value={form.accountHolderName} onChange={(e) => set('accountHolderName', e.target.value)} placeholder='Account holder name' />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='ba-accountNumber' className='text-xs font-semibold'>Account Number</Label>
          <Input id='ba-accountNumber' className='h-9' value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} placeholder='Account number' />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='ba-branchName' className='text-xs font-semibold'>Branch Name</Label>
          <Input id='ba-branchName' className='h-9' value={form.branchName} onChange={(e) => set('branchName', e.target.value)} placeholder='Branch name' />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='ba-routingNumber' className='text-xs font-semibold'>Routing Number</Label>
          <Input id='ba-routingNumber' className='h-9' value={form.routingNumber} onChange={(e) => set('routingNumber', e.target.value)} placeholder='9-digit Bangladesh Bank routing number' />
        </div>
        <div className='space-y-2'>
          <Label className='text-xs font-semibold'>Account Type</Label>
          <Select value={form.accountType} onValueChange={(v) => set('accountType', v)}>
            <SelectTrigger className='h-9'><SelectValue placeholder='Select' /></SelectTrigger>
            <SelectContent>
              <SelectItem value='SAVINGS'>Savings</SelectItem>
              <SelectItem value='CURRENT'>Current</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className='flex items-center justify-between gap-3'>
        <label className='flex items-center gap-2 text-xs font-semibold'>
          <Switch checked={form.isActive ?? true} onCheckedChange={(v) => set('isActive', v)} />
          Active — shown to customers at checkout
        </label>
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size='sm' onClick={() => onSubmit(form)} disabled={!valid || busy}>
            {busy && <Loader2 className='animate-spin h-3.5 w-3.5 mr-2' />}
            {initial ? 'Save Changes' : 'Save Account'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Bank (manual) gateway account list, rendered inside the gateway's
 * settings card. Accounts are NPSB payment instructions — customers see
 * them at checkout, so the list shows exactly what checkout shows.
 */
export function BankAccountManager() {
  const queryClient = useQueryClient()
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => gatewayApi.listBankAccounts().then((r) => r.data),
  })
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Account awaiting delete confirmation. The confirm step used to be a
  // native window.confirm, which never surfaces in automated browsers
  // (they auto-dismiss it → confirm returns false) and can be suppressed
  // by dialog blockers — the click then did nothing at all: no dialog,
  // no toast, no request. An in-app ConfirmDialog renders in the DOM, so
  // the confirmation is clickable in every context, human or automated.
  const [deleting, setDeleting] = useState<BankAccount | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })

  const createMut = useMutation({
    mutationFn: (data: BankAccountInput) => gatewayApi.createBankAccount(data),
    onSuccess: () => {
      toast.success('Bank account added')
      setAdding(false)
      invalidate()
    },
    onError: () => toast.error('Failed to add bank account'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BankAccountInput> }) =>
      gatewayApi.updateBankAccount(id, data),
    onSuccess: () => {
      toast.success('Bank account updated')
      setEditingId(null)
      invalidate()
    },
    onError: () => toast.error('Failed to update bank account'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => gatewayApi.deleteBankAccount(id),
    onSuccess: () => {
      toast.success('Bank account deleted')
      setDeleting(null)
      invalidate()
    },
    onError: () => toast.error('Failed to delete bank account'),
  })

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <Label className='text-xs font-semibold flex items-center gap-1.5'>
          <Landmark className='h-3 w-3' /> Bank Accounts
        </Label>
        {!adding && (
          <Button size='sm' variant='outline' onClick={() => { setEditingId(null); setAdding(true) }}>
            <Plus className='h-3.5 w-3.5 mr-1' /> Add Account
          </Button>
        )}
      </div>

      {isLoading && (
        <p className='text-[11px] text-muted-foreground'>Loading bank accounts…</p>
      )}
      {!isLoading && (accounts ?? []).length === 0 && !adding && (
        <p className='text-[11px] text-muted-foreground rounded-lg border border-dashed p-3'>
          No bank accounts yet. Add the accounts customers should transfer to — they appear at checkout
          exactly as entered here.
        </p>
      )}

      {(accounts ?? []).map((a) => (
        <div key={a.id}>
          {editingId === a.id ? (
            <AccountForm
              initial={a}
              busy={updateMut.isPending}
              onCancel={() => setEditingId(null)}
              onSubmit={(data) => updateMut.mutate({ id: a.id, data })}
            />
          ) : (
            <div className='rounded-lg border bg-background p-3 space-y-1.5'>
              <div className='flex items-center justify-between gap-2'>
                <p className='text-xs font-bold'>{a.bankName}</p>
                <div className='flex items-center gap-2'>
                  <Badge variant={a.isActive ? 'default' : 'secondary'} className='text-[10px]'>
                    {a.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button size='sm' variant='ghost' className='h-7 px-2' aria-label='Edit account' onClick={() => { setAdding(false); setEditingId(a.id) }}>
                    <Pencil className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-7 px-2 text-destructive'
                    aria-label='Delete account'
                    onClick={() => setDeleting(a)}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>
              <p className='text-[11px] text-muted-foreground'>
                {a.accountHolderName} · {a.accountType === 'SAVINGS' ? 'Savings' : 'Current'} · {a.branchName} branch
              </p>
              <p className='text-xs font-mono'>A/C: {a.accountNumber}</p>
              <p className='text-[11px] text-muted-foreground'>Routing: {a.routingNumber}</p>
            </div>
          )}
        </div>
      ))}

      {adding && (
        <AccountForm
          busy={createMut.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(data) => createMut.mutate(data)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setDeleting(null) }}
          title='Delete bank account?'
          desc={`Delete the ${deleting.bankName} account (${deleting.accountNumber})? Customers will no longer see it at checkout.`}
          confirmText='Delete'
          destructive
          isLoading={deleteMut.isPending}
          handleConfirm={() => deleteMut.mutate(deleting.id)}
        />
      )}
    </div>
  )
}
