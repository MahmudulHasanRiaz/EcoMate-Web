import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConvertLead } from './convert-lead'
// Source text for the "no hardcoded gateway" guard. The whole suite runs in a
// real browser (vitest browser mode), so node:fs is unavailable — Vite's
// `?raw` import is the browser-compatible equivalent of readFileSync here.
import convertLeadSource from './convert-lead.tsx?raw'

const listPaymentFormGateways = vi.hoisted(() => vi.fn())
const getAccountTree = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/features/gateways/api', () => ({
  gatewayApi: { listPaymentFormGateways },
}))
vi.mock('@/features/accounting/api', () => ({
  accountingApi: { getAccountTree },
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

// ConvertLead is a route page: it renders its own Header/Link chrome. Router
// primitives are mocked exactly like the sibling orders-page tests.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
// Header pulls in the sidebar + header chrome; without a SidebarProvider the
// real SidebarTrigger throws, so these are stubbed to keep the page renderable.
vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: () => null,
  Separator: () => null,
}))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))

interface GatewayFixture {
  id: string
  code: string
  name: string
  type: string
  paymentOptionType: string
  paymentOptionName: string
  paymentOptionEnabled: boolean
  enabled: boolean
  mode: string
  phoneNumber: string | null
  accountId: string
  account: { id: string; code: string; name: string; type: string }
  credentials: Record<string, unknown>
  sortOrder: number
}

/** Every fixture gateway is enabled + option-enabled with a mapped account. */
function gateway(g: {
  code: string
  name: string
  paymentOptionType?: string
  type?: string
  accountId?: string
  phoneNumber?: string | null
  sortOrder?: number
}): GatewayFixture {
  const accountId = g.accountId ?? `acc-${g.code}`
  return {
    id: `gw-${g.code}`,
    code: g.code,
    name: g.name,
    type: g.type ?? 'manual',
    paymentOptionType: g.paymentOptionType ?? 'FULL_PAYMENT',
    paymentOptionName: g.paymentOptionType === 'CASH_ON_DELIVERY' ? 'Cash on Delivery' : 'Full Payment',
    paymentOptionEnabled: true,
    enabled: true,
    mode: 'personal',
    phoneNumber: g.phoneNumber ?? null,
    accountId,
    account: { id: accountId, code: '1000', name: g.name, type: 'asset' },
    credentials: {},
    sortOrder: g.sortOrder ?? 1,
  }
}

function account(id: string, code: string, name: string) {
  return { id, code, name, type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] }
}

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    displayId: 'LEAD-001',
    status: 'PENDING',
    paymentMethod: 'cod',
    items: [],
    address: null,
    name: 'Test Customer',
    phone: '01700000000',
    ...overrides,
  }
}

function renderConvertLead(options: {
  lead: ReturnType<typeof lead>
  gateways: GatewayFixture[]
  accounts: ReturnType<typeof account>[]
}) {
  listPaymentFormGateways.mockResolvedValue({ data: options.gateways })
  getAccountTree.mockResolvedValue({ data: options.accounts })
  mockGet.mockImplementation((url: string) => {
    if (url.startsWith('/checkout-leads/')) return Promise.resolve({ data: options.lead })
    if (url === '/products') return Promise.resolve({ data: [] })
    if (url === '/delivery-areas/districts') return Promise.resolve({ data: [] })
    return Promise.reject(new Error('Unexpected URL: ' + url))
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ConvertLead id={options.lead.id} />
    </QueryClientProvider>,
  )
}

const cashGw = gateway({
  code: 'cash',
  name: 'Cash',
  type: 'cash',
  paymentOptionType: 'CASH_ON_DELIVERY',
  accountId: 'acc-cash',
  sortOrder: 1,
})

describe('ConvertLead — configured payment gateway selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: { id: 'order-1' } })
  })

  it('sources the Method options from configuration, never from the form file', async () => {
    // bKash is RENAMED: the configured name must be what the admin sees.
    const renamedBkash = gateway({
      code: 'bkash',
      name: 'bKash Business API',
      accountId: 'acc-bkash',
      phoneNumber: '01711111111',
      sortOrder: 2,
    })
    const ui = await renderConvertLead({
      lead: lead({ paymentMethod: 'bkash' }),
      gateways: [cashGw, renamedBkash],
      accounts: [account('acc-cash', '1001', 'Cash'), account('acc-bkash', '1002', 'bKash Business API')],
    })

    const trigger = ui.getByLabelText('Method')
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)
    await expect.element(ui.getByRole('option', { name: 'bKash Business API' })).toBeInTheDocument()

    // Source-level guard: the payment "Method" list must not hardcode gateways.
    // NOTE: a bare /bkash|nagad|rocket|\bbank\b|\bcard\b/i regex would also match
    // the `@/components/ui/card` import path and the <Card> JSX, so the word
    // `card` is asserted via the option-value form instead of a loose word match.
    expect(convertLeadSource).not.toMatch(/value=['"](bkash|nagad|rocket|bkash_pgw|bank|card)['"]/i)
    expect(convertLeadSource).not.toMatch(/\b(bkash|nagad|rocket|bkash_pgw|bank)\b/i)
  })

  it('auto-selects and disables a single enabled gateway', async () => {
    const ui = await renderConvertLead({
      lead: lead({ paymentMethod: '' }),
      gateways: [cashGw],
      accounts: [account('acc-cash', '1001', 'Cash')],
    })

    await expect.element(ui.getByLabelText('Method')).toBeDisabled()
    await expect.element(ui.getByText(/Only configured gateway/)).toBeInTheDocument()
  })

  it('initializes a legacy stored value to the configured COD gateway', async () => {
    // Legacy checkout enum on the stored lead; the configured COD gateway is
    // code `cash` / name `Cash`. A second enabled gateway keeps nothing locked.
    const another = gateway({
      code: 'bkash',
      name: 'bKash',
      accountId: 'acc-bkash',
      sortOrder: 2,
    })
    const ui = await renderConvertLead({
      lead: lead({ paymentMethod: 'CASH_ON_DELIVERY' }),
      gateways: [cashGw, another],
      accounts: [account('acc-cash', '1001', 'Cash'), account('acc-bkash', '1002', 'bKash')],
    })

    const trigger = ui.getByLabelText('Method')
    await expect.element(trigger).toBeEnabled()
    await expect.element(trigger).toHaveTextContent(/^Cash$/)
    await expect.element(trigger).not.toHaveTextContent('CASH_ON_DELIVERY')
  })
})
