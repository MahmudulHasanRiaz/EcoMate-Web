import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { dhakaTodayString } from '@/lib/dhaka-time'
import type { EmployeeResponse } from '@/features/employees/api'
import { useCommissionRulesV2, useSetRuleActiveV2Mutation } from '../hooks'
import type { CommissionRuleV2 } from '../api'
import { EffectiveRangeBadge } from './effective-range'
import { money } from './money'
import { RuleDialogV2 } from './rule-dialog-v2'

/**
 * An employee's commission rules, as one grouped block.
 *
 * Rendered in two places — the Commissions page and the employee profile — so
 * both surfaces answer "what does this person earn, and when" identically
 * instead of one showing a flat table and the other nothing at all.
 */

export interface EmployeeRuleGroup {
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  department: string | null
  avatar: string | null
  rules: CommissionRuleV2[]
}

/** Group flat rules into one entry per employee, sorted by name. */
export function groupRulesByEmployee(rules: CommissionRuleV2[]): EmployeeRuleGroup[] {
  const map = new Map<string, EmployeeRuleGroup>()
  for (const r of rules) {
    let g = map.get(r.employeeId)
    if (!g) {
      g = {
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
        department: r.department,
        avatar: r.avatar,
        rules: [],
      }
      map.set(r.employeeId, g)
    }
    g.rules.push(r)
  }

  // Within an employee, order rules by the operational sequence so the block
  // reads the way the work happens rather than by creation accident.
  const purposeOrder = ['Confirmed', 'Packed', 'Shipping', 'Delivered', 'Returned', 'Cancelled']
  const groups = [...map.values()]
  for (const g of groups) {
    g.rules.sort(
      (a, b) => purposeOrder.indexOf(a.purpose) - purposeOrder.indexOf(b.purpose),
    )
  }

  return groups.sort((a, b) =>
    (a.employeeName ?? a.employeeCode ?? '').localeCompare(
      b.employeeName ?? b.employeeCode ?? '',
    ),
  )
}

export function ConditionsChips({ rule }: { rule: CommissionRuleV2 }) {
  const bits: string[] = []
  if (rule.minimumCount) {
    bits.push(`after ${rule.minimumCount} ${rule.purpose}/${rule.thresholdPeriod}`)
  }
  if (rule.minOrderAmount != null) bits.push(`order ≥ ${money(rule.minOrderAmount)}`)
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

function ruleAmount(rule: CommissionRuleV2) {
  return rule.amountType === 'percent' ? `${rule.amount}%` : money(rule.amount)
}

/** Is this rule currently able to pay? Inactive and ended are distinct states. */
function ruleState(rule: CommissionRuleV2): { label: string; variant: 'default' | 'secondary' } {
  if (!rule.isActive) return { label: 'Inactive', variant: 'secondary' }
  if (rule.effectiveTo && rule.effectiveTo < dhakaTodayString()) {
    return { label: 'Ended', variant: 'secondary' }
  }
  if (rule.effectiveFrom && rule.effectiveFrom > dhakaTodayString()) {
    return { label: 'Scheduled', variant: 'secondary' }
  }
  return { label: 'Active', variant: 'default' }
}

/**
 * The rules block for one employee, with its own edit dialog. Used by the page
 * list and by the employee profile.
 */
export function EmployeeRulesCard({
  group,
  employee,
  defaultExpanded = false,
}: {
  group: EmployeeRuleGroup
  /** Present on the employee profile; opens the dialog pre-locked to them. */
  employee?: EmployeeResponse | null
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [dialogOpen, setDialogOpen] = useState(false)
  const setActiveMut = useSetRuleActiveV2Mutation()

  const displayName = group.employeeName ?? group.employeeCode ?? group.employeeId

  return (
    <div className='rounded-lg border' data-employee-group={group.employeeId}>
      {/* ── One row per employee ── */}
      <div className='flex items-center gap-3 p-3'>
        <button
          type='button'
          onClick={() => setExpanded((v) => !v)}
          className='flex min-w-0 flex-1 items-center gap-3 text-start'
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
          ) : (
            <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' />
          )}

          <Avatar className='h-8 w-8 shrink-0'>
            {group.avatar && <AvatarImage src={group.avatar} alt='' />}
            <AvatarFallback>
              <User className='h-3.5 w-3.5' />
            </AvatarFallback>
          </Avatar>

          <div className='min-w-0'>
            <p className='truncate text-sm font-medium'>{displayName}</p>
            <p className='truncate text-[11px] text-muted-foreground'>
              {[group.employeeCode, group.department].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>

          <Badge variant='secondary' className='ms-auto shrink-0 text-[10px]'>
            {group.rules.length} rule{group.rules.length === 1 ? '' : 's'}
          </Badge>
        </button>

        <Button
          variant='outline'
          size='sm'
          className='h-7 shrink-0 text-[11px]'
          onClick={() => setDialogOpen(true)}
          data-edit-rules={group.employeeId}
        >
          <Pencil className='me-1 h-3 w-3' />
          Edit rules
        </Button>
      </div>

      {/* ── Their rules, nested ── */}
      {expanded && (
        <div className='border-t'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b bg-muted/30'>
                <th className='px-3 py-1.5 text-start text-[11px] font-medium text-muted-foreground'>Action</th>
                <th className='px-3 py-1.5 text-end text-[11px] font-medium text-muted-foreground'>Commission</th>
                <th className='px-3 py-1.5 text-start text-[11px] font-medium text-muted-foreground'>Conditions</th>
                <th className='px-3 py-1.5 text-start text-[11px] font-medium text-muted-foreground'>Valid</th>
                <th className='px-3 py-1.5 text-start text-[11px] font-medium text-muted-foreground'>State</th>
              </tr>
            </thead>
            <tbody>
              {group.rules.map((rule) => {
                const state = ruleState(rule)
                return (
                  <tr key={rule.id} className='border-b last:border-0' data-rule-row={rule.id}>
                    <td className='px-3 py-2'>
                      <Badge variant='outline' className='text-[10px]'>
                        {rule.purpose}
                      </Badge>
                    </td>
                    <td className='px-3 py-2 text-end font-semibold tabular-nums'>
                      {ruleAmount(rule)}
                    </td>
                    <td className='px-3 py-2'>
                      <ConditionsChips rule={rule} />
                    </td>
                    <td className='px-3 py-2'>
                      <EffectiveRangeBadge
                        effectiveFrom={rule.effectiveFrom}
                        effectiveTo={rule.effectiveTo}
                      />
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex items-center gap-2'>
                        <Badge variant={state.variant} className='text-[10px]'>
                          {state.label}
                        </Badge>
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-6 text-[10px]'
                          disabled={setActiveMut.isPending}
                          onClick={() =>
                            setActiveMut.mutate({ id: rule.id, isActive: !rule.isActive })
                          }
                        >
                          {rule.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <RuleDialogV2
        // The grouped row already knows who this is, so the dialog opens
        // scoped and locked rather than asking the operator to pick again.
        // Without this the modal would start blank on the very page whose
        // whole point is that the employee is already chosen.
        employee={
          employee ??
          ({
            id: group.employeeId,
            employeeId: group.employeeCode ?? group.employeeId,
            betterAuthUserId: '',
            betterAuthUser: group.employeeName ? { name: group.employeeName } : null,
          } as unknown as EmployeeResponse)
        }
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}

/**
 * The full employee-grouped rules list for one employee, used on the profile
 * page where the employee is already known and there is nothing to group.
 */
export function EmployeeRulesPanel({ employee }: { employee: EmployeeResponse }) {
  const { data, isLoading, isError, refetch } = useCommissionRulesV2({ employeeId: employee.id })
  const [dialogOpen, setDialogOpen] = useState(false)

  if (isLoading) {
    return (
      <div className='grid gap-2'>
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className='h-16 w-full' />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className='py-6 text-center'>
        <p className='text-sm text-destructive'>Could not load commission rules.</p>
        <Button variant='link' size='sm' onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const groups = groupRulesByEmployee(data ?? [])
  const hasRules = groups.length > 0

  return (
    <div className='grid gap-2'>
      {hasRules ? (
        groups.map((g) => (
          <EmployeeRulesCard key={g.employeeId} group={g} employee={employee} defaultExpanded />
        ))
      ) : (
        <div className='rounded-lg border border-dashed py-8 text-center'>
          <p className='text-sm text-muted-foreground'>No commission rules set yet.</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            Add one for an action this person performs.
          </p>
        </div>
      )}

      <RuleDialogV2
        employee={employee}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {!hasRules && (
        <Button variant='outline' size='sm' className='justify-start' onClick={() => setDialogOpen(true)}>
          Edit rules
        </Button>
      )}
    </div>
  )
}