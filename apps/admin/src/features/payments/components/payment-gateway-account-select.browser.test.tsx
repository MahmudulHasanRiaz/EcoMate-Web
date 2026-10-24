import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PaymentGatewayAccountSelect } from './payment-gateway-account-select'

const listPaymentFormGateways = vi.hoisted(() => vi.fn())

vi.mock('@/features/gateways/api', () => ({
  gatewayApi: { listPaymentFormGateways },
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
  paymentOptionType: 'FULL_PAYMENT',
  paymentOptionName: 'Full Payment',
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
    <>
      <PaymentGatewayAccountSelect
        gatewayCode={gatewayCode}
        accountId={accountId}
        onChange={(next) => {
          setGatewayCode(next.gatewayCode)
          setAccountId(next.accountId)
        }}
      />
      <output data-testid='selection'>{`${gatewayCode}|${accountId}`}</output>
    </>
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

describe('PaymentGatewayAccountSelect (D7: gateway implies the account)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPaymentFormGateways.mockResolvedValue({ data: [cash] })
  })

  it('auto-selects and disables a single gateway; no account picker exists', async () => {
    const ui = await renderPair()
    const gateway = ui.getByLabelText('Gateway')
    await expect.element(gateway).toBeDisabled()
    await expect.element(ui.getByText(/Only configured gateway/)).toBeInTheDocument()
    // D7: the account is derived from the gateway mapping, never picked.
    expect(ui.getByLabelText('Account').elements()).toHaveLength(0)
    await expect.element(ui.getByText(/Settles to Cash \(1001\)/)).toBeInTheDocument()
    await expect.element(ui.getByTestId('selection')).toHaveTextContent('cash|acc-cash')
  })

  it('warns (without blocking) when the picked gateway has no mapped account', async () => {
    listPaymentFormGateways.mockResolvedValue({ data: [cash, bkash] })
    const ui = await renderPair()
    const gateway = ui.getByLabelText('Gateway')
    await expect.element(gateway).toBeEnabled()
    await userEvent.click(gateway)
    await userEvent.click(ui.getByRole('option', { name: 'bKash' }))
    expect(ui.getByLabelText('Account').elements()).toHaveLength(0)
    await expect.element(
      ui.getByText(/No settlement account is mapped to this gateway.*Settings → Payment Gateways/i),
    ).toBeInTheDocument()
    await expect.element(ui.getByTestId('selection')).toHaveTextContent('bkash|')
  })

  it('warns when the mapped account is inactive (stale mapping)', async () => {
    // D17: the stale case now arrives as accountId set + account null from
    // the payment-form endpoint (no account-tree lookup anymore).
    listPaymentFormGateways.mockResolvedValue({
      data: [{ ...cash, account: null }],
    })
    const ui = await renderPair()
    await expect.element(
      ui.getByText(/settlement account mapped to this gateway is inactive or missing/i),
    ).toBeInTheDocument()
    await expect.element(ui.getByTestId('selection')).toHaveTextContent('cash|')
  })

  it('still offers gateways whose payment option is off for the website (D7)', async () => {
    listPaymentFormGateways.mockResolvedValue({
      data: [{ ...bkash, paymentOptionEnabled: false, accountId: 'acc-bank', account: accounts[1] }],
    })
    const ui = await renderPair()
    const gateway = ui.getByLabelText('Gateway')
    await expect.element(gateway).toBeDisabled()
    await expect.element(ui.getByTestId('selection')).toHaveTextContent('bkash|acc-bank')
  })

  it('shows the not-configured state when no gateway is enabled', async () => {
    listPaymentFormGateways.mockResolvedValue({ data: [] })
    const ui = await renderPair()
    await expect.element(
      ui.getByText(/No payment gateway is enabled.*Settings → Payment Gateways/i),
    ).toBeInTheDocument()
  })
})
