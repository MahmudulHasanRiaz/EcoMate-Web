import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentGatewayAccountSelect } from './payment-gateway-account-select'

const listGateways = vi.hoisted(() => vi.fn())
const getAccountTree = vi.hoisted(() => vi.fn())

vi.mock('@/features/gateways/api', () => ({
  gatewayApi: { listGateways },
}))
vi.mock('@/features/accounting/api', () => ({
  accountingApi: { getAccountTree },
}))

const cash = {
  id: 'gw-cash',
  code: 'cash',
  name: 'Cash',
  type: 'cash',
  paymentOptionType: 'CASH_ON_DELIVERY',
  paymentOptionName: 'Cash on Delivery',
  paymentOptionEnabled: true,
  enabled: true,
  mode: 'personal',
  phoneNumber: null,
  accountId: 'acc-cash',
  account: { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset' },
  credentials: {},
  sortOrder: 1,
}
const bkash = {
  ...cash,
  id: 'gw-bkash',
  code: 'bkash',
  name: 'bKash',
  type: 'manual',
  phoneNumber: '01700000000',
  accountId: null,
  account: null,
  sortOrder: 2,
}

const accounts = [
  { id: 'acc-cash', code: '1001', name: 'Cash', type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] },
  { id: 'acc-bank', code: '1002', name: 'Bank', type: 'asset', parentId: null, isActive: true, isGroup: false, children: [] },
]

function PairHarness() {
  const [gatewayCode, setGatewayCode] = useState('')
  const [accountId, setAccountId] = useState('')
  return (
    <PaymentGatewayAccountSelect
      gatewayCode={gatewayCode}
      accountId={accountId}
      onChange={(next) => {
        setGatewayCode(next.gatewayCode)
        setAccountId(next.accountId)
      }}
    />
  )
}

function renderPair() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PairHarness />
    </QueryClientProvider>,
  )
}

describe('PaymentGatewayAccountSelect (owner-locked config rules)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listGateways.mockResolvedValue({ data: [cash] })
    getAccountTree.mockResolvedValue({ data: accounts })
  })

  it('auto-selects and disables a single gateway + its mapped account', async () => {
    const ui = await renderPair()
    const gateway = ui.getByLabelText('Gateway')
    const account = ui.getByLabelText('Account')
    await expect.element(gateway).toBeDisabled()
    await expect.element(account).toBeDisabled()
    await expect.element(ui.getByText(/Only configured gateway/)).toBeInTheDocument()
    await expect.element(ui.getByText(/Default settlement account/)).toBeInTheDocument()
  })

  it('shows normal selects at 2+ gateways and all eligible accounts when unmapped', async () => {
    listGateways.mockResolvedValue({ data: [cash, bkash] })
    const ui = await renderPair()
    const gateway = ui.getByLabelText('Gateway')
    await expect.element(gateway).toBeEnabled()
    await userEvent.click(gateway)
    await userEvent.click(ui.getByRole('option', { name: 'bKash' }))
    const account = ui.getByLabelText('Account')
    await expect.element(account).toBeEnabled()
    await expect.element(
      ui.getByText(/No default account set for this gateway.*Settings → Payment Gateways/i),
    ).toBeInTheDocument()
  })

  it('shows the not-configured state when no gateway is enabled', async () => {
    listGateways.mockResolvedValue({ data: [] })
    const ui = await renderPair()
    await expect.element(
      ui.getByText(/No payment gateway is enabled.*Settings → Payment Gateways/i),
    ).toBeInTheDocument()
  })

  it('shows the not-configured state when no eligible account exists', async () => {
    getAccountTree.mockResolvedValue({ data: [] })
    const ui = await renderPair()
    await expect.element(
      ui.getByText(/No eligible money account exists.*Accounting → Chart of Accounts/i),
    ).toBeInTheDocument()
  })
})
