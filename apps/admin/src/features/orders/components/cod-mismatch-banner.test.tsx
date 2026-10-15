import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CodMismatchBanner, COD_MISMATCH_INSTRUCTION } from './cod-mismatch-banner'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const openAlert = {
  id: 'alert-1',
  orderId: 'order-1',
  courier: 'pathao',
  consignmentId: 'C1',
  courierAmount: 1370,
  systemDue: 120,
  status: 'open',
  createdAt: '2026-01-01T00:00:00Z',
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CodMismatchBanner
        orderId="order-1"
        due={120}
        dispatches={[{ courier: 'pathao', consignmentId: 'C1', trackingUrl: 'https://merchant.pathao.com/track/C1' }]}
      />
    </QueryClientProvider>,
  )
}

describe('CodMismatchBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ data: [openAlert] })
    mockPost.mockResolvedValue({ data: { ...openAlert, status: 'resolved' } })
  })

  it('renders courier, consignment link, amounts, difference and the Bengali instruction', async () => {
    const ui = await renderBanner()
    await expect.element(ui.getByText('pathao')).toBeInTheDocument()
    // Consignment links to the courier merchant panel when trackingUrl is present.
    const link = ui.getByRole('link', { name: 'C1' })
    await expect.element(link).toHaveAttribute('href', 'https://merchant.pathao.com/track/C1')
    await expect.element(ui.getByText(/Courier COD/)).toBeInTheDocument()
    await expect.element(ui.getByText(/1,370/)).toBeInTheDocument()
    await expect.element(ui.getByText(/120/)).toBeInTheDocument()
    await expect.element(ui.getByText(/1,250/)).toBeInTheDocument() // difference
    await expect.element(ui.getByText(COD_MISMATCH_INSTRUCTION)).toBeInTheDocument()
  })

  it('renders the consignment as plain text when no tracking URL exists', async () => {
    mockGet.mockResolvedValue({ data: [openAlert] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ui = await render(
      <QueryClientProvider client={client}>
        <CodMismatchBanner orderId="order-1" due={120} dispatches={[]} />
      </QueryClientProvider>,
    )
    await expect.element(ui.getByText('C1')).toBeInTheDocument()
  })

  it('marks an alert resolved via the resolve endpoint', async () => {
    const ui = await renderBanner()
    await userEvent.click(ui.getByRole('button', { name: /Mark resolved/ }))
    expect(mockPost).toHaveBeenCalledWith('/orders/order-1/cod-alerts/alert-1/resolve')
  })

  it('renders nothing when every alert is resolved', async () => {
    mockGet.mockResolvedValue({ data: [{ ...openAlert, status: 'resolved' }] })
    const ui = await renderBanner()
    // Banner is server-driven and persistent only while an open alert exists.
    await new Promise((r) => setTimeout(r, 300))
    expect(mockGet).toHaveBeenCalledWith('/orders/order-1/cod-alerts')
    await expect.element(ui.getByText(/Courier COD/)).not.toBeInTheDocument()
  })
})
