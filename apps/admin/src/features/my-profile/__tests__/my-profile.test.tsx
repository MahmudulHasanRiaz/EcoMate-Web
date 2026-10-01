import { describe, expect, it, vi, beforeEach, type ReactElement } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MyProfilePage } from '../index'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/op/my-profile' }),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockPatch = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
    put: vi.fn(),
    post: mockPost,
    patch: mockPatch,
    delete: vi.fn(),
  },
}))

const MOCK_PROFILE = {
  id: 'emp-1',
  employeeId: 'EMP-260823-0001',
  departmentId: 'dept-1',
  designationId: 'desig-1',
  employmentType: 'full_time',
  status: 'active',
  joiningDate: '2026-01-01T00:00:00.000Z',
  salary: 45000,
  attendanceMethod: 'APP',
  betterAuthUser: {
    name: 'Rahim Ahmed',
    email: 'rahim@ecomate.com',
  },
  department: { id: 'dept-1', name: 'Operations' },
  designation: { id: 'desig-1', name: 'Operations Executive' },
  reportingTo: {
    employeeId: 'EMP-MGR-01',
    betterAuthUser: { name: 'Karim Manager' },
  },
  salaryStructures: [
    {
      id: 'ss-1',
      basicSalary: 30000,
      houseAllowance: 10000,
      medicalAllowance: 5000,
      transportAllowance: 2000,
      otherAllowance: 0,
      taxDeduction: 1000,
      insuranceDeduction: 1000,
      otherDeduction: 0,
      totalEarnings: 47000,
      totalDeductions: 2000,
      netSalary: 45000,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    },
  ],
  bankAccounts: [
    {
      id: 'ba-1',
      accountTitle: 'Rahim Ahmed',
      accountNumber: '1234567890',
      bankName: 'City Bank',
      branchName: 'Gulshan',
      accountType: 'SAVINGS',
      isPrimary: true,
      verificationStatus: 'VERIFIED',
    },
  ],
}

const MOCK_PERFORMANCE = {
  orders: {
    totalAssignedOrders: 20,
    deliveredOrders: 18,
    processingOrders: 2,
    cancelledOrders: 0,
    totalDeliveredAmount: 36000,
    deliveryRate: 90,
    recentOrders: [
      {
        id: 'ord-1',
        displayId: 'ORD-260901-001',
        customerName: 'Sultana Begum',
        customerPhone: '01700000000',
        total: 2500,
        status: 'Delivered',
        statusColor: '#10B981',
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
  },
  leads: {
    assignedLeads: 15,
    convertedLeads: 12,
    conversionRate: 80,
  },
  tasks: {
    totalTasks: 8,
    completedTasks: 7,
    pendingTasks: 1,
    completionRate: 88,
    recentTasks: [
      {
        id: 'tsk-1',
        displayId: 'TSK-101',
        title: 'Review supplier manifest',
        status: 'done',
        priority: 'high',
        dueDate: '2026-09-10T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  },
  attendance: {
    presentDays: 22,
    lateDays: 1,
    halfDays: 0,
    absentDays: 0,
    totalWorkedMinutes: 10560,
    workedHours: 176,
    onTimeRate: 96,
  },
  financial: {
    baseSalary: 45000,
    totalCommission: 5000,
    monthCommission: 2500,
    totalBonuses: 3000,
    latestPayslip: {
      periodKey: '2026-08',
      netPay: 45000,
      status: 'paid',
      paidAt: '2026-09-01T00:00:00.000Z',
    },
  },
  leaves: {
    totalRemaining: 14,
    pendingCount: 1,
    balances: [
      {
        typeId: 'lt-1',
        typeName: 'Casual Leave',
        isPaid: true,
        entitlement: 10,
        used: 2,
        remaining: 8,
      },
      {
        typeId: 'lt-2',
        typeName: 'Sick Leave',
        isPaid: true,
        entitlement: 10,
        used: 4,
        remaining: 6,
      },
    ],
  },
}

function mockApiRoutes(profileData: any = MOCK_PROFILE) {
  mockGet.mockImplementation((url: string) => {
    if (url === '/hr/my/profile') {
      return Promise.resolve({ data: profileData })
    }
    if (url === '/hr/my/performance') {
      return Promise.resolve({ data: MOCK_PERFORMANCE })
    }
    if (url === '/hr/my/leave-balances') {
      return Promise.resolve({ data: MOCK_PERFORMANCE.leaves.balances })
    }
    if (url === '/hr/my/leave-types') {
      return Promise.resolve({
        data: [
          { id: 'lt-1', name: 'Casual Leave', code: 'CL', daysPerYear: 10, isPaid: true, isActive: true },
          { id: 'lt-2', name: 'Sick Leave', code: 'SL', daysPerYear: 10, isPaid: true, isActive: true },
        ],
      })
    }
    if (url === '/hr/my/leave-requests') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'lr-1',
              employeeId: 'emp-1',
              typeId: 'lt-1',
              type: { name: 'Casual Leave', code: 'CL' },
              startDate: '2026-09-15T00:00:00.000Z',
              endDate: '2026-09-16T00:00:00.000Z',
              days: 2,
              reason: 'Personal family matter',
              status: 'pending',
              createdAt: '2026-09-10T00:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        },
      })
    }
    if (url === '/hr/my/attendance/today') {
      return Promise.resolve({
        data: {
          state: 'working',
          checkInAt: '2026-10-02T09:00:00.000Z',
          workedMinutes: 240,
          breakMinutes: 30,
          appAllowed: true,
        },
      })
    }
    if (url === '/hr/my/attendance') {
      return Promise.resolve({
        data: [
          {
            id: 'att-1',
            date: '2026-10-01',
            status: 'PRESENT',
            workedMinutes: 480,
            breakMinutes: 45,
            note: 'On time',
          },
        ],
      })
    }
    if (url === '/hr/my/salary') {
      return Promise.resolve({ data: MOCK_PROFILE.salaryStructures[0] })
    }
    if (url === '/hr/my/payslips') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'ps-1',
              periodKey: '2026-08',
              periodStart: '2026-08-01T00:00:00.000Z',
              periodEnd: '2026-08-31T00:00:00.000Z',
              totalEarnings: 47000,
              totalDeductions: 2000,
              netPay: 45000,
              status: 'paid',
              paidAt: '2026-09-01T00:00:00.000Z',
              generatedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        },
      })
    }
    if (url === '/hr/my/commissions') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'comm-1',
              amount: 2500,
              status: 'approved',
              createdAt: '2026-09-20T00:00:00.000Z',
              order: { id: 'ord-1', displayId: 'ORD-260901-001', total: 25000 },
            },
          ],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        },
      })
    }
    if (url === '/hr/my/earnings') {
      return Promise.resolve({
        data: {
          data: [
            {
              id: 'earn-1',
              type: 'bonus',
              amount: 3000,
              reason: 'Festival Bonus',
              status: 'approved',
              createdAt: '2026-09-01T00:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        },
      })
    }
    if (url === '/hr/my/deductions') {
      return Promise.resolve({ data: { data: [], meta: { total: 0 } } })
    }
    if (url === '/hr/my/schedule') {
      return Promise.resolve({ data: { days: [] } })
    }
    return Promise.resolve({ data: null })
  })
}

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('MyProfilePage — Full Employee Profile & Self-Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiRoutes()
  })

  it('renders employee identity hero banner with name, employeeId, and department', async () => {
    const { getByText } = await wrap(<MyProfilePage />)
    await expect.element(getByText('Rahim Ahmed')).toBeInTheDocument()
    await expect.element(getByText('EMP-260823-0001')).toBeInTheDocument()
    await expect.element(getByText('Operations Executive')).toBeInTheDocument()
    await expect.element(getByText('Operations', { exact: true })).toBeInTheDocument()
  })

  it('renders 4 top KPI glance cards with live data', async () => {
    const { getByText } = await wrap(<MyProfilePage />)
    await expect.element(getByText('Order Delivery Rate').first()).toBeInTheDocument()
    await expect.element(getByText('Monthly Attendance')).toBeInTheDocument()
    await expect.element(getByText('Leaves Remaining')).toBeInTheDocument()
    await expect.element(getByText('Net Monthly Salary')).toBeInTheDocument()
    await expect.element(getByText('14 days')).toBeInTheDocument()
    await expect.element(getByText('45,000 ৳')).toBeInTheDocument()
  })

  it('renders 5 section tabs for employee navigation', async () => {
    const { getByText } = await wrap(<MyProfilePage />)
    await expect.element(getByText('Performance Overview')).toBeInTheDocument()
    await expect.element(getByText('Leaves & Applications')).toBeInTheDocument()
    await expect.element(getByText('Attendance & Log')).toBeInTheDocument()
    await expect.element(getByText('Salary & Income')).toBeInTheDocument()
    await expect.element(getByText('Profile & Details')).toBeInTheDocument()
  })

  it('renders assigned orders and leads metrics under performance tab', async () => {
    const { getByText } = await wrap(<MyProfilePage />)
    await expect.element(getByText('Assigned Orders Performance')).toBeInTheDocument()
    await expect.element(getByText('ORD-260901-001')).toBeInTheDocument()
    await expect.element(getByText('Sultana Begum')).toBeInTheDocument()
    await expect.element(getByText('Review supplier manifest')).toBeInTheDocument()
  })

  it('shows not found error card when account is not linked to an employee', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/hr/my/profile') {
        return Promise.reject({ response: { status: 404 } })
      }
      return Promise.resolve({ data: null })
    })

    const { getByText } = await wrap(<MyProfilePage />)
    await expect.element(getByText('No Employee Profile Found')).toBeInTheDocument()
  })
})

describe('NavUser — Bottom Left Profile Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiRoutes()
  })

  it('renders employee with View Employee Profile title when linked', async () => {
    const { useAuthStore } = await import('@/stores/auth-store')
    useAuthStore.getState().auth.setUser({
      id: 'u-1',
      email: 'rahim@ecomate.com',
      role: 'employee',
      firstName: 'Rahim',
      lastName: 'Ahmed',
    })

    const { NavUser } = await import('@/components/layout/nav-user')
    const { SidebarProvider } = await import('@/components/ui/sidebar')

    const { getByTitle } = await wrap(
      <SidebarProvider>
        <NavUser />
      </SidebarProvider>
    )

    await expect.element(getByTitle('View Employee Profile')).toBeInTheDocument()
  })
})

