import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import type {
  BankAccountType,
  BankVerificationStatus,
  CreateBankAccountDto,
  EmployeeBankAccount,
} from '../api'

export function maskAccountNumber(number?: string | null) {
  if (!number || number.length < 4) return '****'
  return `****${number.slice(-4)}`
}

const VERIFICATION_BADGE: Record<BankVerificationStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' },
  VERIFIED: { label: 'Verified', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' },
}

const TYPE_LABELS: Record<BankAccountType, string> = {
  SAVINGS: 'Savings',
  CURRENT: 'Current',
  OTHERS: 'Others',
}

interface AccountFormState {
  bankName: string
  branchName: string
  accountName: string
  accountNumber: string
  accountType: BankAccountType | ''
  routingNumber: string
  isPrimary: boolean
  notes: string
}

const EMPTY_FORM: AccountFormState = {
  bankName: '',
  branchName: '',
  accountName: '',
  accountNumber: '',
  accountType: '',
  routingNumber: '',
  isPrimary: false,
  notes: '',
}

export interface BankAccountsCardProps {
  accounts: EmployeeBankAccount[]
  onAdd: (dto: CreateBankAccountDto) => void
  onEdit: (id: string, dto: Partial<CreateBankAccountDto>) => void
  onDelete: (id: string) => void
  onSetPrimary: (id: string) => void
  isLoading?: boolean
  isSubmitting?: boolean
}

interface AccountDialogProps {
  open: boolean
  title: string
  initial: AccountFormState
  submitLabel: string
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (form: AccountFormState) => void
}

function AccountDialog({
  open,
  title,
  initial,
  submitLabel,
  isSubmitting,
  onClose,
  onSubmit,
}: AccountDialogProps) {
  const [form, setForm] = useState<AccountFormState>(initial)

  const canSubmit = form.bankName.trim() && form.accountName.trim() && form.accountNumber.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-3 py-4 sm:grid-cols-2'>
          <div className='grid gap-2'>
            <Label>Bank Name</Label>
            <Input
              value={form.bankName}
              onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
              placeholder='e.g. DBBL'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Branch Name</Label>
            <Input
              value={form.branchName}
              onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))}
              placeholder='e.g. Gulshan'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Account Name</Label>
            <Input
              value={form.accountName}
              onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
              placeholder='Name on the account'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Account Number</Label>
            <Input
              value={form.accountNumber}
              onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              placeholder='Account number'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Account Type</Label>
            <Select
              value={form.accountType || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, accountType: v as BankAccountType }))}
            >
              <SelectTrigger><SelectValue placeholder='Select type' /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label>Routing Number</Label>
            <Input
              value={form.routingNumber}
              onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))}
              placeholder='Routing number'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder='Optional notes'
              rows={2}
            />
          </div>
          <div className='flex items-center justify-between rounded-lg border p-3'>
            <div>
              <p className='text-sm font-medium'>Primary account</p>
              <p className='text-xs text-muted-foreground'>Only one primary per employee.</p>
            </div>
            <Switch
              checked={form.isPrimary}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isPrimary: v }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSubmit(form)}
            disabled={!canSubmit || isSubmitting}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BankAccountsCard({
  accounts,
  onAdd,
  onEdit,
  onDelete,
  onSetPrimary,
  isLoading,
  isSubmitting,
}: BankAccountsCardProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{ account: EmployeeBankAccount; form: AccountFormState } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EmployeeBankAccount | null>(null)
  const [primaryTarget, setPrimaryTarget] = useState<EmployeeBankAccount | null>(null)

  function accountRow(account: EmployeeBankAccount): ReactNode {
    const verification = VERIFICATION_BADGE[account.verificationStatus] ?? VERIFICATION_BADGE.PENDING
    return (
      <div key={account.id} className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-sm font-medium'>{account.bankName}</p>
            {account.isPrimary && (
              <Badge variant='secondary' className='bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'>
                <Star className='h-3 w-3 mr-1' /> Primary
              </Badge>
            )}
            <Badge variant='outline' className={verification.className}>
              {verification.label}
            </Badge>
            {account.accountType && (
              <Badge variant='outline'>{TYPE_LABELS[account.accountType]}</Badge>
            )}
          </div>
          <p className='mt-1 text-sm text-muted-foreground'>
            {account.accountName} · <span className='font-mono'>{maskAccountNumber(account.accountNumber)}</span>
          </p>
        </div>
        <div className='flex items-center gap-1'>
          {!account.isPrimary && (
            <Button variant='ghost' size='sm' onClick={() => setPrimaryTarget(account)}>
              <Star className='h-3.5 w-3.5 mr-1' /> Set primary
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            onClick={() =>
              setEditTarget({
                account,
                form: {
                  bankName: account.bankName,
                  branchName: account.branchName || '',
                  accountName: account.accountName,
                  accountNumber: account.accountNumber,
                  accountType: account.accountType || '',
                  routingNumber: account.routingNumber || '',
                  isPrimary: account.isPrimary,
                  notes: account.notes || '',
                },
              })
            }
          >
            <Pencil className='h-3.5 w-3.5 mr-1' /> Edit
          </Button>
          <Button variant='ghost' size='sm' onClick={() => setDeleteTarget(account)}>
            <Trash2 className='h-3.5 w-3.5 mr-1' /> Delete
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Bank Accounts</CardTitle>
            <CardDescription>
              {accounts.length === 0
                ? 'No bank accounts recorded yet.'
                : `${accounts.length} account${accounts.length === 1 ? '' : 's'} on file.`}
            </CardDescription>
          </div>
          <Button size='sm' variant='outline' onClick={() => setAddOpen(true)}>
            <Plus className='h-3.5 w-3.5 mr-1' /> Add Account
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>Loading bank accounts…</p>
        ) : accounts.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            No bank accounts yet. Add one to record the employee's banking details.
          </p>
        ) : (
          <div className='space-y-3'>{accounts.map(accountRow)}</div>
        )}
      </CardContent>

      <AccountDialog
        open={addOpen}
        title='Add Bank Account'
        initial={EMPTY_FORM}
        submitLabel='Add Account'
        isSubmitting={isSubmitting}
        onClose={() => setAddOpen(false)}
        onSubmit={(form) => {
          onAdd({
            bankName: form.bankName,
            branchName: form.branchName || undefined,
            accountName: form.accountName,
            accountNumber: form.accountNumber,
            accountType: (form.accountType || undefined) as BankAccountType | undefined,
            routingNumber: form.routingNumber || undefined,
            isPrimary: form.isPrimary,
            notes: form.notes || undefined,
          })
          setAddOpen(false)
        }}
      />

      <AccountDialog
        open={!!editTarget}
        title='Edit Bank Account'
        initial={editTarget?.form ?? EMPTY_FORM}
        submitLabel='Save Changes'
        isSubmitting={isSubmitting}
        onClose={() => setEditTarget(null)}
        onSubmit={(form) => {
          if (!editTarget) return
          onEdit(editTarget.account.id, {
            bankName: form.bankName,
            branchName: form.branchName || undefined,
            accountName: form.accountName,
            accountNumber: form.accountNumber,
            accountType: (form.accountType || undefined) as BankAccountType | undefined,
            routingNumber: form.routingNumber || undefined,
            isPrimary: form.isPrimary,
            notes: form.notes || undefined,
          })
          setEditTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title='Delete Bank Account'
        desc={
          deleteTarget?.isPrimary
            ? 'This is the primary bank account for this employee. Deleting it will leave the employee without a primary account.'
            : `Delete ${deleteTarget?.bankName ?? 'this'} bank account? This cannot be undone.`
        }
        destructive
        confirmText='Delete'
        handleConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />

      <ConfirmDialog
        open={!!primaryTarget}
        onOpenChange={(o) => { if (!o) setPrimaryTarget(null) }}
        title='Set as Primary Account'
        desc={`Make ${primaryTarget?.bankName ?? 'this account'} the primary account? The current primary will be unset.`}
        confirmText='Set Primary'
        handleConfirm={() => {
          if (primaryTarget) onSetPrimary(primaryTarget.id)
          setPrimaryTarget(null)
        }}
      />
    </Card>
  )
}