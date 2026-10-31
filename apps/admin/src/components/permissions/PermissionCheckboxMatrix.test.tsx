import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PermissionCheckboxMatrix } from './PermissionCheckboxMatrix'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

/** Shape of GET /permissions/catalogue, trimmed to a representative subset. */
const CATALOGUE = {
  groups: [
    {
      key: 'orders',
      label: 'Orders',
      group: 'SALES',
      feature: 'admin_orders',
      permissions: [
        { key: 'view_orders', label: 'View Orders' },
        { key: 'create_orders', label: 'Create Orders' },
        { key: 'refund_orders', label: 'Refund Orders' },
      ],
    },
    {
      key: 'hr_attendance_devices',
      label: 'Attendance Devices',
      group: 'HR',
      feature: 'admin_hr',
      permissions: [
        { key: 'view_hr_attendance_devices', label: 'View Attendance Devices' },
        // Legacy key that the old hardcoded matrix omitted entirely.
        { key: 'manage_attendance_devices', label: 'Manage Attendance Devices' },
      ],
    },
    {
      key: 'permissions',
      label: 'Permission Catalogue',
      group: 'USER_MGMT',
      feature: null,
      permissions: [{ key: 'view_permissions', label: 'View Permission Catalogue' }],
    },
  ],
  total: 6,
}

const ALL_CATALOGUE_KEYS = CATALOGUE.groups.flatMap((g) => g.permissions.map((p) => p.key))

function mockCatalogue() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/permissions/catalogue') return Promise.resolve({ data: CATALOGUE })
    return Promise.reject(new Error(`Unexpected URL: ${url}`))
  })
}

/** Matrix with local state, so it behaves like its three real call sites. */
function ControlledMatrix({ initial = [] as string[] }) {
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <>
      <PermissionCheckboxMatrix selected={selected} onChange={setSelected} />
      <output data-testid='selected'>{JSON.stringify(selected)}</output>
    </>
  )
}

function wrap(ui: React.ReactElement): Promise<RenderResult> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PermissionCheckboxMatrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCatalogue()
  })

  it('fetches the catalogue and renders every group and permission from it', async () => {
    const screen = await wrap(<ControlledMatrix />)

    // Nothing is hardcoded: the labels come from the response body.
    await expect.element(screen.getByText('Orders', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()
    await expect.element(screen.getByText('Create Orders')).toBeInTheDocument()
    await expect.element(screen.getByText('Refund Orders')).toBeInTheDocument()
    await expect.element(screen.getByText('Attendance Devices', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('Manage Attendance Devices')).toBeInTheDocument()

    // Owner UX call (2026-10-31): raw permission keys (view_orders) are
    // NOT rendered next to the labels — labels only, the key stays an
    // internal identifier (search still matches it).
    expect(screen.getByText('view_orders', { exact: true }).elements()).toHaveLength(0)
    expect(screen.getByText('create_orders', { exact: true }).elements()).toHaveLength(0)

    expect(mockGet).toHaveBeenCalledWith('/permissions/catalogue')
  })

  it('badges modules that need a licence feature and leaves ungated ones bare', async () => {
    const screen = await wrap(<ControlledMatrix />)

    await expect.element(screen.getByText('admin_orders', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('admin_hr', { exact: true })).toBeInTheDocument()
    await expect
      .element(screen.getByText('Permission Catalogue', { exact: true }))
      .toBeInTheDocument()
  })

  it('shows a loading state and no empty matrix while the catalogue is in flight', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))

    const screen = await wrap(<ControlledMatrix />)

    await expect.element(screen.getByText(/Loading permissions/i)).toBeInTheDocument()
    expect(screen.getByTestId('selected').element().textContent).toBe('[]')
  })

  it('shows an error state with a retry instead of an empty matrix when the fetch fails', async () => {
    mockGet.mockImplementation(() => Promise.reject(new Error('boom')))

    const screen = await wrap(<ControlledMatrix />)

    await expect
      .element(screen.getByText(/Could not load the permission catalogue/i))
      .toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.getByTestId('selected').element().textContent).toBe('[]')
  })

  it('Select All on a module toggles every key of that module', async () => {
    const screen = await wrap(<ControlledMatrix />)

    const selectAll = screen.getByRole('checkbox', {
      name: 'Select all Orders permissions',
    })
    await userEvent.click(selectAll)

    const emitted = JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]') as string[]
    expect([...emitted].sort()).toEqual(['create_orders', 'refund_orders', 'view_orders'])
    expect(emitted).toHaveLength(3)

    // Tri-state: fully selected now, so the same control clears the module.
    await expect.element(selectAll).toBeChecked()
    await userEvent.click(selectAll)

    expect(JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]')).toEqual([])
  })

  it('Select All leaves other modules untouched', async () => {
    const screen = await wrap(<ControlledMatrix initial={['view_permissions']} />)

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all Attendance Devices permissions' }),
    )

    const emitted = JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]') as string[]
    expect([...emitted].sort()).toEqual([
      'manage_attendance_devices',
      'view_hr_attendance_devices',
      'view_permissions',
    ])
  })

  it('toggling an individual permission emits the full selection', async () => {
    const screen = await wrap(<ControlledMatrix initial={['view_orders']} />)

    await userEvent.click(screen.getByRole('checkbox', { name: /Refund Orders/ }))

    expect(JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]')).toEqual([
      'view_orders',
      'refund_orders',
    ])
  })

  it('emits only keys present in the fetched catalogue', async () => {
    // A legacy row can still carry a key the catalogue no longer serves.
    const screen = await wrap(
      <ControlledMatrix initial={['view_orders', 'delete_everything', 'manage_hr_settings']} />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /View Orders/ }))

    const emitted = JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]') as string[]
    // Deselecting removes view_orders; the other two survive untouched...
    expect(emitted).toEqual(['delete_everything', 'manage_hr_settings'])
    // ...and neither is a catalogue key, so the counter ignores them.
    await expect.element(screen.getByText(/\[0\/6 selected\]/)).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all Orders permissions' }),
    )
    const afterSelectAll = JSON.parse(
      screen.getByTestId('selected').element().textContent ?? '[]',
    ) as string[]
    expect(afterSelectAll.filter((key) => ALL_CATALOGUE_KEYS.includes(key)).sort()).toEqual([
      'create_orders',
      'refund_orders',
      'view_orders',
    ])
  })

  it('counts the selection against the catalogue total', async () => {
    const screen = await wrap(<ControlledMatrix initial={['view_orders', 'manage_hr_settings']} />)

    await expect.element(screen.getByText(/\[1\/6 selected\]/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /Refund Orders/ }))

    await expect.element(screen.getByText(/\[2\/6 selected\]/)).toBeInTheDocument()
  })

  it('filters by key or label as the search box is typed into', async () => {
    const screen = await wrap(<ControlledMatrix />)

    const search = screen.getByRole('textbox', { name: 'Search permissions' })

    // 6 permissions + 3 module select-alls when nothing is filtered.
    const checkboxes = screen.getByRole('checkbox')
    await vi.waitFor(() => expect(checkboxes.length).toBe(9))

    // By key: only refund_orders survives, so only its module is left.
    await userEvent.fill(search, 'refund_orders')
    await expect.element(screen.getByText('Refund Orders')).toBeInTheDocument()
    await vi.waitFor(() => expect(checkboxes.length).toBe(2))

    // By label: one match, in the Attendance Devices module.
    await userEvent.fill(search, 'Manage Attendance Devices')
    await expect.element(screen.getByText('Manage Attendance Devices')).toBeInTheDocument()
    await vi.waitFor(() => expect(checkboxes.length).toBe(2))
    await expect
      .element(screen.getByRole('checkbox', { name: 'Select all Attendance Devices permissions' }))
      .toBeInTheDocument()

    // No match.
    await userEvent.fill(search, 'zzz-no-such-permission')
    await expect
      .element(screen.getByText(/No permissions match “zzz-no-such-permission”/))
      .toBeInTheDocument()

    await userEvent.fill(search, '')
    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()
    await vi.waitFor(() => expect(checkboxes.length).toBe(9))
  })

  it('keeps Select All scoped to the filtered permissions of a module', async () => {
    const screen = await wrap(<ControlledMatrix />)

    await userEvent.fill(screen.getByRole('textbox', { name: 'Search permissions' }), 'refund')

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select all Orders permissions' }),
    )

    // Only the match is visible in the group, so only it is toggled.
    expect(JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]')).toEqual([
      'refund_orders',
    ])
  })

  it('collapses and expands a module', async () => {
    const screen = await wrap(<ControlledMatrix />)

    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle Orders' }))

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Toggle Orders' })).toHaveAttribute(
        'data-state',
        'closed',
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Toggle Orders' }))
    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()
  })

  it('shift-click selects the whole visible range in two clicks', async () => {
    const screen = await wrap(<ControlledMatrix />)
    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()

    // Click 1 anchors on the first Orders permission...
    await userEvent.click(screen.getByRole('checkbox', { name: /View Orders/ }))
    // ...shift-click 2 spans to the last one, selecting everything between.
    await userEvent.keyboard('{Shift>}')
    await userEvent.click(screen.getByRole('checkbox', { name: /Refund Orders/ }))
    await userEvent.keyboard('{/Shift}')

    const emitted = JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]') as string[]
    expect([...emitted].sort()).toEqual(['create_orders', 'refund_orders', 'view_orders'])
  })

  it('shift-click across modules spans every visible permission between', async () => {
    const screen = await wrap(<ControlledMatrix />)
    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /View Orders/ }))
    await userEvent.keyboard('{Shift>}')
    await userEvent.click(screen.getByRole('checkbox', { name: /Manage Attendance Devices/ }))
    await userEvent.keyboard('{/Shift}')

    const emitted = JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]') as string[]
    // view_orders … manage_attendance_devices in render order: the 3 Orders
    // keys plus both Attendance Devices keys.
    expect([...emitted].sort()).toEqual([
      'create_orders',
      'manage_attendance_devices',
      'refund_orders',
      'view_hr_attendance_devices',
      'view_orders',
    ])
  })

  it('shift-click a fully-selected range deselects it', async () => {
    const screen = await wrap(
      <ControlledMatrix initial={['view_orders', 'create_orders']} />,
    )
    await expect.element(screen.getByText('View Orders')).toBeInTheDocument()

    // Click Refund to complete the Orders module (anchors on Refund)...
    await userEvent.click(screen.getByRole('checkbox', { name: /Refund Orders/ }))
    // ...then shift-click View: the whole View..Refund range is on, so it clears.
    await userEvent.keyboard('{Shift>}')
    await userEvent.click(screen.getByRole('checkbox', { name: /View Orders/ }))
    await userEvent.keyboard('{/Shift}')

    const emitted = JSON.parse(screen.getByTestId('selected').element().textContent ?? '[]') as string[]
    expect(emitted).toEqual([])
  })
})