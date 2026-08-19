import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CourierCustomerHistoryCard } from './courier-customer-history-card'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '@/lib/api-client'

const mockGet = vi.mocked(apiClient.get)
const mockPost = vi.mocked(apiClient.post)

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

function clickByLabel(label: string) {
  const el = Array.from(document.querySelectorAll('button')).find(
    b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  )
  if (!el) throw new Error(`button ${label} not found`)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return el
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

function openPopover() {
  clickByLabel('Live')
}

describe('CourierCustomerHistoryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a single overall risk badge and count + percentage cells', async () => {
    const { getByText, container } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false, fetchedAt: '2026-08-19T12:40:00' },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await expect.element(getByText('Customer History', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Medium Risk', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('High Risk', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('3', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('(75.0%)', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('(25.0%)', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('Normalized', { exact: true })).not.toBeInTheDocument()
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(4)
  })

  it('summary includes total parcel count with a single consistent percentage format', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NEW_CUSTOMER, cached: true, fresh: false },
    })
    await expect.element(getByText('24 parcels', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('87.5%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('12.5%', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('Delivered', { exact: true })).toBeInTheDocument()
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
    await expect.element(getByText('(90.0%)', { exact: true }).first()).toBeInTheDocument()
    await expect.element(getByText('(10.0%)', { exact: true }).first()).toBeInTheDocument()
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

  it('overall row aligns with the same columns and sums every ratio-bearing report', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false },
      pathao: { report: NORMALIZED, cached: true, fresh: true },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NEW_CUSTOMER, cached: true, fresh: false },
    })
    await expect.element(getByText('Overall', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('24', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('21', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('(87.5%)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('(12.5%)', { exact: true })).toBeInTheDocument()
  })

  it('footer shows latest updated timestamp from the most recently fetched courier, without repeating names', async () => {
    const { getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false, fetchedAt: '2026-08-19T12:40:00' },
      pathao: { report: NORMALIZED, cached: true, fresh: true, fetchedAt: '2026-08-19T12:48:00' },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NEW_CUSTOMER, cached: true, fresh: false, fetchedAt: '2026-08-19T12:43:00' },
    })
    await expect.element(getByText(/Last updated/)).toBeInTheDocument()
    await expect.element(getByText(/12:48/)).toBeInTheDocument()
    await expect.element(getByText(/12:40/)).not.toBeInTheDocument()
    await expect.element(getByText(/Cached: Steadfast/)).not.toBeInTheDocument()
    await expect.element(getByText(/Live: Pathao/)).not.toBeInTheDocument()
  })

  it('opens the revalidation popover and refetches a single courier on refresh', async () => {
    const { getByRole, getByText } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false, fetchedAt: '2026-08-19T12:40:00' },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await new Promise(r => setTimeout(r, 250))
    openPopover()
    await new Promise(r => setTimeout(r, 250))
    await expect.element(getByText('Refresh courier data', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('All Couriers', { exact: true })).toBeInTheDocument()
    mockPost.mockResolvedValue({ data: {} } as any)
    clickByLabel('Refresh Steadfast')
    expect(mockPost).toHaveBeenCalledWith('/couriers/customer-history/refresh', {
      phone: '01712345678',
      courier: 'steadfast',
    })
    await vi.waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(1))
  })

  it('revalidate all posts without a courier and refetches the whole set', async () => {
    const { getByRole } = await renderCard({
      steadfast: { report: ACTUAL, cached: true, fresh: false, fetchedAt: '2026-08-19T12:40:00' },
      pathao: { report: NO_DATA, cached: false, fresh: false },
      redx: { report: NO_DATA, cached: false, fresh: false },
      carrybee: { report: NO_DATA, cached: false, fresh: false },
    })
    await new Promise(r => setTimeout(r, 250))
    openPopover()
    await new Promise(r => setTimeout(r, 250))
    mockPost.mockResolvedValue({ data: {} } as any)
    clickByLabel('Refresh All Couriers')
    expect(mockPost).toHaveBeenCalledWith('/couriers/customer-history/refresh', {
      phone: '01712345678',
    })
  })
})