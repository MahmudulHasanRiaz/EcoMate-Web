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
  staffAutoVerifiedOverride: null,
  editAllowedOverride: null,
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
  staffAutoVerifiedOverride: null,
  editAllowedOverride: null,
}

const cashGateway = {
  id: 'gw-cod',
  code: 'cod',
  name: 'Cash on Delivery',
  type: 'cash',
  paymentOptionType: 'CASH_ON_DELIVERY',
  paymentOptionName: 'Cash On Delivery',
  enabled: true,
  mode: 'personal',
  phoneNumber: null,
  credentials: {},
  sortOrder: 1,
  staffAutoVerifiedOverride: null,
  editAllowedOverride: null,
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
  {
    id: 'opt-cod',
    type: 'CASH_ON_DELIVERY',
    name: 'Cash On Delivery',
    description: null,
    enabled: true,
    sortOrder: 3,
    gateways: [cashGateway],
  },
]

/** D: canonical effective settings shape returned by GET /payments/settings. */
function effectiveSettings(over: {
  global?: { staffAutoVerified: boolean; editAllowed: boolean }
  bkash?: { staffAutoVerifiedOverride: boolean | null; editAllowedOverride: boolean | null }
} = {}) {
  const global = over.global ?? { staffAutoVerified: true, editAllowed: false }
  const bkashOver = over.bkash ?? { staffAutoVerifiedOverride: null, editAllowedOverride: null }
  return {
    global,
    gateways: [
      {
        code: 'bkash',
        name: 'bKash (Manual)',
        type: 'manual',
        ...bkashOver,
        effective: {
          staffAutoVerified: bkashOver.staffAutoVerifiedOverride ?? global.staffAutoVerified,
          editAllowed: bkashOver.editAllowedOverride ?? global.editAllowed,
        },
      },
      {
        code: 'bkash_pgw',
        name: 'bKash PGW (API)',
        type: 'api',
        staffAutoVerifiedOverride: null,
        editAllowedOverride: null,
        effective: global,
      },
    ],
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GatewaySettings />
    </QueryClientProvider>,
  )
}

describe('Payment settings: global defaults + per-gateway tri-state (D)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/gateways/options') return { data: optionsData }
      if (url === '/payments/settings') return { data: effectiveSettings() }
      if (url === '/system-settings') return { data: {} }
      return { data: [] }
    })
    mockPost.mockResolvedValue({ data: { ok: true } })
    mockPut.mockResolvedValue({ data: { ok: true } })
  })

  it('renders the Global Payment Defaults section with both store-wide toggles', async () => {
    const ui = await renderPage()
    await expect.element(ui.getByText('Global Payment Defaults')).toBeInTheDocument()
    await expect.element(ui.getByRole('switch', { name: 'Staff manual payments auto-verified' })).toBeInTheDocument()
    await expect.element(ui.getByRole('switch', { name: 'Staff may edit recorded payments' })).toBeInTheDocument()
  })

  it('global toggle flips the stored value via system-settings POST and refetches', async () => {
    const ui = await renderPage()
    const s1 = ui.getByRole('switch', { name: 'Staff manual payments auto-verified' })
    // Default ON (no stored key) → flipping writes 'false'.
    await userEvent.click(s1)
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/system-settings/payments.staffAutoVerified', { value: 'false' })
    })
    await vi.waitFor(() => {
      const settingsCalls = mockGet.mock.calls.filter((c) => c[0] === '/payments/settings')
      expect(settingsCalls.length).toBeGreaterThan(1)
    })
  })

  it('manual gateway card shows per-gateway tri-state rows defaulting to "Use global default"', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash (Manual)'))
    const s1 = ui.getByRole('combobox', { name: 'Staff manual payments auto-verified' })
    const s2 = ui.getByRole('combobox', { name: 'Staff may edit recorded payments' })
    await expect.element(s1).toHaveTextContent('Use global default')
    await expect.element(s2).toHaveTextContent('Use global default')
    // Effective hints resolve through the global defaults.
    await expect.element(page.getByText('Effective: On — from global default')).toBeInTheDocument()
    await expect.element(page.getByText('Effective: Off — from global default')).toBeInTheDocument()
  })

  it('tri-state override change updates the hint and saves the override on the gateway', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash (Manual)'))
    const s1 = ui.getByRole('combobox', { name: 'Staff manual payments auto-verified' })
    await userEvent.click(s1)
    await userEvent.click(page.getByRole('option', { name: 'Off' }))
    // Hint now says the value is gateway-scoped, not inherited.
    await expect.element(page.getByText('Effective: Off — set on this gateway')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('button', { name: 'Save Configuration' }))
    await vi.waitFor(() => {
      const putCall = mockPut.mock.calls.find((c) => c[0] === '/gateways/bkash')
      expect(putCall).toBeTruthy()
      expect(putCall![1]).toMatchObject({
        staffAutoVerifiedOverride: false,
        editAllowedOverride: null,
      })
    })
  })

  it('server-side override is reflected in the tri-state and the effective hint', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/gateways/options') {
        return {
          data: [
            {
              ...optionsData[0],
              gateways: [
                { ...manualGateway, staffAutoVerifiedOverride: false, editAllowedOverride: true },
                apiGateway,
              ],
            },
            optionsData[1],
          ],
        }
      }
      if (url === '/payments/settings') {
        return {
          data: effectiveSettings({
            bkash: { staffAutoVerifiedOverride: false, editAllowedOverride: true },
          }),
        }
      }
      return { data: [] }
    })
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash (Manual)'))
    await expect
      .element(ui.getByRole('combobox', { name: 'Staff manual payments auto-verified' }))
      .toHaveTextContent('Off')
    await expect
      .element(ui.getByRole('combobox', { name: 'Staff may edit recorded payments' }))
      .toHaveTextContent('On')
    await expect.element(page.getByText('Effective: Off — set on this gateway')).toBeInTheDocument()
    await expect.element(page.getByText('Effective: On — set on this gateway')).toBeInTheDocument()
  })

  it('api (bkash_pgw) card never shows the per-gateway tri-state rows', async () => {
    const ui = await renderPage()
    await userEvent.click(ui.getByText('bKash PGW (API)'))
    await expect.element(ui.getByText('Sandbox (Testing Mode)')).toBeInTheDocument()
    await expect.element(page.getByText('Use global default')).not.toBeInTheDocument()
  })

  it('cash gateway card never shows the per-gateway tri-state rows', async () => {
    const ui = await renderPage()
    // Cash gateway section renders (group heading), as its own static card (no expand step).
    await expect.element(ui.getByRole('heading', { name: 'Cash On Delivery Gateways' })).toBeInTheDocument()
    await expect.element(page.getByText('Use global default')).not.toBeInTheDocument()
    // Even with the manual card expanded, the tri-state appears exactly once
    // (inside the manual card — never duplicated into the cash card). A strict
    // single-match role query fails if the row were rendered twice.
    await userEvent.click(ui.getByText('bKash (Manual)'))
    await expect
      .element(ui.getByRole('combobox', { name: 'Staff manual payments auto-verified' }))
      .toHaveTextContent('Use global default')
  })
})
