import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useCommissionRulesV2, useSetRuleActiveV2Mutation } from './hooks'
import { RuleDialogV2 } from './components/rule-dialog-v2'
import { CommissionReportTable } from './components/commission-report'
import { EarningsTable } from './components/earnings-table'
import { dhakaTodayString, toDhakaDateString } from '@/lib/dhaka-time'
import type { CommissionRuleV2 } from './api'
import { money } from './components/money'

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This Month' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom' },
] as const

/** Business dates use the Dhaka calendar day, not the browser's UTC day. */
function rangeFor(preset: string, customFrom: string, customTo: string) {
  const now = new Date()
  const shift = (days: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    return toDhakaDateString(d)
  }
  switch (preset) {
    case 'today':
      return { from: toDhakaDateString(now), to: toDhakaDateString(now) }
    case '30d':
      return { from: shift(-30), to: toDhakaDateString(now) }
    case 'custom':
      return { from: customFrom || undefined, to: customTo || undefined }
    case 'month':
    default: {
      const today = dhakaTodayString()
      return { from: `${today.slice(0, 7)}-01`, to: today }
    }
  }
}

function formatRuleAmount(rule: CommissionRuleV2) {
  return rule.amountType === 'percent' ? `${rule.amount}%` : money(rule.amount)
}

export function CommissionsPage() {
  const { data: rules, isLoading, isError, refetch } = useCommissionRulesV2({})
  const setActiveMut = useSetRuleActiveV2Mutation()

  const [preset, setPreset] = useState<string>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const { from, to } = rangeFor(preset, customFrom, customTo)
  const rows = rules ?? []

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Commission</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              Pay employees per operational action. For each action, only the first person to move
              an order into it earns.
            </p>
          </div>
          <RuleDialogV2 />
        </div>

        <Tabs defaultValue='rules' className='flex flex-col gap-4'>
          <TabsList>
            <TabsTrigger value='rules'>Rules</TabsTrigger>
            <TabsTrigger value='report'>Report</TabsTrigger>
            <TabsTrigger value='legacy'>Legacy Earnings</TabsTrigger>
          </TabsList>

          {/* ── Rules ── */}
          <TabsContent value='rules'>
            <Card>
              <CardHeader className='px-5 py-4'>
                <CardTitle className='text-base'>Commission Rules</CardTitle>
                <CardDescription>
                  One employee can hold several rules for different actions; they are independent.
                </CardDescription>
              </CardHeader>
              <CardContent className='px-5 pb-5'>
                {isLoading ? (
                  <div className='grid gap-2'>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className='h-12 w-full' />
                    ))}
                  </div>
                ) : isError ? (
                  <div className='py-8 text-center'>
                    <p className='text-sm text-destructive'>Could not load commission rules.</p>
                    <Button variant='link' size='sm' onClick={() => refetch()}>
                      Retry
                    </Button>
                  </div>
                ) : rows.length === 0 ? (
                  <p className='py-8 text-center text-sm text-muted-foreground'>
                    No rules yet. Create one to start paying commission for an action.
                  </p>
                ) : (
                  <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader className='bg-muted/30'>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead className='text-right'>Commission</TableHead>
                          <TableHead>Conditions</TableHead>
                          <TableHead>Valid</TableHead>
                          <TableHead className='w-[110px]'>State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((rule) => (
                          <TableRow key={rule.id}>
                            <TableCell>
                              <p className='text-sm font-medium'>{rule.employeeName ?? '-'}</p>
                              <p className='text-[11px] text-muted-foreground'>
                                {rule.employeeCode ?? ''}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant='outline' className='text-[10px]'>
                                {rule.purpose}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-right font-semibold tabular-nums'>
                              {formatRuleAmount(rule)}
                            </TableCell>
                            <TableCell>
                              <Conditions rule={rule} />
                            </TableCell>
                            <TableCell className='text-[11px] text-muted-foreground'>
                              {rule.effectiveFrom ? (
                                <>
                                  {rule.effectiveFrom.slice(0, 10)}
                                  {rule.effectiveTo ? ` to ${rule.effectiveTo.slice(0, 10)}` : ' to'}
                                </>
                              ) : (
                                'Always'
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant='outline'
                                size='sm'
                                className='h-7 text-[11px]'
                                disabled={setActiveMut.isPending}
                                onClick={() =>
                                  setActiveMut.mutate({ id: rule.id, isActive: !rule.isActive })
                                }
                              >
                                {rule.isActive ? 'Deactivate' : 'Reactivate'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Report ── */}
          <TabsContent value='report'>
            <div className='mb-3 flex flex-wrap items-center gap-2'>
              {RANGES.map((r) => (
                <Button
                  key={r.value}
                  variant={preset === r.value ? 'default' : 'outline'}
                  size='sm'
                  onClick={() => setPreset(r.value)}
                >
                  {r.label}
                </Button>
              ))}
              {preset === 'custom' && (
                <>
                  <input
                    type='date'
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className='rounded-md border px-2 py-1 text-sm'
                  />
                  <input
                    type='date'
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className='rounded-md border px-2 py-1 text-sm'
                  />
                </>
              )}
              {from && to && (
                <span className='text-xs text-muted-foreground'>
                  {from} to {to}
                </span>
              )}
            </div>

            <Card>
              <CardHeader className='px-5 py-4'>
                <CardTitle className='text-base'>Commission Earned</CardTitle>
                <CardDescription>
                  Click any purpose total to see the orders behind it, and any order to see why it
                  was paid.
                </CardDescription>
              </CardHeader>
              <CardContent className='px-5 pb-5'>
                <CommissionReportTable from={from} to={to} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Legacy ── */}
          <TabsContent value='legacy'>
            <Card>
              <CardHeader className='px-5 py-4'>
                <CardTitle className='flex items-center gap-2 text-base'>Legacy Earnings and Reversals</CardTitle>
                <CardDescription>
                  Earnings from the original order-total rules, kept for reference and reversal.
                </CardDescription>
              </CardHeader>
              <CardContent className='px-5 pb-5'>
                <EarningsTable />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}

/** Render the rule's conditions as chips rather than prose. */
function Conditions({ rule }: { rule: CommissionRuleV2 }) {
  const bits: string[] = []
  if (rule.minimumCount) {
    bits.push(`after ${rule.minimumCount} ${rule.purpose}/${rule.thresholdPeriod}`)
  }
  if (rule.minOrderAmount != null) bits.push(`order >= ${money(rule.minOrderAmount)}`)
  if (rule.capPerOrder != null) bits.push(`cap ${money(rule.capPerOrder)}`)
  if (rule.amountType === 'percent' && rule.valueBasis === 'subtotal') bits.push('on subtotal')

  if (bits.length === 0) {
    return <span className='text-xs text-muted-foreground'>Every qualifying order</span>
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {bits.map((b) => (
        <span key={b} className='rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
          {b}
        </span>
      ))}
    </div>
  )
}
