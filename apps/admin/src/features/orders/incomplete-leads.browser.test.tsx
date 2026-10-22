import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LeadConvertPaymentFields } from './incomplete-leads'

/**
 * The edit-and-convert dialog's Payment Method field must come from CONFIGURED
 * gateways (the same shared pair + normalizer the convert form uses), never a
 * hardcoded 4-item legacy list. The in-page dialog has no trigger of its own
 * (the "Convert with Edit" flow is route-backed) and the full page needs router
 * context, so these tests render the extracted payment-field group that the
 * dialog actually uses — same file, same production code path.
 */

const listGateways = vi.hoisted(() => vi.fn())
const getAccountTree = vi.hoisted(() => vi.fn())

vi.mock('@/features/gateways/api', () => ({
  gatewayApi: { listGateways },
}))
vi.mock('@/features/accounting/api', () => ({
  accountingApi: { getAccountTree },
}))

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
  accountId: string | null
  account: { id: string; code: string; name: string; type: string } | null
  credentials: Record<string, unknown>
  sortOrder: number
}

/**
 * Every fixture gateway is enabled + payment-option-enabled with a matching
 * eligible asset account unless the test explicitly overrides it.
 */
function gateway(overrides: {
  code: string
  name: string
  type?: string
  paymentOptionType?: string
  accountId?: string | null
  enabled?: boolean
  paymentOptionEnabled?: boolean
  sortOrder?: number
}): GatewayFixture {
  const accountId = overrides.accountId === undefined ? `acc-${overrides.code}` : overrides.accountId
  return {
    id: `gw-${overrides.code}`,
    code: overrides.code,
    name: overrides.name,
    type: overrides.type ?? 'manual',
    paymentOptionType: overrides.paymentOptionType ?? 'FULL_PAYMENT',
    paymentOptionName: 'Payment',
    paymentOptionEnabled: overrides.paymentOptionEnabled ?? true,
    enabled: overrides.enabled ?? true,
    mode: 'personal',
    phoneNumber: null,
    accountId,
    account: accountId ? { id: accountId, code: '1001', name: overrides.name, type: 'asset' } : null,
    credentials: {},
    sortOrder: overrides.sortOrder ?? 1,
  }
}

/** Matching eligible asset leaf for every fixture gateway that maps an account. */
function accountsFor(gateways: GatewayFixture[]) {
  return gateways
    .filter((g) => !!g.accountId)
    .map((g, i) => ({
      id: g.accountId as string,
      code: String(1001 + i),
      name: g.name,
      type: 'asset' as const,
      parentId: null,
      isActive: true,
      isGroup: false,
      children: [],
    }))
}

function setup(gateways: GatewayFixture[]) {
  listGateways.mockResolvedValue({ data: gateways })
  getAccountTree.mockResolvedValue({ data: accountsFor(gateways) })
}

function Harness({ stored }: { stored?: string | null }) {
  const [selection, setSelection] = useState({ gatewayCode: '', accountId: '' })
  return (
    <LeadConvertPaymentFields
      gatewayCode={selection.gatewayCode}
      accountId={selection.accountId}
      storedPaymentMethod={stored}
      onChange={(next) => setSelection(next)}
    />
  )
}

function renderFields(stored?: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness stored={stored} />
    </QueryClientProvider>,
  )
}

describe('IncompleteLeads edit dialog payment fields (configured gateways)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers the configured gateway names and never the hardcoded legacy list', async () => {
    setup([
      gateway({ code: 'cash', name: 'Cash', type: 'cash', paymentOptionType: 'CASH_ON_DELIVERY', sortOrder: 1 }),
      gateway({ code: 'bkash', name: 'bKash Business API', sortOrder: 2 }),
      gateway({ code: 'nagad', name: 'Nagad', enabled: false, sortOrder: 3 }),
    ])
    const ui = await renderFields('cash')

    const trigger = ui.getByLabelText('Payment Method')
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)

    // The configured (renamed) gateway is offered…
    await expect.element(ui.getByRole('option', { name: 'bKash Business API' })).toBeInTheDocument()
    // …and the drifted, hardcoded 4-item legacy list is gone: a disabled
    // gateway and the never-configured legacy codes are not offered.
    await expect.element(ui.getByRole('option', { name: 'Nagad' })).not.toBeInTheDocument()
    await expect.element(ui.getByRole('option', { name: 'Rocket' })).not.toBeInTheDocument()
    await expect.element(ui.getByText('Cash On Delivery')).not.toBeInTheDocument()
  })

  it('auto-selects and disables a single enabled gateway', async () => {
    setup([
      gateway({ code: 'cash', name: 'Cash', type: 'cash', paymentOptionType: 'CASH_ON_DELIVERY' }),
    ])
    const ui = await renderFields('cash')

    const trigger = ui.getByLabelText('Payment Method')
    await expect.element(trigger).toBeDisabled()
    await expect.element(trigger).toHaveTextContent('Cash')
    await expect.element(ui.getByText(/Only configured gateway/)).toBeInTheDocument()
  })

  it('normalizes a legacy stored CASH_ON_DELIVERY onto the configured COD gateway', async () => {
    setup([
      gateway({ code: 'cash', name: 'Cash', type: 'cash', paymentOptionType: 'CASH_ON_DELIVERY', sortOrder: 1 }),
      gateway({ code: 'bkash', name: 'bKash Business API', sortOrder: 2 }),
    ])
    const ui = await renderFields('CASH_ON_DELIVERY')

    const trigger = ui.getByLabelText('Payment Method')
    // The configured gateway's name shows — not the raw legacy enum.
    await expect.element(trigger).toHaveTextContent('Cash')
    await expect.element(trigger).not.toHaveTextContent('CASH_ON_DELIVERY')
  })
})
