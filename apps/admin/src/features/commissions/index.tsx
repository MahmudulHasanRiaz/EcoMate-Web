import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useCommissionRulesQuery, useSetRuleActiveMutation, useDeleteRuleMutation } from './hooks'
import { RuleDialog } from './components/rule-dialog'
import type { CommissionRule, CommissionAmountType } from './api'

const AMOUNT_TYPE_BADGE: Record<CommissionAmountType, string> = {
  fixed: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  percent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
}

function formatAmount(rule: CommissionRule) {
  return rule.amountType === 'percent'
    ? `${Number(rule.amount)}%`
    : `${Number(rule.amount).toLocaleString()} ৳`
}

export function CommissionsPage() {
  const { data: rules, isLoading, isError, refetch } = useCommissionRulesQuery({})
  const setActiveMut = useSetRuleActiveMutation()
  const deleteMut = useDeleteRuleMutation()
  const [deleteTarget, setDeleteTarget] = useState<CommissionRule | null>(null)

  const rows: CommissionRule[] = Array.isArray(rules) ? rules : []

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Commission Rules</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Define how employee sales commissions are calculated per order.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <CardTitle>Rules</CardTitle>
                <CardDescription>Active and inactive commission rules.</CardDescription>
              </div>
              <RuleDialog />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
            ) : isError ? (
              <div className='flex flex-col items-center gap-3 py-10 text-center'>
                <p className='text-sm text-muted-foreground'>Could not load commission rules.</p>
                <Button variant='outline' size='sm' onClick={() => refetch()}>
                  <RotateCcw className='h-4 w-4 mr-1' /> Retry
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className='py-8 text-center text-sm text-muted-foreground'>No commission rules yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className='text-right'>Amount</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className='w-32'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className='font-medium'>
                        {rule.employee?.employeeId} · {rule.employee?.betterAuthUser?.name || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`border-transparent ${AMOUNT_TYPE_BADGE[rule.amountType]}`}>
                          {rule.amountType === 'percent' ? 'Percent' : 'Fixed'}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right font-medium tabular-nums'>{formatAmount(rule)}</TableCell>
                      <TableCell>
                        <Button
                          variant={rule.isActive ? 'default' : 'outline'}
                          size='sm'
                          disabled={setActiveMut.isPending}
                          onClick={() => setActiveMut.mutate({ id: rule.id, isActive: !rule.isActive })}
                        >
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className='flex items-center gap-1'>
                          <RuleDialog rule={rule} />
                          <Button variant='ghost' size='sm' className='text-rose-600' onClick={() => setDeleteTarget(rule)}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Main>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title='Delete Commission Rule'
        desc={`Delete the rule for "${deleteTarget?.employee?.employeeId} · ${deleteTarget?.employee?.betterAuthUser?.name || '—'}"? This cannot be undone.`}
        confirmText='Delete'
        destructive
        isLoading={deleteMut.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }}
      />
    </>
  )
}
