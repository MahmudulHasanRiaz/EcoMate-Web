import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, ChevronRight, ChevronDown, BookOpen, Lock, Unlock, Circle } from 'lucide-react'
import { accountingApi, type AccountResponse, type FinancialPeriodResponse } from './api'
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
import { Checkbox } from '@/components/ui/checkbox'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const typeBadgeClass: Record<string, string> = {
  asset: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  liability: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  equity: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  income: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  expense: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

function AccountTreeRow({
  account,
  depth,
  onEdit,
  onDelete,
  expanded,
  onToggle,
}: {
  account: AccountResponse
  depth: number
  onEdit: (a: AccountResponse) => void
  onDelete: (a: AccountResponse) => void
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const hasChildren = account.children && account.children.length > 0
  const isExpanded = expanded.has(account.id)

  return (
    <>
      <tr className='border-b last:border-0 hover:bg-muted/50 transition-colors'>
        <td className='py-2 px-4 text-sm' style={{ paddingLeft: `${12 + depth * 24}px` }}>
          <div className='flex items-center gap-1'>
            {hasChildren ? (
              <button onClick={() => onToggle(account.id)} className='h-4 w-4 flex items-center justify-center'>
                {isExpanded ? <ChevronDown className='h-3.5 w-3.5' /> : <ChevronRight className='h-3.5 w-3.5' />}
              </button>
            ) : (
              <span className='h-4 w-4 flex items-center justify-center'><Circle className='h-2 w-2 text-muted-foreground' /></span>
            )}
            <span className='font-mono text-xs text-muted-foreground mr-1'>{account.code}</span>
            <span>{account.name}</span>
            {account.isGroup && <Badge variant='outline' className='ml-1 text-[10px] h-4 px-1'>Group</Badge>}
          </div>
        </td>
        <td className='py-2 px-4'>
          <Badge variant='secondary' className={typeBadgeClass[account.type] || ''}>
            {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
          </Badge>
        </td>
        <td className='py-2 px-4'>
          {account.isActive ? (
            <Badge variant='outline' className='text-green-600 border-green-300 dark:border-green-700'>Active</Badge>
          ) : (
            <Badge variant='outline' className='text-muted-foreground'>Inactive</Badge>
          )}
        </td>
        <td className='py-2 px-4 text-right'>
          <div className='flex gap-1 justify-end'>
            <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => onEdit(account)}>
              <Pencil className='h-3.5 w-3.5' />
            </Button>
            {!account.isGroup && (
              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => onDelete(account)}>
                <Trash2 className='h-3.5 w-3.5 text-destructive' />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {hasChildren && isExpanded && account.children!.map(child => (
        <AccountTreeRow
          key={child.id}
          account={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

export function ChartOfAccounts() {
  const queryClient = useQueryClient()
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AccountResponse | null>(null)
  const [editingAccount, setEditingAccount] = useState<AccountResponse | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [accountForm, setAccountForm] = useState({
    code: '',
    name: '',
    type: '',
    parentId: '',
    isGroup: false,
  })
  const [periodForm, setPeriodForm] = useState({
    name: '',
    startDate: '',
    endDate: '',
  })

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountingApi.getAccountTree().then(r => r.data),
  })

  const { data: periodsData, isLoading: periodsLoading } = useQuery({
    queryKey: ['periods'],
    queryFn: () => accountingApi.listFinancialPeriods({ perPage: 50 }).then(r => r.data),
  })

  const { data: flatAccounts } = useQuery({
    queryKey: ['accounts-flat'],
    queryFn: () => accountingApi.listAccounts({ perPage: 200 }).then(r => r.data),
  })

  const createAccountMut = useMutation({
    mutationFn: (d: Parameters<typeof accountingApi.createAccount>[0]) => accountingApi.createAccount(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-flat'] })
      setAccountDialogOpen(false)
      resetAccountForm()
      toast.success('Account created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating account'),
  })

  const updateAccountMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Parameters<typeof accountingApi.updateAccount>[1] }) => accountingApi.updateAccount(id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-flat'] })
      setAccountDialogOpen(false)
      setEditingAccount(null)
      resetAccountForm()
      toast.success('Account updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating account'),
  })

  const deleteAccountMut = useMutation({
    mutationFn: (id: string) => accountingApi.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-flat'] })
      setDeleteTarget(null)
      toast.success('Account deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting account'),
  })

  const createPeriodMut = useMutation({
    mutationFn: (d: Parameters<typeof accountingApi.createFinancialPeriod>[0]) => accountingApi.createFinancialPeriod(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      setPeriodDialogOpen(false)
      setPeriodForm({ name: '', startDate: '', endDate: '' })
      toast.success('Period created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating period'),
  })

  const closePeriodMut = useMutation({
    mutationFn: (id: string) => accountingApi.closePeriod(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      toast.success('Period closed')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error closing period'),
  })

  const openPeriodMut = useMutation({
    mutationFn: (id: string) => accountingApi.openPeriod(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] })
      toast.success('Period opened')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error opening period'),
  })

  function resetAccountForm() {
    setAccountForm({ code: '', name: '', type: '', parentId: '', isGroup: false })
  }

  function openCreateAccount() {
    resetAccountForm()
    setEditingAccount(null)
    setAccountDialogOpen(true)
  }

  function openEditAccount(account: AccountResponse) {
    setEditingAccount(account)
    setAccountForm({
      code: account.code,
      name: account.name,
      type: account.type,
      parentId: account.parentId || '',
      isGroup: account.isGroup,
    })
    setAccountDialogOpen(true)
  }

  function handleSaveAccount() {
    const payload = {
      code: accountForm.code,
      name: accountForm.name,
      type: accountForm.type,
      parentId: accountForm.parentId || null,
      isGroup: accountForm.isGroup,
    }
    if (editingAccount) {
      updateAccountMut.mutate({ id: editingAccount.id, d: payload })
    } else {
      createAccountMut.mutate(payload)
    }
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const accountTree = Array.isArray(accounts) ? accounts : []
  const periods = Array.isArray(periodsData?.data) ? periodsData.data : []
  const flatAccountsList = Array.isArray(flatAccounts?.data) ? flatAccounts.data : []

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
            <h2 className='text-2xl font-bold tracking-tight'>Chart of Accounts</h2>
            <p className='text-muted-foreground'>Manage your chart of accounts and financial periods.</p>
          </div>
          <div className='flex gap-2'>
            <Button size='sm' onClick={openCreateAccount}>
              <Plus className='h-4 w-4 mr-1' /> Add Account
            </Button>
            <Button size='sm' variant='outline' onClick={() => setPeriodDialogOpen(true)}>
              <Plus className='h-4 w-4 mr-1' /> Create Period
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Financial Periods</CardTitle>
            <CardDescription>Accounting periods for journal entries and reports.</CardDescription>
          </CardHeader>
          <CardContent>
            {periodsLoading ? (
              <div className='flex justify-center py-6'>
                <Loader2 className='animate-spin h-5 w-5 text-muted-foreground' />
              </div>
            ) : periods.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-6 text-muted-foreground'>
                <BookOpen className='h-8 w-8 mb-2' />
                <p className='text-sm'>No financial periods yet</p>
              </div>
            ) : (
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                {periods.map(period => (
                  <div key={period.id} className='rounded-lg border p-3 space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='font-medium text-sm'>{period.name}</span>
                      {period.isClosed ? (
                        <Badge variant='outline' className='text-amber-600 border-amber-300 dark:border-amber-700'>Closed</Badge>
                      ) : (
                        <Badge variant='outline' className='text-green-600 border-green-300 dark:border-green-700'>Open</Badge>
                      )}
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      {formatDate(period.startDate)} — {formatDate(period.endDate)}
                    </div>
                    <div className='flex gap-1 pt-1'>
                      {period.isClosed ? (
                        <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => openPeriodMut.mutate(period.id)} disabled={openPeriodMut.isPending}>
                          <Unlock className='h-3 w-3 mr-1' /> Open
                        </Button>
                      ) : (
                        <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => closePeriodMut.mutate(period.id)} disabled={closePeriodMut.isPending}>
                          <Lock className='h-3 w-3 mr-1' /> Close
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Accounts</CardTitle>
            <CardDescription>Hierarchical chart of accounts.</CardDescription>
          </CardHeader>
          <CardContent className='p-0'>
            {accountsLoading ? (
              <div className='flex justify-center py-8'>
                <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
              </div>
            ) : accountTree.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-8 text-muted-foreground'>
                <BookOpen className='h-10 w-10 mb-2' />
                <p>No accounts yet</p>
              </div>
            ) : (
              <table className='w-full'>
                <thead>
                  <tr className='border-b bg-muted/50'>
                    <th className='text-left text-xs font-medium text-muted-foreground uppercase tracking-wider py-2 px-4'>Account</th>
                    <th className='text-left text-xs font-medium text-muted-foreground uppercase tracking-wider py-2 px-4'>Type</th>
                    <th className='text-left text-xs font-medium text-muted-foreground uppercase tracking-wider py-2 px-4'>Status</th>
                    <th className='text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-2 px-4 w-[100px]'></th>
                  </tr>
                </thead>
                <tbody>
                  {accountTree.map(account => (
                    <AccountTreeRow
                      key={account.id}
                      account={account}
                      depth={0}
                      onEdit={openEditAccount}
                      onDelete={setDeleteTarget}
                      expanded={expanded}
                      onToggle={toggleExpanded}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </Main>

      <Dialog open={accountDialogOpen} onOpenChange={o => { if (!o) { setAccountDialogOpen(false); setEditingAccount(null) } }}>
        <DialogContent className='sm:max-w-[500px]'>
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Account' : 'Add Account'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Code</Label>
              <Input
                value={accountForm.code}
                onChange={e => setAccountForm(f => ({ ...f, code: e.target.value }))}
                placeholder='1000'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input
                value={accountForm.name}
                onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
                placeholder='Cash'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Type</Label>
              <Select
                value={accountForm.type}
                onValueChange={v => setAccountForm(f => ({ ...f, type: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select type' />
                </SelectTrigger>
                <SelectContent>
                  {['asset', 'liability', 'equity', 'income', 'expense'].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Parent Account (optional)</Label>
              <Select
                value={accountForm.parentId}
                onValueChange={v => setAccountForm(f => ({ ...f, parentId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder='No parent' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=''>No parent</SelectItem>
                  {flatAccountsList.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='isGroup'
                checked={accountForm.isGroup}
                onCheckedChange={v => setAccountForm(f => ({ ...f, isGroup: v === true }))}
              />
              <Label htmlFor='isGroup'>Is Group</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setAccountDialogOpen(false); setEditingAccount(null) }}>Cancel</Button>
            <Button
              onClick={handleSaveAccount}
              disabled={!accountForm.code || !accountForm.name || !accountForm.type || createAccountMut.isPending || updateAccountMut.isPending}
            >
              {editingAccount ? 'Save Changes' : 'Create Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete this account? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant='destructive'
              onClick={() => deleteTarget && deleteAccountMut.mutate(deleteTarget.id)}
              disabled={deleteAccountMut.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={periodDialogOpen} onOpenChange={o => { if (!o) { setPeriodDialogOpen(false); setPeriodForm({ name: '', startDate: '', endDate: '' }) } }}>
        <DialogContent className='sm:max-w-[500px]'>
          <DialogHeader>
            <DialogTitle>Create Financial Period</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Name</Label>
              <Input
                value={periodForm.name}
                onChange={e => setPeriodForm(f => ({ ...f, name: e.target.value }))}
                placeholder='FY 2025 Q1'
              />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='grid gap-2'>
                <Label>Start Date</Label>
                <Input
                  type='date'
                  value={periodForm.startDate}
                  onChange={e => setPeriodForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className='grid gap-2'>
                <Label>End Date</Label>
                <Input
                  type='date'
                  value={periodForm.endDate}
                  onChange={e => setPeriodForm(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setPeriodDialogOpen(false); setPeriodForm({ name: '', startDate: '', endDate: '' }) }}>Cancel</Button>
            <Button
              onClick={() => createPeriodMut.mutate(periodForm as { name: string; startDate: string; endDate: string })}
              disabled={!periodForm.name || !periodForm.startDate || !periodForm.endDate || createPeriodMut.isPending}
            >
              Create Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
