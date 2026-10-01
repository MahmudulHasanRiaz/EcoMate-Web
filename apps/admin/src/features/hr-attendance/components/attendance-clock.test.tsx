import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AttendanceClock } from './attendance-clock'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

const auth = vi.hoisted(() => ({
  accessToken: 'tok' as string,
  permissions: ['view_hr'] as string[],
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({
      auth: {
        accessToken: auth.accessToken,
        user: { id: 'u1', email: 'a@b.c', role: 'employee', permissions: auth.permissions },
      },
    }),
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

type DayState = Record<string, unknown>

function mockRoutes(today: DayState | null, opts: { linked?: boolean } = {}) {
  const linked = opts.linked ?? true
  mockGet.mockImplementation((url: string) => {
    if (url === '/hr/my/profile') {
      return linked
        ? Promise.resolve({ data: { id: 'emp-1', attendanceMethod: 'APP' } })
        : Promise.reject({ response: { status: 404 } })
    }
    if (url === '/hr/my/attendance/today') return Promise.resolve({ data: today })
    return Promise.resolve({ data: {} })
  })
  mockPost.mockResolvedValue({ data: { id: 'x' } })
}

/** The widget portals into a <Header>-rendered slot; tests must provide one. */
function ensureHeaderSlot(): HTMLElement {
  let slot = document.querySelector<HTMLElement>('[data-attendance-clock-slot]')
  if (!slot) {
    slot = document.createElement('div')
    slot.setAttribute('data-attendance-clock-slot', '')
    document.body.appendChild(slot)
  }
  return slot
}

function wrap(ui: ReactElement) {
  const slot = ensureHeaderSlot()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
  return { ...result, slot }
}

const BASE = { workedMinutes: 0, breakMinutes: 0, appAllowed: true, appMethod: 'APP' }

describe('AttendanceClock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.accessToken = 'tok'
    auth.permissions = ['view_hr']
  })

  it('renders nothing without an access token', async () => {
    auth.accessToken = ''
    mockRoutes({ state: 'before_work', ...BASE })
    wrap(<AttendanceClock />)
    expect(document.querySelector('[aria-label="Attendance clock"]')).toBeNull()
  })

  it('renders nothing when no Employee record is linked to the account', async () => {
    mockRoutes({ state: 'before_work', ...BASE }, { linked: false })
    wrap(<AttendanceClock />)
    // Give the 404 probe a chance to resolve.
    await new Promise((r) => setTimeout(r, 50))
    expect(document.querySelector('[aria-label="Attendance clock"]')).toBeNull()
  })

  it('still renders for a staff member with NO access preset permissions', async () => {
    // Employees without an AccessPreset legitimately carry `permissions: []`.
    // Gating on that array hid the widget from exactly the people it is for.
    auth.permissions = []
    mockRoutes({ state: 'before_work', ...BASE })
    wrap(<AttendanceClock />)
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Attendance clock"]')).not.toBeNull()
    })
  })

  it('hides entirely when the system mode blocks app attendance', async () => {
    mockRoutes({
      state: 'before_work',
      ...BASE,
      appAllowed: false,
      appBlockedReason: 'Application attendance is disabled in MACHINE mode.',
    })
    wrap(<AttendanceClock />)
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Attendance clock"]')).toBeNull()
    })
  })

  it('shows the clock and an idle state chip for an employee before work', async () => {
    mockRoutes({ state: 'before_work', ...BASE })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(trigger.textContent).toContain('Not In')
  })

  it('renders a ticking Dhaka clock', async () => {
    mockRoutes({ state: 'before_work', ...BASE })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    // en-GB 24h HH:mm — two digits, a colon, two digits.
    expect(trigger.textContent).toMatch(/\d{2}:\d{2}/)
  })

  it('shows Working chip once checked in', async () => {
    mockRoutes({ state: 'working', checkInAt: '2026-08-24T03:02:00.000Z', ...BASE })
    wrap(<AttendanceClock />)
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Attendance clock"]')?.textContent).toContain(
        'Working'
      )
    })
  })

  it('shows Checked Out chip after checkout', async () => {
    mockRoutes({
      state: 'checked_out',
      checkInAt: '2026-08-24T03:02:00.000Z',
      checkOutAt: '2026-08-24T12:44:00.000Z',
      ...BASE,
    })
    wrap(<AttendanceClock />)
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Attendance clock"]')?.textContent).toContain(
        'Checked Out'
      )
    })
  })
})

describe('AttendanceClock actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.accessToken = 'tok'
    auth.permissions = ['view_hr']
  })

  it('offers only Check In before work', async () => {
    mockRoutes({ state: 'before_work', ...BASE })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    trigger.click()
    await vi.waitFor(() => {
      const labels = [...document.querySelectorAll('button')].map((b) => b.textContent)
      expect(labels).toContain('Check In')
      expect(labels).not.toContain('Check Out')
      expect(labels).not.toContain('Start Break')
    })
  })

  it('offers Start Break and Check Out while working', async () => {
    mockRoutes({ state: 'working', checkInAt: '2026-08-24T03:02:00.000Z', ...BASE })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    trigger.click()
    await vi.waitFor(() => {
      const labels = [...document.querySelectorAll('button')].map((b) => b.textContent)
      expect(labels).toContain('Start Break')
      expect(labels).toContain('Check Out')
      expect(labels).not.toContain('Check In')
    })
  })

  it('offers only End Break while on break', async () => {
    mockRoutes({ state: 'on_break', checkInAt: '2026-08-24T03:02:00.000Z', ...BASE })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    trigger.click()
    await vi.waitFor(() => {
      const labels = [...document.querySelectorAll('button')].map((b) => b.textContent)
      expect(labels).toContain('End Break')
      expect(labels).not.toContain('Start Break')
    })
  })

  it('offers no action buttons once checked out', async () => {
    mockRoutes({
      state: 'checked_out',
      checkInAt: '2026-08-24T03:02:00.000Z',
      checkOutAt: '2026-08-24T12:44:00.000Z',
      ...BASE,
    })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    trigger.click()
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Your attendance for today is complete.')
    })
  })

  it('links to /op/my-profile in the popover footer', async () => {
    mockRoutes({ state: 'before_work', ...BASE })
    wrap(<AttendanceClock />)
    const trigger = await vi.waitFor(() => {
      const el = document.querySelector('[aria-label="Attendance clock"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    trigger.click()
    await vi.waitFor(() => {
      const link = document.querySelector('a[href="/op/my-profile"]')
      expect(link).not.toBeNull()
      expect(link?.textContent).toContain('My Attendance & Leaves')
    })
  })
})