import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GatewaySettings } from '../index'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
const mockPut = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: mockPut, delete: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children?: ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/payment-logo', () => ({
  PaymentLogo: ({ method }: any) => <span data-testid="pay-logo">{method}</span>,
}))

const manualGateway = {
  id: 'gw-bkash',
  code: 'bkash',
  name: 'bKash (Manual)',
  type: 'manual',
  paymentOptionType: 'FULL_PAYMENT',
  paymentOptionName: 'Full Payment',
  enabled: true,
  mode: 'personal',
  phoneNumber: '01700000000',
  credentials: {},
  sortOrder: 2,
}

const apiGateway = {
  id: 'gw-pgw',
  code: 'bkash_pgw',
  name: 'bKash PGW (API)',
  type: 'api',
  paymentOptionType: 'FULL_PAYMENT',
  paymentOptionName: 'Full Payment',
  enabled: false,
  mode: 'sandbox',
  phoneNumber: null,
  credentials: {},
  sortOrder: 7,
}

const optionsData = [
  {
    id: 'opt-full',
    type: 'FULL_PAYMENT',
    name: 'Full Payment',
    description: null,
    enabled: true,
    sortOrder: 1,
    gateways: [manualGateway, apiGateway],
  },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GatewaySettings />
    </QueryClientProvider>,
  )
}

describe('Manual gateway payment settings (S1/S2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/gateways/options') return { data: optionsData }
      if (url === '/system-settings') return { data: {} }
      return { data: [] }
    })
    mockPost.mockResolvedValue({ data: { ok: true } })
  })

  it('renders S1/S2 toggles with exact labels inside the expanded manual card', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash (Manual)'))
    await expect.element(ui.getByText('Staff manual payments auto-verified')).toBeInTheDocument()
    await expect.element(ui.getByText('Staff may edit recorded payments')).toBeInTheDocument()
  })

  it('does NOT render S1/S2 toggles inside the api (bkash_pgw) card', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash PGW (API)'))
    await expect.element(ui.getByText('Sandbox (Testing Mode)')).toBeInTheDocument()
    await expect.element(page.getByText('Staff manual payments auto-verified')).not.toBeInTheDocument()
    await expect.element(page.getByText('Staff may edit recorded payments')).not.toBeInTheDocument()
  })

  it('toggle flips the stored value via system-settings POST and refetches', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash (Manual)'))
    const s1 = ui.getByRole('switch', { name: 'Staff manual payments auto-verified' })
    // Default ON (no stored key) → flipping writes 'false'.
    await userEvent.click(s1)
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/system-settings/payments.staffAutoVerified', { value: 'false' })
    })
    await vi.waitFor(() => {
      const settingsCalls = mockGet.mock.calls.filter((c) => c[0] === '/system-settings')
      expect(settingsCalls.length).toBeGreaterThan(1)
    })
  })
})
