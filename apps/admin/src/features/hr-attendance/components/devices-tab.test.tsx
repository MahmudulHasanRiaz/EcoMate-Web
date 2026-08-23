import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { DevicesTab } from './devices-tab'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockPatch = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, patch: mockPatch, put: vi.fn(), delete: mockDelete },
}))

const EMPLOYEES = [
  {
    id: 'emp-1',
    employeeId: 'EMP-001',
    employeeName: 'John Doe',
    betterAuthUser: { id: 'u1', name: 'John Doe', email: 'john@ecomate.com', role: 'employee' },
    department: null,
    designation: null,
    status: 'active',
    attendanceMethod: 'APP',
  },
]

const DEVICES = [
  {
    id: 'dev-1',
    name: 'Front Scanner',
    deviceType: 'FINGERPRINT',
    vendor: 'zkteco',
    identifier: null,
    location: 'Main gate',
    connectionMethod: 'API',
    host: '192.168.1.50',
    port: 4370,
    enabled: true,
    syncStatus: 'CONNECTED',
    lastSyncAt: '2026-08-23T04:00:00.000Z',
    lastSyncError: null,
    mappingCount: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-23T04:00:00.000Z',
  },
  {
    id: 'dev-2',
    name: 'Back Door',
    deviceType: 'CARD',
    vendor: null,
    identifier: 'SN-22',
    location: null,
    connectionMethod: 'API',
    host: '10.0.0.8',
    port: 5000,
    enabled: false,
    syncStatus: 'DISCONNECTED',
    lastSyncAt: null,
    lastSyncError: 'Connection timed out',
    mappingCount: 0,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
]

const MAPPINGS = [
  {
    id: 'map-1',
    deviceId: 'dev-1',
    employeeId: 'emp-1',
    deviceEmployeeId: 'ENROLL-7',
    createdAt: '2026-08-03T00:00:00.000Z',
    employee: { employeeId: 'EMP-001', betterAuthUser: { name: 'John Doe' } },
  },
]

function mockGetRoutes() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/employees') {
      return Promise.resolve({ data: { data: EMPLOYEES, meta: { total: 1, page: 1, perPage: 100, totalPages: 1 } } })
    }
    if (url === '/hr/attendance/devices') {
      return Promise.resolve({ data: DEVICES })
    }
    if (url === '/hr/attendance/devices/dev-1/mappings') {
      return Promise.resolve({ data: MAPPINGS })
    }
    return Promise.resolve({ data: {} })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DevicesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRoutes()
  })

  it('renders device rows with sync status badges for both states', async () => {
    const { getByText } = await wrap(<DevicesTab />)

    await expect.element(getByText('Front Scanner')).toBeInTheDocument()
    await expect.element(getByText('CONNECTED', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Back Door')).toBeInTheDocument()
    await expect.element(getByText('DISCONNECTED', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('192.168.1.50:4370')).toBeInTheDocument()
    await expect.element(getByText('Connection timed out')).toBeInTheDocument()
  })

  it('toggles enabled via PATCH when the switch is clicked', async () => {
    const { getByRole } = await wrap(<DevicesTab />)

    await vi.waitFor(() => expect(getByRole('switch').length).toBe(2))
    await getByRole('switch').nth(1).click()

    await vi.waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/hr/attendance/devices/dev-2', { enabled: true })
    })
  })

  it('creates a device via POST including credentialsEncrypted when provided', async () => {
    const { getByRole, getByPlaceholder } = await wrap(<DevicesTab />)

    await userEvent.click(getByRole('button', { name: /Add Device/i }))
    await expect.element(getByRole('heading', { name: 'Add Device' })).toBeInTheDocument()

    await userEvent.fill(getByPlaceholder('Front door scanner'), 'Warehouse reader')
    await userEvent.fill(getByPlaceholder('FINGERPRINT / CARD / FACE'), 'FINGERPRINT')
    await userEvent.fill(getByPlaceholder('Device password / secret'), 'secret-123')

    await getByRole('button', { name: /Add Device/ }).last().click()

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/hr/attendance/devices',
        expect.objectContaining({
          name: 'Warehouse reader',
          deviceType: 'FINGERPRINT',
          credentialsEncrypted: 'secret-123',
          enabled: false,
          connectionMethod: 'API',
        }),
      )
    })
  })

  it('lists mappings, adds a new one and deletes one', async () => {
    const { getByRole, getByText, getByPlaceholder, getByTitle } = await wrap(<DevicesTab />)

    await getByRole('button', { name: 'Mappings' }).first().click()

    await expect.element(getByText('ENROLL-7', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('EMP-001 · John Doe')).toBeInTheDocument()

    await getByRole('combobox').click()
    await getByRole('option', { name: /EMP-001 · John Doe/i }).click()
    await userEvent.fill(getByPlaceholder('Fingerprint enrolment ID'), 'ENROLL-99')
    await getByRole('button', { name: 'Add', exact: true }).click()

    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/hr/attendance/devices/dev-1/mappings', {
        employeeId: 'emp-1',
        deviceEmployeeId: 'ENROLL-99',
      })
    })

    await getByTitle('Remove mapping').click()

    await vi.waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/hr/attendance/devices/dev-1/mappings/map-1')
    })
  })
})