import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  COMMISSION_PURPOSES,
  type CommissionPurpose,
  type CommissionRuleV2,
} from '../api'
import { useCommissionRulesV2, useCreateRuleV2Mutation, useEndRuleV2Mutation, useUpdateRuleV2Mutation } from '../hooks'
import { RuleEditor, draftFromRule, emptyDraft, type RuleDraft } from './rule-editor'

/**
 * Employee-centric commission rule editor.
 *
 * One employee, one list, many rules. Picking the employee loads every rule
 * they already have; "Add another rule" appends a new, fully-configured block
 * inside the same dialog, and every block saves independently. That is the
 * whole point: configuring an employee's commission should never require
 * leaving this dialog, and their rules should never appear scattered across a
 * flat table.
 *
 * Used from two places — the page header (create) and an employee card
 * ("Edit rules", where the employee is already known and locked).
 */

const EMPLOYEE_PAGE_SIZE = 20

function useEmployeeSearch() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const { data, isFetching } = useQuery({
    // Keyed on the debounced term so each keystroke does not re-request, and the
    // result set is complete for the term rather than a truncated first page.
    queryKey: ['employees', 'commission-search', debounced],
    queryFn: () =>
      employeesApi
        .list({ page: 1, perPage: EMPLOYEE_PAGE_SIZE, search: debounced || undefined })
        .then((r) => r.data.data),
    staleTime: 30 * 1000,
  })

  return { search, setSearch, employees: data ?? [], isFetching }
}

interface RuleDialogProps {
  /** Preselect and lock an employee (used from the employee card). */
  employee?: EmployeeResponse | null
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (v: boolean) => void
}

export function RuleDialogV2({ employee, trigger, open: controlledOpen, onOpenChange }: RuleDialogProps) {
  const isControlled = controlledOpen !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = useCallback(
    (v: boolean) => {
      if (!isControlled) setUncontrolledOpen(v)
      onOpenChange?.(v)
    },
    [isControlled, onOpenChange],
  )

  const [employeeId, setEmployeeId] = useState<string>(employee?.id ?? '')
  const [drafts, setDrafts] = useState<RuleDraft[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({})
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const { search, setSearch, employees, isFetching } = useEmployeeSearch()
  const createMut = useCreateRuleV2Mutation()
  const updateMut = useUpdateRuleV2Mutation()
  const endMut = useEndRuleV2Mutation()

  // Only load rules once an employee is actually chosen. Passing the id through
  // to the query would fire a request for the empty string on first render.
  const { data: rules, isLoading: rulesLoading } = useCommissionRulesV2(
    employeeId ? { employeeId } : undefined,
  )

  const selectedEmployee: EmployeeResponse | null = useMemo(() => {
    if (employeeId && employee?.id === employeeId) return employee
    return employees.find((e) => e.id === employeeId) ?? null
  }, [employeeId, employee, employees])

  const employeeName =
    selectedEmployee?.betterAuthUser?.name ?? selectedEmployee?.employeeId ?? 'this employee'

  /**
   * Seed the draft list from the server exactly once per employee, so a later
   * refetch (or a save invalidating the query) cannot discard edits in progress.
   */
  useEffect(() => {
    if (!open || !employeeId || loadedFor === employeeId) return
    if (rulesLoading) return
    setDrafts((rules ?? []).map(draftFromRule))
    setErrors({})
    setLoadedFor(employeeId)
  }, [open, employeeId, rules, rulesLoading, loadedFor])

  // A fresh dialog must not inherit the previous employee's unsaved blocks.
  useEffect(() => {
    if (open) return
    setEmployeeId(employee?.id ?? '')
    setDrafts([])
    setErrors({})
    setLoadedFor(null)
    setSearch('')
  }, [open, employee])

  const savedByLocalId = useMemo(() => {
    const map: Record<string, CommissionRuleV2> = {}
    for (const r of rules ?? []) map[`rule-${r.id}`] = r
    return map
  }, [rules])

  /** Purposes already used by another block in this dialog, so none can repeat. */
  const usedPurposes = useMemo(() => {
    const counts = new Map<CommissionPurpose, number>()
    for (const d of drafts) counts.set(d.rule.purpose, (counts.get(d.rule.purpose) ?? 0) + 1)
    return counts
  }, [drafts])

  const purposesInUse = useMemo(
    () => [...usedPurposes.entries()].filter(([, n]) => n > 0).map(([p]) => p),
    [usedPurposes],
  )

  const availablePurposes = useMemo(
    () => COMMISSION_PURPOSES.filter((p) => !purposesInUse.includes(p.value)),
    [purposesInUse],
  )

  function selectEmployee(id: string) {
    setEmployeeId(id)
    setDrafts([])
    setErrors({})
    setLoadedFor(null)
  }

  function addNewRule() {
    const next = availablePurposes[0]?.value ?? COMMISSION_PURPOSES[0].value
    setDrafts((d) => [...d, emptyDraft(employeeId, next)])
  }

  function updateDraft(localId: string, next: RuleDraft) {
    setDrafts((d) => d.map((x) => (x.localId === localId ? next : x)))
  }

  function removeDraft(localId: string) {
    setDrafts((d) => d.filter((x) => x.localId !== localId))
    setErrors((e) => {
      const { [localId]: _removed, ...rest } = e
      return rest
    })
  }

  /**
   * Save one block. Errors are recorded against that block only — a failed rule
   * must never be reported as a blanket success, and must never stop the other
   * blocks from saving.
   */
  async function saveDraft(draft: RuleDraft): Promise<boolean> {
    setSavingIds((s) => ({ ...s, [draft.localId]: true }))
    setErrors((e) => ({ ...e, [draft.localId]: '' }))

    try {
      if (draft.id === null) {
        const created = await createMut.mutateAsync(draft.rule)
        // Replace the unsaved block with the persisted one, keeping its position
        // so the operator's ordering and any sibling edits are preserved.
        setDrafts((d) =>
          d.map((x) =>
            x.localId === draft.localId
              ? { ...draftFromRule(created), localId: draft.localId }
              : x,
          ),
        )
        setLoadedFor(employeeId)
        return true
      }

      await updateMut.mutateAsync({ id: draft.id, dto: draft.rule })
      setDrafts((d) => d.map((x) => (x.localId === draft.localId ? draft : x)))
      return true
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Could not save this rule'
      setErrors((e) => ({ ...e, [draft.localId]: msg }))
      return false
    } finally {
      setSavingIds((s) => ({ ...s, [draft.localId]: false }))
    }
  }

  /** Save every block; the dialog closes only when all of them succeeded. */
  async function saveAll() {
    const results = await Promise.all(drafts.map((d) => saveDraft(d)))
    if (results.every(Boolean)) setOpen(false)
  }

  async function endNow(draft: RuleDraft) {
    if (!draft.id) return
    setSavingIds((s) => ({ ...s, [draft.localId]: true }))
    try {
      const updated = await endMut.mutateAsync(draft.id)
      setDrafts((d) =>
        d.map((x) =>
          x.localId === draft.localId
            ? { ...draft, rule: { ...draft.rule, effectiveTo: updated.effectiveTo } }
            : x,
        ),
      )
    } catch (err: any) {
      setErrors((e) => ({
        ...e,
        [draft.localId]: err?.response?.data?.message || 'Could not end the rule',
      }))
    } finally {
      setSavingIds((s) => ({ ...s, [draft.localId]: false }))
    }
  }

  const employeeOptions: SearchableOption[] = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        label: e.betterAuthUser?.name ?? e.employeeId,
        subLabel: e.department?.name ?? e.employeeId,
      })),
    [employees],
  )

  const isSavingAny = Object.values(savingIds).some(Boolean)
  const hasDrafts = drafts.length > 0
  const allValid = drafts.every((d) => {
    const taken = usedPurposes.get(d.rule.purpose) ?? 0
    return d.rule.amount > 0 && (taken <= 1 || d.id !== null)
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus className='me-2 h-4 w-4' />
              New Commission Rule
            </Button>
          )}
        </DialogTrigger>
      )}

      {/* `overflow-x-hidden` is a guard, not decoration: at narrow widths a single
          wide child (a segmented control, a long employee name) would otherwise
          push the whole dialog into horizontal overflow. */}
      <DialogContent className='sm:max-w-[760px] max-h-[88vh] overflow-y-auto overflow-x-hidden'>
        <DialogHeader>
          <DialogTitle>Commission Rules</DialogTitle>
          <DialogDescription>
            Commission is credited to whoever FIRST moves an order into an action. A second person
            doing the same action on the same order earns nothing for it.
          </DialogDescription>
        </DialogHeader>

        {/* ── Employee ── */}
        {employee && employee.id === employeeId ? (
          <div className='flex items-center gap-3 rounded-lg border p-3'>
            <Avatar className='h-9 w-9'>
              {selectedEmployee?.profilePictureUrl && (
                <AvatarImage src={selectedEmployee.profilePictureUrl} alt='' />
              )}
              <AvatarFallback>
                <User className='h-4 w-4' />
              </AvatarFallback>
            </Avatar>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium'>{employeeName}</p>
              <p className='text-xs text-muted-foreground'>{employee.employeeId}</p>
            </div>
          </div>
        ) : (
          <div className='grid gap-2'>
            <label htmlFor='cr-employee' className='text-sm font-medium'>
              Employee
            </label>
            <SearchableSelect
              options={employeeOptions}
              value={employeeId || undefined}
              onChange={selectEmployee}
              placeholder={isFetching ? 'Searching…' : 'Select an employee'}
              searchPlaceholder='Search by name or code…'
              emptyMessage='No employees found'
            />
            {employeeId && !selectedEmployee && !isFetching && (
              <p className='text-xs text-muted-foreground'>
                Searching for this employee’s name…
              </p>
            )}
          </div>
        )}

        {/* ── Rules ── */}
        {employeeId ? (
          <div className='grid gap-3'>
            {rulesLoading && drafts.length === 0 ? (
              <div className='flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                Loading rules…
              </div>
            ) : !hasDrafts ? (
              <div className='rounded-lg border border-dashed py-8 text-center'>
                <p className='text-sm text-muted-foreground'>
                  {employeeName} has no commission rules yet.
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Add one to start paying for an action they perform.
                </p>
              </div>
            ) : (
              <>
                <p className='text-xs text-muted-foreground'>
                  {drafts.length} rule{drafts.length === 1 ? '' : 's'} for {employeeName}. Each one
                  pays for a different action, with its own amount, conditions and dates.
                </p>

                {drafts.map((d) => (
                  <RuleEditor
                    key={d.localId}
                    draft={d}
                    saved={savedByLocalId[d.localId] ?? null}
                    employeeName={employeeName}
                    usedPurposes={purposesInUse.filter((p) => p !== d.rule.purpose)}
                    onChange={(next) => updateDraft(d.localId, next)}
                    onSave={() => saveDraft(d)}
                    onEndNow={d.id ? () => endNow(d) : undefined}
                    onRemove={hasDrafts ? () => removeDraft(d.localId) : undefined}
                    isSaving={!!savingIds[d.localId]}
                    error={errors[d.localId] || null}
                  />
                ))}
              </>
            )}

            <Button
              variant='outline'
              size='sm'
              className='justify-start'
              onClick={addNewRule}
              disabled={isSavingAny}
              data-add-rule
            >
              <Plus className='me-2 h-4 w-4' />
              Add another rule
            </Button>
          </div>
        ) : (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            Select an employee to see their commission rules.
          </p>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={saveAll} disabled={!hasDrafts || !allValid || isSavingAny}>
            {isSavingAny && <Loader2 className='me-2 h-4 w-4 animate-spin' />}
            Save all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}