import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScannerPage from './index'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    isScanning = false
    static getCameras = vi.fn().mockResolvedValue([])
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn().mockResolvedValue(undefined)
  },
}))

vi.mock('@/components/layout/header', () => ({ Header: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/layout/main', () => ({ Main: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))

const purposes = [
  { purpose: 'DISPATCH_HANDED_OVER', label: 'Dispatch → Handed Over', description: 'd1' },
  { purpose: 'DISPATCH_RETURN', label: 'Dispatch → Return', description: 'd2' },
  { purpose: 'ORDER_STATUS', label: 'Order → Status Update', description: 'd3' },
  { purpose: 'STICKER_PRINT', label: 'Sticker Print', description: 'd4' },
]

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScannerPage />
    </QueryClientProvider>,
  )
}

/** A dispatch whose courier webhook hasn't filled the consignment id yet. */
const nullDispatch = (id: string, orderDisplay = 'ORD-260930-0009') => ({
  id, courier: 'pathao', consignmentId: null, trackingCode: null,
  status: 'DISPATCHED', orderId: 'o9', orderDisplayId: orderDisplay, orderStatus: 'Shipping', orderKind: 'SALE',
  customerName: 'Md. Rahim', customerPhone: '01700000001', itemCount: 2, orderTotal: 1250,
})

async function scanText(page: any, text: string) {
  const input = page.getByPlaceholder(/Scan or enter/i)
  await userEvent.fill(input, text)
  await userEvent.keyboard('{Enter}')
}

describe('Scanner null dispatch identifiers', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockGet.mockResolvedValue({ data: purposes })
  })

  it('stages a null-consignment dispatch with a Pending webhook fallback label', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'ORD-260930-0009', dispatches: [nullDispatch('d9')], order: null } })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.click(page.getByRole('switch'))
    await scanText(page, 'ORD-260930-0009')
    await expect.element(page.getByText('Staged dispatches')).toBeInTheDocument()
    // Display fallback (dispatch-table language), never a bare "null".
    await expect.element(page.getByText('Pending webhook', { exact: false })).toBeInTheDocument()
    // The order reference stays visible as the secondary identifier.
    await expect.element(page.getByText('ORD-260930-0009', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByText('null — Already staged', { exact: false })).not.toBeInTheDocument()
  })

  it('still dedupes a null-consignment dispatch by key on re-scan', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'ORD-260930-0009', dispatches: [nullDispatch('d9')], order: null } })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.click(page.getByRole('switch'))
    await scanText(page, 'ORD-260930-0009')
    await scanText(page, 'ORD-260930-0009')
    // Key-based match: no second staged row, nothing executed yet in batch.
    await expect.element(page.getByText('Pending webhook — Already staged', { exact: false })).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
  })

  it('executes a null-consignment dispatch with the order reference as identifier', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'ORD-260930-0009', dispatches: [nullDispatch('d9')], order: null } })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'ORD-260930-0009', title: 'ORD-260930-0009 — Handed Over',
          message: 'Dispatch handed over to the courier.', courier: 'pathao',
          oldState: 'DISPATCHED', newState: 'HANDED_OVER', details: { dispatchId: 'd9' },
        },
      })
    })
    const page = await renderPage()
    await scanText(page, 'ORD-260930-0009')
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    // dispatchId carries the target; identifier must stay a truthful non-null reference.
    expect(scanCall?.[1]?.dispatchId).toBe('d9')
    expect(scanCall?.[1]?.identifier).toBe('ORD-260930-0009')
    await expect.element(page.getByText('ORD-260930-0009 — Handed Over')).toBeInTheDocument()
  })
})
