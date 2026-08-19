import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CourierCustomerHistoryCard } from './courier-customer-history-card'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '@/lib/api-client'

const mockGet = vi.mocked(apiClient.get)

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

async function renderCard(payload: Record<string, any>) {
  mockGet.mockResolvedValue({ data: payload } as any)
  const utils = await render(<CourierCustomerHistoryCard phone='01712345678' />, {
    wrapper: createWrapper(),
  })
  await vi.waitFor(() => expect(mockGet).toHaveBeenCalled())
  return utils
}

const ACTUAL = {
  success: 3,
  cancel: 1,
  total: 4,
  successRatio: 75,
  source: 'actual',
}
const NORMALIZED = {
  success: 18,
  cancel: 2,
  total: 20,
  successRatio: 90,
  source: 'normalized',
  rating: 'Excellent',
}
const NEW_CUSTOMER = {
  success: 0,
  cancel: 0,
  total: 25,
  successRatio: null,
  source: 'new',
  rating: 'New Customer',
}
const NO_DATA = null

describe('CourierCustomerHistoryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an actual report with risk level and no Normalized badge', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('Medium Risk', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/75% success/)).toBeInTheDocument()
    await expect.element(getByText('Normalized', { exact: true })).not.toBeInTheDocument()
  })

  it('shows a subtle Normalized badge for Pathao normalized reports', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('Normalized', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/90% expected/)).toBeInTheDocument()
    await expect.element(getByText('Low Risk', { exact: true })).toBeInTheDocument()
  })

  it('renders New Customer as neutral — never High Risk, success N/A', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NEW_CUSTOMER, cached: true, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('New Customer', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/Total 25/)).toBeInTheDocument()
    await expect.element(getByText('High Risk', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('0% success', { exact: true })).not.toBeInTheDocument()
  })

  it('shows No History for couriers without data', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('No History', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('No history across couriers', { exact: true })).toBeInTheDocument()
  })

  it('overall row keeps actual counts and normalized units separate', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NEW_CUSTOMER, cached: true, fresh: false },
    })
    await expect.element(getByText(/Actual 75% \(3\/4\)/)).toBeInTheDocument()
    await expect.element(getByText(/Normalized 90% \(18\/20\)/)).toBeInTheDocument()
  })

  it('new customer rows do not pollute the overall aggregates', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NEW_CUSTOMER, cached: true, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('No history across couriers', { exact: true })).toBeInTheDocument()
  })
})