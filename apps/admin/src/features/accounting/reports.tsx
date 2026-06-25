import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, FileSpreadsheet, FileText } from 'lucide-react'
import { accountingApi, type AccountResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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

function TrialBalanceTab({ periodId }: { periodId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['trial-balance', periodId],
    queryFn: () => accountingApi.trialBalance(periodId).then(r => r.data),
    enabled: !!periodId,
  })

  if (!periodId) {
    return (
      <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
        <FileSpreadsheet className='h-10 w-10 mb-2' />
        <p>Select a period to view trial balance</p>
      </div>
    )
  }

  if (isLoading) {
    return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
  }

  if (error) {
    return <div className='text-center py-8 text-destructive'>Error loading trial balance</div>
  }

  const rows = data?.accounts || []
  const totalDebit = data?.totalDebit || 0
  const totalCredit = data?.totalCredit || 0

  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className='text-right'>Debit</TableHead>
                <TableHead className='text-right'>Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='text-center py-8 text-muted-foreground'>No data</TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow key={row.account_id || i}>
                    <TableCell className='font-mono text-xs'>{row.account_code}</TableCell>
                    <TableCell>{row.account_name}</TableCell>
                    <TableCell>
                      <Badge variant='secondary' className='text-xs'>{row.type}</Badge>
                    </TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(parseFloat(row.total_debit) || 0)}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(parseFloat(row.total_credit) || 0)}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalDebit)}</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {totalDebit === totalCredit ? (
        <p className='text-sm text-green-600 text-center'>Trial balance is balanced.</p>
      ) : (
        <p className='text-sm text-destructive text-center'>Trial balance is unbalanced!</p>
      )}
    </div>
  )
}

function ProfitLossTab({ periodId }: { periodId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['profit-loss', periodId],
    queryFn: () => accountingApi.profitAndLoss(periodId).then(r => r.data),
    enabled: !!periodId,
  })

  if (!periodId) {
    return (
      <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
        <FileSpreadsheet className='h-10 w-10 mb-2' />
        <p>Select a period to view profit & loss</p>
      </div>
    )
  }

  if (isLoading) {
    return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
  }

  const income = data?.incomeAccounts || []
  const expenses = data?.expenseAccounts || []
  const totalIncome = data?.totalIncome || 0
  const totalExpense = data?.totalExpense || 0
  const netProfit = data?.netProfit || 0

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader><CardTitle className='text-base'>Income</CardTitle></CardHeader>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {income.length === 0 ? (
                <TableRow><TableCell colSpan={2} className='text-center py-4 text-muted-foreground'>No income accounts</TableCell></TableRow>
              ) : (
                income.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.account_name}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(Math.abs(Number(row.balance) || 0))}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell>Total Income</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalIncome)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className='text-base'>Expenses</CardTitle></CardHeader>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.length === 0 ? (
                <TableRow><TableCell colSpan={2} className='text-center py-4 text-muted-foreground'>No expense accounts</TableCell></TableRow>
              ) : (
                expenses.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.account_name}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(Math.abs(Number(row.balance) || 0))}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell>Total Expenses</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalExpense)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={netProfit >= 0 ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'}>
        <CardContent className='py-4'>
          <div className='flex justify-between items-center'>
            <span className='font-semibold text-lg'>Net {netProfit >= 0 ? 'Profit' : 'Loss'}</span>
            <span className={`font-bold text-lg font-mono ${netProfit >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              {formatCurrency(netProfit)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function BalanceSheetTab({ periodId }: { periodId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['balance-sheet', periodId],
    queryFn: () => accountingApi.balanceSheet(periodId).then(r => r.data),
    enabled: !!periodId,
  })

  if (!periodId) {
    return (
      <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
        <FileSpreadsheet className='h-10 w-10 mb-2' />
        <p>Select a period to view balance sheet</p>
      </div>
    )
  }

  if (isLoading) {
    return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
  }

  const assets = data?.assetAccounts || []
  const liabilities = data?.liabilityAccounts || []
  const equity = data?.equityAccounts || []
  const totalAssets = data?.totalAssets || 0
  const totalLiabilities = data?.totalLiabilities || 0
  const totalEquity = data?.totalEquity || 0

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader><CardTitle className='text-base'>Assets</CardTitle></CardHeader>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.length === 0 ? (
                <TableRow><TableCell colSpan={2} className='text-center py-4 text-muted-foreground'>No asset accounts</TableCell></TableRow>
              ) : (
                assets.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.account_name}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(Math.abs(Number(row.balance) || 0))}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell>Total Assets</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalAssets)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className='text-base'>Liabilities</CardTitle></CardHeader>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liabilities.length === 0 ? (
                <TableRow><TableCell colSpan={2} className='text-center py-4 text-muted-foreground'>No liability accounts</TableCell></TableRow>
              ) : (
                liabilities.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.account_name}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(Math.abs(Number(row.balance) || 0))}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell>Total Liabilities</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalLiabilities)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className='text-base'>Equity</CardTitle></CardHeader>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equity.length === 0 ? (
                <TableRow><TableCell colSpan={2} className='text-center py-4 text-muted-foreground'>No equity accounts</TableCell></TableRow>
              ) : (
                equity.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.account_name}</TableCell>
                    <TableCell className='text-right font-mono'>{formatCurrency(Math.abs(Number(row.balance) || 0))}</TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell>Total Equity</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalEquity)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className='border-green-200 dark:border-green-800'>
        <CardContent className='py-4'>
          <div className='flex justify-between items-center'>
            <span className='font-semibold'>Total Liabilities & Equity</span>
            <span className='font-bold font-mono'>{formatCurrency(totalLiabilities + totalEquity)}</span>
          </div>
          <div className='flex justify-between items-center mt-1 text-sm text-muted-foreground'>
            <span>Assets must equal Liabilities + Equity</span>
            <span className={totalAssets === totalLiabilities + totalEquity ? 'text-green-600' : 'text-destructive'}>
              {totalAssets === totalLiabilities + totalEquity ? 'Balanced' : 'Unbalanced'}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function AccountLedgerTab({ periodId, accountId: selectedAccountId }: { periodId: string; accountId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['account-ledger', selectedAccountId, periodId],
    queryFn: () => accountingApi.accountLedger(selectedAccountId, periodId || undefined).then(r => r.data),
    enabled: !!selectedAccountId,
  })

  if (!selectedAccountId) {
    return (
      <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
        <FileText className='h-10 w-10 mb-2' />
        <p>Select an account above to view ledger</p>
      </div>
    )
  }

  if (isLoading) {
    return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
  }

  const entries = data?.entries || []
  const totalDebit = data?.totalDebit || 0
  const totalCredit = data?.totalCredit || 0
  let runningBalance = 0

  return (
    <div className='space-y-4'>
      <div className='text-sm'>
        <span className='text-muted-foreground'>Account:</span>{' '}
        <span className='font-medium'>{data?.account?.code} - {data?.account?.name}</span>
        <Badge variant='secondary' className='ml-2'>{data?.account?.type}</Badge>
      </div>

      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry No.</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className='text-right'>Debit</TableHead>
                <TableHead className='text-right'>Credit</TableHead>
                <TableHead className='text-right'>Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>No entries found</TableCell>
                </TableRow>
              ) : (
                entries.map(entry => {
                  runningBalance += entry.debit - entry.credit
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className='whitespace-nowrap'>{formatDate(entry.entry.entryDate)}</TableCell>
                      <TableCell className='font-mono text-xs'>{entry.entry.entryNo}</TableCell>
                      <TableCell>{entry.entry.description}</TableCell>
                      <TableCell className='text-right font-mono'>{entry.debit > 0 ? formatCurrency(entry.debit) : ''}</TableCell>
                      <TableCell className='text-right font-mono'>{entry.credit > 0 ? formatCurrency(entry.credit) : ''}</TableCell>
                      <TableCell className='text-right font-mono font-medium'>{formatCurrency(runningBalance)}</TableCell>
                    </TableRow>
                  )
                })
              )}
              <TableRow className='border-t-2 font-medium'>
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalDebit)}</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalCredit)}</TableCell>
                <TableCell className='text-right font-mono'>{formatCurrency(totalDebit - totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export function Reports() {
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState('')

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
  const accountsByType = groupAccountsByType(accountsList)

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
            <h2 className='text-2xl font-bold tracking-tight'>Accounting Reports</h2>
            <p className='text-muted-foreground'>View trial balance, profit & loss, balance sheet, and account ledger.</p>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
            <SelectTrigger className='w-[250px]'>
              <SelectValue placeholder='Select period' />
            </SelectTrigger>
            <SelectContent>
              {periods.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue='trial-balance'>
          <TabsList>
            <TabsTrigger value='trial-balance'>Trial Balance</TabsTrigger>
            <TabsTrigger value='profit-loss'>Profit & Loss</TabsTrigger>
            <TabsTrigger value='balance-sheet'>Balance Sheet</TabsTrigger>
            <TabsTrigger value='ledger'>Account Ledger</TabsTrigger>
          </TabsList>
          <TabsContent value='trial-balance' className='mt-4'>
            <TrialBalanceTab periodId={selectedPeriodId} />
          </TabsContent>
          <TabsContent value='profit-loss' className='mt-4'>
            <ProfitLossTab periodId={selectedPeriodId} />
          </TabsContent>
          <TabsContent value='balance-sheet' className='mt-4'>
            <BalanceSheetTab periodId={selectedPeriodId} />
          </TabsContent>
          <TabsContent value='ledger' className='mt-4'>
            <div className='mb-4'>
              <Select value={selectedLedgerAccountId} onValueChange={setSelectedLedgerAccountId}>
                <SelectTrigger className='w-[350px]'>
                  <SelectValue placeholder='Select account' />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(accountsByType).map(([type, accts]) => (
                    <div key={type}>
                      <div className='px-2 py-1 text-xs font-medium text-muted-foreground uppercase'>{type}</div>
                      {accts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AccountLedgerTab periodId={selectedPeriodId} accountId={selectedLedgerAccountId} />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
