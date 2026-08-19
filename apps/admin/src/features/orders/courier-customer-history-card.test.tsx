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

  it('renders a single overall risk badge and aligned actual columns', async () => {
    const { getByText, container } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('Customer History', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Medium Risk', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('High Risk', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('75.0%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('25.0%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('Normalized', { exact: true })).not.toBeInTheDocument()
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(4)
  })

  it('shows the overall verdict line with one decimal consistency', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NEW_CUSTOMER, cached: true, fresh: false },
    })
    await expect.element(getByText('87.5%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('12.5%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('Delivery', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Cancelled', { exact: true })).toBeInTheDocument()
    await expect.element(getByText(/Actual/)).not.toBeInTheDocument()
    await expect.element(getByText(/Normalized/)).not.toBeInTheDocument()
  })

  it('hides normalization terminology from primary UI (tooltip only)', async () => {
    const { getByText, getByTitle } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('Low Risk', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('90.0%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('10.0%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('Normalized', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByTitle('Normalized (calibrated estimate)')).toBeInTheDocument()
  })

  it('renders New Customer as neutral — never High Risk, never 0% success', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NEW_CUSTOMER, cached: true, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('New Customer', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('25', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('High Risk', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('0.0%', { exact: true })).not.toBeInTheDocument()
  })

  it('shows No History for couriers without data and a single muted footer note', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('No History', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('No history across couriers', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Medium Risk', { exact: true })).not.toBeInTheDocument()
  })

  it('overall row sums every ratio-bearing report into one aligned row', async () => {
    const { getByText, container } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NEW_CUSTOMER, cached: true, fresh: false },
    })
    await expect.element(getByText('Overall', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('24', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('21', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('87.5%', { exact: true }).first()).toBeInTheDocument()
    const rows = container.querySelectorAll('.grid')
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps live/cached metadata subtle and secondary', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText(/Cached: Steadfast/)).toBeInTheDocument()
    await expect.element(getByText(/Live:/)).not.toBeInTheDocument()
  })

  it('new customer rows do not pollute the overall aggregate', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: NO_DATA, cached: false, fresh: false },
      pathao: { report: NEW_CUSTOMER, cached: true, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('No history across couriers', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Overall', { exact: true })).not.toBeInTheDocument()
  })
})
