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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
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

const notFoundOutcome = {
  status: 'not_found',
  identifier: 'NOPE-1',
  message: 'No dispatch found for "NOPE-1".',
  dispatches: [],
  order: null,
}

describe('Scanner page', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockGet.mockResolvedValue({ data: purposes })
  })

  it('renders the four scan purposes', async () => {
    const { getByText } = await renderPage()
    for (const label of ['Dispatch → Handed Over', 'Dispatch → Return', 'Order → Status Update', 'Sticker Print']) {
      expect(getByText(label, { exact: false })).not.toBeNull()
    }
  })

  it('switches the selected scan mode and keeps the input ready', async () => {
    const { getByText, getByPlaceholder } = await renderPage()
    await getByText('Dispatch → Return', { exact: false }).click()
    expect(getByPlaceholder(/Scan barcode/i)).not.toBeNull()
  })

  it('renders an error result for an unknown identifier', async () => {
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({ data: notFoundOutcome })
        : Promise.resolve({ data: {} }),
    )
    const { getByText, getByPlaceholder } = await renderPage()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'NOPE-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('No dispatch found for "NOPE-1".')).not.toBeNull()
    expect(getByText('Failed', { exact: false })).not.toBeNull()
  })

  it('accumulates every scan into the batch queue instead of replacing', async () => {
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({
            data: {
              status: 'resolved',
              identifier: 'CONS-1',
              dispatches: [
                { id: 'd1', courier: 'pathao', consignmentId: 'CONS-1', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
              ],
              order: null,
            },
          })
        : Promise.resolve({ data: {} }),
    )
    const { getByText, getByPlaceholder } = await renderPage()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'CONS-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 1 item', { exact: false })).not.toBeNull()
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({
            data: {
              status: 'resolved',
              identifier: 'CONS-2',
              dispatches: [
                { id: 'd2', courier: 'pathao', consignmentId: 'CONS-2', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
              ],
              order: null,
            },
          })
        : Promise.resolve({ data: {} }),
    )
    await userEvent.fill(input, 'CONS-2')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 2 items', { exact: false })).not.toBeNull()
    expect(getByText('Pending', { exact: false })).not.toBeNull()
  })

  it('marks a repeated scan as duplicate without re-adding it', async () => {
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({
            data: {
              status: 'resolved',
              identifier: 'CONS-1',
              dispatches: [
                { id: 'd1', courier: 'pathao', consignmentId: 'CONS-1', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
              ],
              order: null,
            },
          })
        : Promise.resolve({ data: {} }),
    )
    const { getByText, getByPlaceholder } = await renderPage()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'CONS-1')
    await userEvent.keyboard('{Enter}')
    await userEvent.fill(input, 'CONS-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 1 item', { exact: false })).not.toBeNull()
    expect(getByText('already queued', { exact: false })).not.toBeNull()
    expect(getByText('Duplicate', { exact: false })).not.toBeNull()
  })

  it('applies the handover to the whole queue in one batch', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved',
            identifier: 'CONS-1',
            dispatches: [
              { id: 'd1', courier: 'pathao', consignmentId: 'CONS-1', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
            ],
            order: null,
          },
        })
      }
      if (url === '/scanner/scan') {
        return Promise.resolve({
          data: {
            status: 'success',
            identifier: 'CONS-1',
            title: 'Batch — 1 handed over, 0 failed',
            message: 'All 1 dispatches handed over (stock deduction idempotent).',
            details: { succeeded: 1, failed: 0 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const { getByText, getByPlaceholder, getByRole } = await renderPage()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'CONS-1')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(getByRole('button', { name: /Apply to 1 dispatch/ }))
    expect(getByText('Batch — 1 handed over, 0 failed', { exact: false })).not.toBeNull()
    await expect.element(getByText('Batch queue', { exact: false })).not.toBeInTheDocument()
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.dispatchIds).toEqual(['d1'])
  })

  it('enqueues ambiguous multi-dispatch selections into the batch', async () => {
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({
            data: {
              status: 'selection_required',
              identifier: 'DUP-1',
              message: 'Multiple dispatches found. Select the dispatch to continue.',
              dispatches: [
                { id: 'd1', courier: 'pathao', consignmentId: 'DUP-1', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
                { id: 'd2', courier: 'redx', consignmentId: 'DUP-1', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
              ],
              order: null,
            },
          })
        : Promise.resolve({ data: {} }),
    )
    const { getByText, getByPlaceholder } = await renderPage()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'DUP-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 2 items', { exact: false })).not.toBeNull()
    expect(getByText('pathao — DISPATCHED — Order ORD-1 (Shipping)', { exact: false })).not.toBeNull()
    expect(getByText('redx — DISPATCHED — Order ORD-1 (Shipping)', { exact: false })).not.toBeNull()
  })

  it('applies the handover to a selected dispatch as a one-item batch', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'selection_required',
            identifier: 'DUP-1',
            message: 'Multiple dispatches found. Select the dispatch to continue.',
            dispatches: [
              { id: 'd1', courier: 'pathao', consignmentId: 'DUP-1', trackingCode: null, status: 'DISPATCHED', orderId: 'o1', orderDisplayId: 'ORD-1', orderStatus: 'Shipping', orderKind: 'SALE' },
            ],
            order: null,
          },
        })
      }
      if (url === '/scanner/scan') {
        return Promise.resolve({
          data: {
            status: 'success',
            identifier: 'DUP-1',
            title: 'Batch — 1 handed over, 0 failed',
            message: 'All 1 dispatches handed over (stock deduction idempotent).',
            details: { succeeded: 1, failed: 0 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const { getByText, getByPlaceholder, getByRole } = await renderPage()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'DUP-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 1 item', { exact: false })).not.toBeNull()
    await userEvent.click(getByRole('button', { name: /Apply to 1 dispatch/ }))
    expect(getByText('Batch — 1 handed over, 0 failed', { exact: false })).not.toBeNull()
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.dispatchIds).toEqual(['d1'])
  })

  it('ORDER_STATUS mode queues orders and applies one status to the whole batch', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved',
            identifier: 'ORD-1',
            dispatches: [],
            order: { id: 'o1', displayId: 'ORD-1', status: 'Shipping', kind: 'SALE', allowedStatuses: [{ id: 'st-delivered', name: 'Delivered' }] },
          },
        })
      }
      if (url === '/scanner/scan') {
        return Promise.resolve({
          data: {
            status: 'success',
            identifier: 'ORD-1',
            title: 'Batch — 1 updated, 0 failed',
            message: 'All 1 orders transitioned to the target status.',
            details: { succeeded: 1, failed: 0, results: [{ orderId: 'o1', displayId: 'ORD-1', ok: true, oldStatus: 'Shipping', newStatus: 'Delivered' }] },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const { getByText, getByPlaceholder, getByRole } = await renderPage()
    await getByText('Order → Status Update', { exact: false }).click()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'ORD-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 1 item', { exact: false })).not.toBeNull()
    let scanCalls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')
    expect(scanCalls).toHaveLength(0)
    await userEvent.click(getByRole('button', { name: '→ Delivered' }))
    await userEvent.click(getByRole('button', { name: /Apply to 1 order/ }))
    expect(getByText('Batch — 1 updated, 0 failed', { exact: false })).not.toBeNull()
    scanCalls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')
    expect(scanCalls).toHaveLength(1)
    expect(scanCalls[0]?.[1]?.orderIds).toEqual(['o1'])
    expect(scanCalls[0]?.[1]?.targetStatusId).toBe('st-delivered')
  })

  it('ORDER_STATUS batch only offers statuses valid for EVERY queued order', async () => {
    let call = 0
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        call++
        return Promise.resolve({
          data: {
            status: 'resolved',
            identifier: `ORD-${call}`,
            dispatches: [],
            order: {
              id: `o${call}`,
              displayId: `ORD-${call}`,
              status: call === 1 ? 'Shipping' : 'Pending',
              kind: 'SALE',
              allowedStatuses: call === 1
                ? [{ id: 'st-delivered', name: 'Delivered' }, { id: 'st-rp', name: 'Return Pending' }]
                : [{ id: 'st-rp', name: 'Return Pending' }, { id: 'st-hold', name: 'Hold' }],
            },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const { getByText, getByPlaceholder } = await renderPage()
    await getByText('Order → Status Update', { exact: false }).click()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'ORD-1')
    await userEvent.keyboard('{Enter}')
    await userEvent.fill(input, 'ORD-2')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 2 items', { exact: false })).not.toBeNull()
    expect(getByText('→ Return Pending', { exact: false })).not.toBeNull()
    await expect.element(getByText('→ Delivered', { exact: false })).not.toBeInTheDocument()
    await expect.element(getByText('→ Hold', { exact: false })).not.toBeInTheDocument()
  })

  it('STICKER_PRINT mode queues orders and batch-opens the bulk print page', async () => {
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({
            data: {
              status: 'resolved',
              identifier: 'ORD-1',
              dispatches: [],
              order: { id: 'o1', displayId: 'ORD-1', status: 'Shipping', kind: 'SALE', allowedStatuses: [] },
            },
          })
        : Promise.resolve({ data: {} }),
    )
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { getByText, getByPlaceholder, getByRole } = await renderPage()
    await getByText('Sticker Print', { exact: false }).click()
    const input = getByPlaceholder(/Scan barcode/i)
    await userEvent.fill(input, 'ORD-1')
    await userEvent.keyboard('{Enter}')
    expect(getByText('Batch queue — 1 item', { exact: false })).not.toBeNull()
    await userEvent.click(getByRole('button', { name: /Print 1 sticker/ }))
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/admin/op/print/bulk?type=sticker&ids=o1'), '_blank')
    openSpy.mockRestore()
  })
})
