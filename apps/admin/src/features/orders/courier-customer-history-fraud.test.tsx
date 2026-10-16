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

const NO_DATA = null

const FRAUD = {
  success: 58,
  cancel: 5,
  total: 63,
  successRatio: 92,
  source: 'actual',
  steadfastFraud: {
    deliveryRatio: 92,
    cancellationRatio: 7,
    volumeBand: 'high',
    volumeRange: '50+',
    deliveredCount: 58,
    cancelledCount: 5,
    totalReports: 2,
    fraudCategories: { no_response: 2, refused: 1 },
  },
}

const FRAUD_NULL = {
  success: 0,
  cancel: 0,
  total: 0,
  successRatio: null,
  source: 'none',
  steadfastFraud: {
    deliveryRatio: null,
    cancellationRatio: null,
    volumeBand: 'none',
    volumeRange: null,
    deliveredCount: null,
    cancelledCount: null,
    totalReports: 0,
    fraudCategories: {},
  },
}

function payloadWith(steadfastReport: any) {
  return {
    steadfast: { report: steadfastReport, cached: false, fresh: true, fetchedAt: '2026-08-19T12:40:00' },
    pathao: { report: NO_DATA, cached: false, fresh: false },
    redx: { report: NO_DATA, cached: false, fresh: false },
    carrybee: { report: NO_DATA, cached: false, fresh: false },
  }
}

describe('CourierCustomerHistoryCard — Steadfast fraud ratios UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows both Steadfast ratios independently (92% + 7% — never 100-derived 8%)', async () => {
    const { getByText, container } = await renderCard(payloadWith(FRAUD))
    await expect.element(getByText('(92%)', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('(7%)', { exact: true })).toBeInTheDocument()
    // 100 - 92 = 8 would overstate the cancellation record — forbidden.
    expect(container.textContent).not.toContain('(8%)')
  })

  it('shows band + range + counts + categories', async () => {
    const { container } = await renderCard(payloadWith(FRAUD))
    await vi.waitFor(() => expect(container.textContent).toContain('50+'))
    expect(container.textContent).toContain('high')
    expect(container.textContent).toContain('50+')
    expect(container.textContent).toContain('58')
    expect(container.textContent).toContain('no_response')
    expect(container.textContent).toContain('×2')
    expect(container.textContent).toContain('refused')
  })

  it('null fraud fields render No data — never 0-as-clean', async () => {
    const { getByText, container } = await renderCard(payloadWith(FRAUD_NULL))
    await expect.element(getByText(/No data/).first()).toBeInTheDocument()
    expect(container.textContent).toContain('No data')
    await expect.element(getByText('0.0%', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('Low Risk', { exact: true })).not.toBeInTheDocument()
    await expect.element(getByText('High Risk', { exact: true })).not.toBeInTheDocument()
  })

  it('never renders score UI (score/level/reasons stay out even if present)', async () => {
    const withScore = {
      ...FRAUD,
      score: 82,
      level: 'good',
      reasons: ['high cancel'],
    }
    const { container } = await renderCard(payloadWith(withScore))
    await vi.waitFor(() => expect(container.textContent).toContain('50+'))
    expect(container.textContent).not.toMatch(/score/i)
    expect(container.textContent).not.toContain('high cancel')
  })
})
