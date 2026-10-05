import { describe, expect, it, vi, beforeEach, afterEach, type ReactElement } from 'vitest'
import { render, cleanup } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RuleDialogV2 } from '../rule-dialog-v2'
import { RuleEditor, draftFromRule, emptyDraft } from '../rule-editor'
import { EmployeeRulesCard, groupRulesByEmployee } from '../employee-rules-card'
import { CommissionReportTable } from '../commission-report'
import type { CommissionReportResponse, CommissionRuleV2 } from '../../api'

// hoisted so the mock factory and the tests share one instance (ESM browser mode
// has no `require`).
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({ apiClient: mockApi }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const EMPLOYEES = {
  data: {
    data: [
      { id: 'emp-a', employeeId: 'EMP-001', betterAuthUser: { name: 'Rahim Khan' } },
      { id: 'emp-b', employeeId: 'EMP-002', betterAuthUser: { name: 'Karim Uddin' } },
    ],
  },
}

const REPORT: CommissionReportResponse = {
  data: [
    {
      employeeId: 'emp-a',
      employeeCode: 'EMP-001',
      name: 'Rahim Khan',
      avatar: null,
      department: 'Ops',
      totalEarned: 14550,
      paid: 0,
      unpaid: 14550,
      earningCount: 24,
      byPurpose: [
        { purpose: 'Confirmed', amount: 4500, count: 900 },
        { purpose: 'Packed', amount: 7200, count: 900 },
        { purpose: 'Delivered', amount: 2850, count: 900 },
      ],
    },
  ],
  totals: { totalEarned: 14550, totalPaid: 0, totalUnpaid: 14550, employeeCount: 1 },
}

function rule(overrides: Partial<CommissionRuleV2> = {}): CommissionRuleV2 {
  return {
    id: 'r1',
    employeeId: 'emp-a',
    employeeName: 'Rahim Khan',
    employeeCode: 'EMP-001',
    department: 'Ops',
    avatar: null,
    name: null,
    purpose: 'Confirmed',
    amountType: 'fixed',
    amount: 50,
    valueBasis: 'order_total',
    minOrderAmount: null,
    capPerOrder: null,
    minimumCount: null,
    thresholdPeriod: null,
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    summary: 'Rahim Khan earns ৳50.00 per qualifying Confirmed order.',
    ...overrides,
  }
}

/**
 * Render inside a fresh QueryClient. `render` is async here and returns the
 * locators, so they are destructured at the call site.
 */
async function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

/**
 * Click the "New Commission Rule" trigger by DOM query rather than by text
 * locator: the button lives inside a Radix DialogTrigger, and `getByText`
 * resolves against the render tree, not the portal the dialog moves into.
 */
async function openDialog() {
  const trigger = document.querySelector('[data-slot="dialog-trigger"]') as HTMLElement
  await userEvent.click(trigger)
  await vi.waitFor(() => {
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeTruthy()
  })
}

/**
 * Open the employee picker and choose the first result.
 *
 * `SearchableSelect` renders its options as plain buttons inside a Popover
 * (not an ARIA listbox), so an option is located by its visible name.
 */
async function pickFirstEmployee() {
  await vi.waitFor(
    () => {
      expect(document.querySelector('[role="combobox"]')).toBeTruthy()
    },
    { timeout: 3000 },
  )
  await userEvent.click(document.querySelector('[role="combobox"]') as HTMLElement)
  await vi.waitFor(
    () => {
      expect(document.querySelector('[data-slot="popover-content"]')).toBeTruthy()
    },
    { timeout: 3000 },
  )
  const option = [...document.querySelectorAll('[data-slot="popover-content"] button')].find((b) =>
    (b.textContent || '').includes('Rahim Khan'),
  ) as HTMLElement
  expect(option).toBeTruthy()
  await userEvent.click(option)
}

/**
 * Route the mocked client by URL so each component sees only its own data.
 *
 * The rules endpoint honours the `employeeId` filter exactly as the real one
 * does, so a test can prove the modal really scopes to the selected employee
 * rather than merely rendering whatever the mock returns.
 */
function routeApi(rules: CommissionRuleV2[] = []) {
  mockApi.get.mockImplementation((url: string, config?: any) => {
    if (url === '/employees') return Promise.resolve(EMPLOYEES)
    if (url === '/hr/commissions/v2/rules') {
      const employeeId = config?.params?.employeeId
      return Promise.resolve({
        data: employeeId ? rules.filter((r) => r.employeeId === employeeId) : rules,
      })
    }
    if (url === '/hr/commissions/v2/report') return Promise.resolve({ data: REPORT })
    return Promise.resolve({ data: { data: [], meta: {} } })
  })
}

// Radix portals dialogs into document.body, so each render must be torn down or
// the next test asserts against the previous test's DOM.
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RuleEditor', () => {
  beforeEach(() => routeApi())

  it('renders the full configuration for one rule, from Commission For down', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    const t = document.body.textContent || ''
    for (const label of ['Commission For', 'Commission Type', 'Fixed Amount', 'Percentage', 'Runs from', 'Runs until']) {
      expect(t).toContain(label)
    }
  })

  it('blocks saving a new rule that duplicates a purpose already in use', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={['Confirmed']} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    const saveBtn = document.querySelector('[data-save-rule]') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
    expect(document.body.textContent).toContain('already has a rule for that action')
  })

  it('offers every date mode for a rule\'s own window', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    const t = document.body.textContent || ''
    // Start: Today / On a date / Always. End: Endless / Ends on a date.
    expect(t).toContain('Today')
    expect(t).toContain('On a date')
    expect(t).toContain('Always')
    expect(t).toContain('Endless')
    expect(t).toContain('Ends on a date')
  })

  it('states that the end date is inclusive', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    draft.rule.effectiveTo = '2026-10-04'
    await wrap(
      <RuleEditor draft={draft} saved={rule({ effectiveTo: '2026-10-04' })} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    expect(document.body.textContent).toMatch(/end date is inclusive/i)
  })

  it('warns when a rule is set to start in the future', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    draft.rule.effectiveFrom = '2099-01-01'
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    expect(document.querySelector('[data-future-start-warning]')).toBeTruthy()
    expect(document.body.textContent).toMatch(/pays nothing before that date/i)
  })

  it('does not warn when the rule starts today', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    const today = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10)
    draft.rule.effectiveFrom = today
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    expect(document.querySelector('[data-future-start-warning]')).toBeNull()
  })

  it('surfaces a save error against its own block, not as a global failure', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error='This employee already has an active rule for that action' />,
    )

    expect(document.querySelector('[data-rule-error]')?.textContent).toContain('already has an active rule')
  })

  it('shows the threshold explanation with its exact start order', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    draft.rule.amount = 50
    draft.rule.minimumCount = 50
    draft.rule.thresholdPeriod = 'daily'
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    expect(document.body.textContent).toMatch(/only qualify — they do\s*not pay/i)
    expect(document.body.textContent).toMatch(/order #\s*51/)
  })

  it('previews the rule in plain language before saving', async () => {
    const draft = emptyDraft('emp-a', 'Confirmed')
    await wrap(
      <RuleEditor draft={draft} saved={null} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} isSaving={false} error={null} />,
    )

    // Amount is unset, so there is nothing truthful to summarise yet.
    expect(document.body.textContent).not.toContain('What this rule does')
  })

  it('offers "End now" on a saved, active, endless rule', async () => {
    const endless = draftFromRule(rule({ effectiveTo: null }))
    await wrap(
      <RuleEditor draft={endless} saved={rule({ effectiveTo: null })} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} onEndNow={() => {}} isSaving={false} error={null} />,
    )

    expect(document.querySelector('[data-end-now]')).toBeTruthy()
  })

  it('does not offer "End now" again on an already-ended rule', async () => {
    const ended = draftFromRule(rule({ effectiveTo: '2026-01-01' }))
    await wrap(
      <RuleEditor draft={ended} saved={rule({ effectiveTo: '2026-01-01' })} employeeName='Rahim Khan' usedPurposes={[]} onChange={() => {}} onSave={() => {}} onEndNow={() => {}} isSaving={false} error={null} />,
    )

    expect(document.querySelector('[data-end-now]')).toBeNull()
  })
})

describe('groupRulesByEmployee', () => {
  it('collapses several rules into one entry per employee', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', purpose: 'Confirmed' }),
      rule({ id: 'r2', purpose: 'Packed' }),
      rule({ id: 'r3', employeeId: 'emp-b', employeeName: 'Karim Uddin', purpose: 'Confirmed' }),
    ])

    expect(groups).toHaveLength(2)
    const byName = Object.fromEntries(groups.map((g) => [g.employeeName, g.rules.length]))
    expect(byName['Rahim Khan']).toBe(2)
    expect(byName['Karim Uddin']).toBe(1)
  })

  it('orders an employee\'s rules by the operational sequence', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', purpose: 'Delivered' }),
      rule({ id: 'r2', purpose: 'Confirmed' }),
      rule({ id: 'r3', purpose: 'Packed' }),
    ])

    expect(groups[0].rules.map((r) => r.purpose)).toEqual(['Confirmed', 'Packed', 'Delivered'])
  })

  it('sorts employees by name', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', employeeId: 'emp-b', employeeName: 'Karim Uddin' }),
      rule({ id: 'r2', employeeId: 'emp-a', employeeName: 'Rahim Khan' }),
    ])

    // Alphabetical: Karim before Rahim, regardless of insertion order.
    expect(groups.map((g) => g.employeeName)).toEqual(['Karim Uddin', 'Rahim Khan'])
  })

  it('returns nothing for no rules', async () => {
    expect(groupRulesByEmployee([])).toEqual([])
  })
})

describe('EmployeeRulesCard', () => {
  beforeEach(() => routeApi())

  it('shows one collapsed row per employee with their rule count', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', purpose: 'Confirmed' }),
      rule({ id: 'r2', purpose: 'Packed' }),
    ])
    await wrap(<EmployeeRulesCard group={groups[0]} />)

    await vi.waitFor(() => expect(document.body.textContent).toContain('Rahim Khan'))
    expect(document.body.textContent).toContain('2 rules')
    // Collapsed by default — the nested rules are not yet shown.
    expect(document.querySelector('[data-rule-row]')).toBeNull()
  })

  it('expands to reveal the nested rules', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', purpose: 'Confirmed', amount: 50 }),
      rule({ id: 'r2', purpose: 'Packed', amount: 30 }),
    ])
    const { getByText } = await wrap(<EmployeeRulesCard group={groups[0]} />)

    await userEvent.click(getByText('Rahim Khan'))

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-rule-row]').length).toBe(2)
    })
    const t = document.body.textContent || ''
    expect(t).toContain('Confirmed')
    expect(t).toContain('Packed')
  })

  it('distinguishes endless, ended and active rules rather than collapsing them', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', purpose: 'Confirmed', effectiveFrom: null, effectiveTo: null }),
      rule({ id: 'r2', purpose: 'Packed', effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' }),
    ])
    await wrap(<EmployeeRulesCard group={groups[0]} defaultExpanded />)

    await vi.waitFor(() => expect(document.body.textContent).toContain('Always'))
    const t = document.body.textContent || ''
    expect(t).toContain('Ended')
    // No start and no end is "Always", not "Endless" — the two are different
    // facts and must never be collapsed into one label.
    expect(t).not.toContain('Endless')
  })

  it('surfaces conditions as chips', async () => {
    const groups = groupRulesByEmployee([
      rule({ id: 'r1', minimumCount: 10, thresholdPeriod: 'monthly', capPerOrder: 100 }),
    ])
    await wrap(<EmployeeRulesCard group={groups[0]} defaultExpanded />)

    await vi.waitFor(() => expect(document.body.textContent).toContain('after 10 Confirmed/monthly'))
    expect(document.body.textContent).toContain('cap')
  })

  it('offers an edit action that opens the rule dialog', async () => {
    const groups = groupRulesByEmployee([rule({ id: 'r1' })])
    const { getByText } = await wrap(<EmployeeRulesCard group={groups[0]} />)

    await userEvent.click(getByText('Edit rules'))

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Commission Rules')
    })
  })
})

describe('RuleDialogV2', () => {
  beforeEach(() => routeApi())

  it('prompts for an employee before showing any rule', async () => {
    await wrap(<RuleDialogV2 />)
    await openDialog()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Select an employee to see their commission rules')
    })
    // No rule form is rendered before an employee exists.
    expect(document.body.textContent).not.toContain('Commission For')
  })

  it('offers "Add another rule" only once an employee is chosen', async () => {
    await wrap(<RuleDialogV2 />)
    await openDialog()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Select an employee to see their commission rules')
    })
    expect(document.querySelector('[data-add-rule]')).toBeNull()
  })

  it('loads exactly the selected employee\'s rules', async () => {
    routeApi([
      rule({ id: 'r1', employeeId: 'emp-a', purpose: 'Confirmed' }),
      rule({ id: 'r2', employeeId: 'emp-a', purpose: 'Packed' }),
      rule({ id: 'r3', employeeId: 'emp-b', purpose: 'Delivered' }),
    ])
    await wrap(<RuleDialogV2 />)
    await openDialog()

    await pickFirstEmployee()

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-rule-block]').length).toBe(2)
    })
    const t = document.body.textContent || ''
    expect(t).toContain('Confirmed')
    expect(t).toContain('Packed')
    // The other employee's rule must not leak into this employee's list.
    expect(t).not.toContain('Delivered')
  })

  it('says so plainly when the employee has no rules yet', async () => {
    routeApi([])
    await wrap(<RuleDialogV2 />)
    await openDialog()

    await pickFirstEmployee()

    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/has no commission rules yet/i)
    })
  })

  it('adds a new, fully-configured block from inside the dialog', async () => {
    await wrap(<RuleDialogV2 />)
    await openDialog()

    await pickFirstEmployee()

    await vi.waitFor(() => expect(document.querySelector('[data-add-rule]')).toBeTruthy())
    expect(document.querySelectorAll('[data-rule-block]').length).toBe(0)

    await userEvent.click(document.querySelector('[data-add-rule]') as HTMLElement)

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-rule-block]').length).toBe(1)
    })
    // The new block carries the whole configuration, not just a name field.
    const t = document.body.textContent || ''
    expect(t).toContain('Commission For')
    expect(t).toContain('Commission Type')
    expect(t).toContain('Runs from')
  })

  it('appends a block on an unused purpose without disturbing the existing ones', async () => {
    routeApi([rule({ id: 'r1', purpose: 'Confirmed' })])
    await wrap(<RuleDialogV2 />)
    await openDialog()

    await pickFirstEmployee()

    await vi.waitFor(() => expect(document.querySelectorAll('[data-rule-block]').length).toBe(1))
    await userEvent.click(document.querySelector('[data-add-rule]') as HTMLElement)

    await vi.waitFor(() => expect(document.querySelectorAll('[data-rule-block]').length).toBe(2))
    const purposes = [...document.querySelectorAll('[data-rule-block]')].map((el) =>
      el.getAttribute('data-purpose'),
    )
    // Exactly one block may hold Confirmed; the new one defaults elsewhere.
    expect(purposes.filter((p) => p === 'Confirmed')).toHaveLength(1)
    expect(purposes[1]).not.toBe('Confirmed')
  })
})

describe('CommissionReportTable', () => {
  beforeEach(() => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/hr/commissions/v2/report') return Promise.resolve({ data: REPORT })
      return Promise.resolve({ data: { data: [], meta: {} } })
    })
  })

  it('renders a purpose column per action with its order count', async () => {
    await wrap(<CommissionReportTable from='2026-10-01' to='2026-10-31' />)

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Rahim Khan')
    })

    const t = document.body.textContent || ''
    expect(t).toContain('Confirmed')
    expect(t).toContain('Packed')
    expect(t).toContain('Delivered')
    // Counts, not just money: a total without its volume hides the workload.
    expect(t).toContain('900 orders')
  })

  it('shows paid and unpaid separately', async () => {
    await wrap(<CommissionReportTable />)
    await vi.waitFor(() => expect(document.body.textContent).toContain('Rahim Khan'))

    const t = document.body.textContent || ''
    expect(t).toContain('Total Earned')
    expect(t).toContain('Paid')
    expect(t).toContain('Unpaid')
    expect(t).toContain('14,550.00')
  })

  it('renders an empty state rather than a blank table', async () => {
    mockApi.get.mockResolvedValue({
      data: { data: [], totals: { totalEarned: 0, totalPaid: 0, totalUnpaid: 0, employeeCount: 0 } },
    })
    await wrap(<CommissionReportTable />)
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('No commission has been earned')
    })
  })

  it('surfaces an error instead of claiming there is nothing', async () => {
    mockApi.get.mockRejectedValue(new Error('boom'))
    await wrap(<CommissionReportTable />)
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Could not load the commission report')
    })
    // Must NOT have fallen through to the empty state.
    expect(document.body.textContent).not.toContain('No commission has been earned')
  })
})