import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecordRefundModal, REFUND_CANCEL_QUESTION } from './record-refund-modal'

const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: mockPost, put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecordRefundModal orderId="order-1" open onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('RecordRefundModal (D5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: { id: 'refund-1' } })
  })

  it('asks the cancel-too question verbatim with হ্যাঁ/পরে options', async () => {
    const ui = await renderModal()
    await expect.element(ui.getByText(REFUND_CANCEL_QUESTION)).toBeInTheDocument()
    await expect.element(ui.getByText(/হ্যাঁ, এখনই ক্যান্সেল করো/)).toBeInTheDocument()
    await expect.element(ui.getByText(/পরে করব/)).toBeInTheDocument()
  })

  it('requires amount, refund account/method and reason', async () => {
    const ui = await renderModal()
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).not.toHaveBeenCalled()
    await expect.element(ui.getByRole('button', { name: /^Record refund$/ })).toBeInTheDocument()
  })

  it('posts cancelToo=true when হ্যাঁ is chosen (atomic cancel)', async () => {
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Amount/), '1200')
    await userEvent.fill(ui.getByLabelText(/Refund to/), 'bkash 017XX')
    await userEvent.fill(ui.getByLabelText(/Reason/), 'customer cancelled')
    await userEvent.click(ui.getByText(/হ্যাঁ, এখনই ক্যান্সেল করো/))
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).toHaveBeenCalledWith('/refunds', expect.objectContaining({
      orderId: 'order-1',
      amount: 1200,
      method: 'bkash 017XX',
      reason: 'customer cancelled',
      cancelToo: true,
    }))
  })

  it('posts cancelToo=false when পরে is chosen (refund only)', async () => {
    const ui = await renderModal()
    await userEvent.fill(ui.getByLabelText(/Amount/), '400')
    await userEvent.fill(ui.getByLabelText(/Refund to/), 'cash')
    await userEvent.fill(ui.getByLabelText(/Reason/), 'partial adjustment')
    await userEvent.click(ui.getByText(/পরে করব/))
    await userEvent.click(ui.getByRole('button', { name: /^Record refund$/ }))
    expect(mockPost).toHaveBeenCalledWith('/refunds', expect.objectContaining({ cancelToo: false }))
  })
})
