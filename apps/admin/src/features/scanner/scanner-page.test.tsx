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
  { purpose: 'RETURN_RECEIVE', label: 'Return / Exchange Receive', description: 'd5' },
]

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScannerPage />
    </QueryClientProvider>,
  )
}

const dispatchPreview = (id: string, consignment: string, courier = 'pathao', orderDisplay = 'ORD-260930-0001') => ({
  id, courier, consignmentId: consignment, trackingCode: null,
  status: 'DISPATCHED', orderId: 'o1', orderDisplayId: orderDisplay, orderStatus: 'Shipping', orderKind: 'SALE',
  customerName: 'Md. Rahim', customerPhone: '01700000001', itemCount: 2, orderTotal: 1250,
})

const orderPreview = (id: string, display: string, allowed: { id: string; name: string }[], customer = 'Md. Rahim', phone = '01700000001') => ({
  id, displayId: display, status: 'Confirmed', kind: 'SALE', allowedStatuses: allowed,
  customerName: customer, customerPhone: phone, itemCount: 2, orderTotal: 1250,
})

async function scanText(page: any, text: string) {
  const input = page.getByPlaceholder(/Scan or enter/i)
  await userEvent.fill(input, text)
  await userEvent.keyboard('{Enter}')
}

describe('Scanner page', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    mockGet.mockResolvedValue({ data: purposes })
  })

  it('reads as a scanner workspace: compact task selector + dominant input', async () => {
    const page = await renderPage()
    expect(page.getByText('Scanner', { exact: true })).not.toBeNull()
    expect(page.getByRole('combobox')).not.toBeNull()
    expect(page.getByPlaceholder(/Scan or enter/i)).not.toBeNull()
    // Default handover helper is contextual, not generic.
    expect(page.getByText(/courier dispatch ID, tracking code, or order number/i)).not.toBeNull()
    // No dashboard KPI cards.
    await expect.element(page.getByText('Pending', { exact: true })).not.toBeInTheDocument()
    expect(page.getByText('Ready to scan')).not.toBeNull()
  })

  it('switches task via the selector and adapts helper text', async () => {
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    expect(page.getByText(/returned courier dispatch ID/i)).not.toBeNull()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    expect(page.getByText(/one or more order numbers/i)).not.toBeNull()
  })

  it('executes a handover immediately on a single scan', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'CONS-1', dispatches: [dispatchPreview('d1', 'CONS-1')], order: null } })
      }
      if (url === '/scanner/scan') {
        return Promise.resolve({
          data: {
            status: 'success', identifier: 'CONS-1', title: 'CONS-1 — Handed Over',
            message: 'Dispatch handed over to the courier. Stock deducted (idempotent).',
            courier: 'pathao', oldState: 'DISPATCHED', newState: 'HANDED_OVER',
            details: { dispatchId: 'd1', orderId: 'o1' },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await scanText(page, 'CONS-1')
    expect(page.getByText('CONS-1 — Handed Over')).not.toBeNull()
    expect(page.getByText('Recent scans')).not.toBeNull()
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.dispatchId).toBe('d1')
    expect(scanCall?.[1]?.dispatchIds).toBeUndefined()
    // Input stays ready for the next scan.
    expect(page.getByPlaceholder(/Scan or enter/i)).not.toBeNull()
  })

  it('treats an idempotent repeat as already-done, not a failure', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'CONS-1', dispatches: [dispatchPreview('d1', 'CONS-1')], order: null } })
      }
      return Promise.resolve({
        data: {
          status: 'duplicate', identifier: 'CONS-1', title: 'CONS-1 — Already Handed Over',
          message: 'This dispatch was already handed over. No stock was deducted again.',
          courier: 'pathao', oldState: 'HANDED_OVER', newState: 'HANDED_OVER',
        },
      })
    })
    const page = await renderPage()
    await scanText(page, 'CONS-1')
    expect(page.getByText('CONS-1 — Already Handed Over')).not.toBeNull()
    expect(page.getByText('Already done', { exact: false })).not.toBeNull()
  })

  it('shows an actionable error for an unknown identifier', async () => {
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({ data: { status: 'not_found', identifier: 'NOPE-1', message: 'No dispatch found for "NOPE-1".', dispatches: [], order: null } })
        : Promise.resolve({ data: {} }),
    )
    const page = await renderPage()
    await scanText(page, 'NOPE-1')
    expect(page.getByText('No dispatch found for "NOPE-1".')).not.toBeNull()
    expect(page.getByText('Failed', { exact: false })).not.toBeNull()
  })

  it('resolves multiple dispatches inline without leaving the page', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'selection_required', identifier: 'DUP-1',
            message: 'Multiple dispatches found. Select the dispatch to continue.',
            dispatches: [dispatchPreview('d1', 'DUP-1', 'pathao'), dispatchPreview('d2', 'DUP-1', 'redx')],
            order: null,
          },
        })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'DUP-1', title: 'DUP-1 — Handed Over',
          message: 'Dispatch handed over to the courier. Stock deducted (idempotent).',
          courier: 'pathao', oldState: 'DISPATCHED', newState: 'HANDED_OVER', details: { dispatchId: 'd1' },
        },
      })
    })
    const page = await renderPage()
    await scanText(page, 'DUP-1')
    expect(page.getByText(/2 dispatches found/i)).not.toBeNull()
    expect(page.getByText('redx', { exact: false })).not.toBeNull()
    await userEvent.click(page.getByRole('button', { name: /Select DUP-1 \(pathao\)/ }))
    expect(page.getByText('DUP-1 — Handed Over')).not.toBeNull()
    await expect.element(page.getByText(/2 dispatches found/i)).not.toBeInTheDocument()
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.dispatchId).toBe('d1')
  })

  it('batch mode stages dense dispatch rows and confirms one explicit apply', async () => {
    let n = 0
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        n++
        return Promise.resolve({ data: { status: 'resolved', identifier: `CONS-${n}`, dispatches: [dispatchPreview(`d${n}`, `CONS-${n}`, 'pathao', `ORD-260930-000${n}`)], order: null } })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'CONS-2', title: 'Batch — 2 handed over, 0 failed',
          message: 'All 2 dispatches handed over (stock deduction idempotent).',
          details: { succeeded: 2, failed: 0 },
        },
      })
    })
    const page = await renderPage()
    await userEvent.click(page.getByRole('switch'))
    await scanText(page, 'CONS-1')
    await scanText(page, 'CONS-2')
    // Dense rows: identifier + customer on one line, newest first.
    expect(page.getByText('Staged dispatches')).not.toBeNull()
    expect(page.getByText('Md. Rahim', { exact: false })).not.toBeNull()
    // Nothing executed yet.
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await userEvent.click(page.getByRole('button', { name: /Apply to 2 dispatches/ }))
    // Bulk confirmation states the scope.
    expect(page.getByText(/Apply to 2 dispatches\?/)).not.toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'Confirm' }))
    expect(page.getByText('Batch — 2 handed over, 0 failed', { exact: false })).not.toBeNull()
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.dispatchIds).toEqual(['d2', 'd1'])
  })

  it('ORDER_STATUS stages a dense order row and applies the picked status', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', [{ id: 'st-delivered', name: 'Delivered' }]),
          },
        })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'ORD-1', title: 'ORD-1 — Delivered',
          message: 'Order status changed Shipping → Delivered.', oldState: 'Shipping', newState: 'Delivered', details: { orderId: 'o1' },
        },
      })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    // One compact row: order, customer, items + total.
    expect(page.getByText('Staged orders')).not.toBeNull()
    expect(page.getByText('Md. Rahim', { exact: false })).not.toBeNull()
    expect(page.getByText(/2 items/, { exact: false })).not.toBeNull()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await userEvent.click(page.getByRole('button', { name: '→ Delivered' }))
    await userEvent.click(page.getByRole('button', { name: /Apply to 1 order/ }))
    expect(page.getByText('ORD-1 — Delivered')).not.toBeNull()
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.orderId).toBe('o1')
    expect(scanCall?.[1]?.targetStatusId).toBe('st-delivered')
  })

  it('ORDER_STATUS only offers statuses valid for EVERY staged order', async () => {
    let call = 0
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        call++
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: `ORD-${call}`, dispatches: [],
            order: orderPreview(`o${call}`, `ORD-${call}`, call === 1
              ? [{ id: 'st-delivered', name: 'Delivered' }, { id: 'st-rp', name: 'Return Pending' }]
              : [{ id: 'st-rp', name: 'Return Pending' }, { id: 'st-hold', name: 'Hold' }]),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    await scanText(page, 'ORD-2')
    expect(page.getByText('Staged orders')).not.toBeNull()
    expect(page.getByText('→ Return Pending', { exact: false })).not.toBeNull()
    await expect.element(page.getByText('→ Delivered', { exact: false })).not.toBeInTheDocument()
    await expect.element(page.getByText('→ Hold', { exact: false })).not.toBeInTheDocument()
  })

  it('a duplicate scan never creates a second staged row', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', [{ id: 'st-delivered', name: 'Delivered' }]),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    await scanText(page, 'ORD-1')
    expect(page.getByText('ORD-1 — Already staged')).not.toBeNull()
    // Exactly one staged row for ORD-1 (the remove button exists once).
    expect(page.getByRole('button', { name: 'Remove ORD-1 from staged list' })).not.toBeNull()
  })

  it('staged rows link out to order detail and can be removed', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', [{ id: 'st-delivered', name: 'Delivered' }]),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    const open = page.getByRole('link', { name: /Open order ORD-1/ })
    await expect.element(open).toHaveAttribute('href', '/admin/op/orders/o1')
    await expect.element(open).toHaveAttribute('target', '_blank')
    await userEvent.click(page.getByRole('button', { name: 'Remove ORD-1 from staged list' }))
    await expect.element(page.getByText('Staged orders')).not.toBeInTheDocument()
  })

  it('staged search narrows the dense list without new requests', async () => {
    let call = 0
    const names = ['Md. Rahim', 'Nusrat Jahan']
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        call++
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: `ORD-${call}`, dispatches: [],
            order: orderPreview(`o${call}`, `ORD-${call}`, [{ id: 'st-delivered', name: 'Delivered' }], names[call - 1]),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    await scanText(page, 'ORD-2')
    const resolveCalls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/resolve').length
    await userEvent.fill(page.getByPlaceholder(/Search order/), 'nusrat')
    expect(page.getByText('Nusrat Jahan', { exact: false })).not.toBeNull()
    await expect.element(page.getByText('Md. Rahim', { exact: false })).not.toBeInTheDocument()
    // Search is local — no further resolve traffic.
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/resolve')).toHaveLength(resolveCalls)
  })

  it('STICKER_PRINT resolves to a ready-to-print result with a print action', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: { status: 'resolved', identifier: 'ORD-1', dispatches: [], order: orderPreview('o1', 'ORD-1', []) },
        })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'ORD-1', title: 'ORD-1 — Sticker Print',
          message: 'Sticker label ready to print.', details: { orderId: 'o1', printUrl: '/admin/op/print/sticker/o1' },
        },
      })
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'STICKER_PRINT')
    await scanText(page, 'ORD-1')
    expect(page.getByText('ORD-1 — Sticker Print')).not.toBeNull()
    await userEvent.click(page.getByRole('button', { name: /Print sticker/ }))
    expect(openSpy).toHaveBeenCalledWith('/admin/op/print/sticker/o1', '_blank')
    openSpy.mockRestore()
  })

  it('filters recent scans by Success / Failed / Needs action', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'CONS-1', dispatches: [dispatchPreview('d1', 'CONS-1')], order: null } })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'CONS-1', title: 'CONS-1 — Handed Over',
          message: 'Dispatch handed over to the courier. Stock deducted (idempotent).',
          courier: 'pathao', oldState: 'DISPATCHED', newState: 'HANDED_OVER', details: {},
        },
      })
    })
    const page = await renderPage()
    await scanText(page, 'CONS-1')
    mockPost.mockImplementation((url: string) =>
      url === '/scanner/resolve'
        ? Promise.resolve({ data: { status: 'not_found', identifier: 'NOPE-9', message: 'No dispatch found for "NOPE-9".', dispatches: [], order: null } })
        : Promise.resolve({ data: {} }),
    )
    await scanText(page, 'NOPE-9')
    expect(page.getByText('Needs action')).not.toBeNull()
    await userEvent.click(page.getByRole('tab', { name: 'Failed' }))
    expect(page.getByText('No dispatch found for "NOPE-9".')).not.toBeNull()
    await expect.element(page.getByText('CONS-1 — Handed Over')).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('tab', { name: 'Success' }))
    expect(page.getByText('CONS-1 — Handed Over')).not.toBeNull()
  })

  it('Escape clears the scan input without breaking the loop', async () => {
    mockPost.mockImplementation(() => Promise.resolve({ data: {} }))
    const page = await renderPage()
    const input = page.getByPlaceholder(/Scan or enter/i)
    await userEvent.fill(input, 'PARTIAL-1')
    await userEvent.keyboard('{Escape}')
    expect(page.getByPlaceholder(/Scan or enter/i)).not.toBeNull()
  })

  it('shows the snapshot phone when the order has no customer name', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-9', dispatches: [],
            order: orderPreview('o9', 'ORD-9', [{ id: 'st-delivered', name: 'Delivered' }], 'Guest', '01811111111'),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-9')
    expect(page.getByText('01811111111', { exact: false })).not.toBeNull()
  })

  it('search finds staged rows by phone number', async () => {
    let call = 0
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        call++
        const id = `ORD-${call}`
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: id, dispatches: [],
            order: orderPreview(`o${call}`, id, [{ id: 'st-delivered', name: 'Delivered' }],
              call === 1 ? 'Guest' : 'Md. Rahim', call === 1 ? '01811111111' : '01700000001'),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    await scanText(page, 'ORD-2')
    await userEvent.fill(page.getByPlaceholder(/Search order/), '01811')
    expect(page.getByText('01811111111', { exact: false })).not.toBeNull()
    await expect.element(page.getByText('Md. Rahim', { exact: false })).not.toBeInTheDocument()
  })

  it('immediate results carry the customer context line', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'CONS-1', dispatches: [dispatchPreview('d1', 'CONS-1')], order: null } })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'CONS-1', title: 'CONS-1 — Handed Over',
          message: 'Dispatch handed over to the courier. Stock deducted (idempotent).',
          courier: 'pathao', oldState: 'DISPATCHED', newState: 'HANDED_OVER', details: { dispatchId: 'd1' },
        },
      })
    })
    const page = await renderPage()
    await scanText(page, 'CONS-1')
    expect(page.getByText('Md. Rahim · ORD-260930-0001', { exact: false })).not.toBeNull()
  })

  it('RETURN_RECEIVE shows the backend No-active message when nothing is linked', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'not_found', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', []),
            linked: [],
            message: 'No active return/exchange for this order.',
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'RETURN_RECEIVE')
    await scanText(page, 'ORD-1')
    expect(page.getByText('No active return/exchange for this order.', { exact: false })).not.toBeNull()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
  })

  it('RETURN_RECEIVE receives the single linked return at once (order never marked)', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', []),
            linked: [{ kind: 'return', id: 'ret-1', displayId: 'RTN-1', status: 'REQUESTED' }],
            message: 'One active return RTN-1 is linked to this order — ready to receive.',
          },
        })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'ORD-1', title: 'RTN-1 — Received',
          message: 'Return received and restocked (idempotent per return).',
          details: { returnId: 'ret-1', returnDisplayId: 'RTN-1', orderId: 'o1' },
        },
      })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'RETURN_RECEIVE')
    await scanText(page, 'ORD-1')
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.returnId).toBe('ret-1')
    expect(scanCall?.[1]?.orderId).toBeUndefined()
    expect(page.getByText('RTN-1 — Received')).not.toBeNull()
  })

  it('RETURN_RECEIVE offers a picker when several legs are linked', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'selection_required', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', []),
            linked: [
              { kind: 'return', id: 'ret-1', displayId: 'RTN-1', status: 'REQUESTED' },
              { kind: 'exchange', id: 'ex-1', displayId: 'ORD-EX-1', status: 'Shipping' },
            ],
            message: 'Multiple returns/exchanges are linked to this order. Select one to continue.',
          },
        })
      }
      return Promise.resolve({
        data: {
          status: 'success', identifier: 'ORD-1', title: 'RTN-1 — Received',
          message: 'Return received and restocked (idempotent per return).',
          details: { returnId: 'ret-1' },
        },
      })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'RETURN_RECEIVE')
    await scanText(page, 'ORD-1')
    // Picker lists both legs; no execute fired yet.
    expect(page.getByText('RTN-1', { exact: true })).not.toBeNull()
    expect(page.getByText('ORD-EX-1', { exact: true })).not.toBeNull()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await userEvent.click(page.getByRole('button', { name: 'Select RTN-1' }))
    const scanCall = mockPost.mock.calls.find((c) => c[0] === '/scanner/scan')
    expect(scanCall?.[1]?.returnId).toBe('ret-1')
    expect(page.getByText('RTN-1 — Received')).not.toBeNull()
  })
})
