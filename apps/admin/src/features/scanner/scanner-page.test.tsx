import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import ScannerPage from './index'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

/**
 * The camera library is mocked with lifecycle counters: the shared session
 * contract is "start ONCE per open camera, stop ONCE on close" — a decode or
 * a task switch must never restart it.
 */
const { cameraStarts, cameraStops, cameraDecodes } = vi.hoisted(() => ({
  cameraStarts: [] as string[],
  cameraStops: [] as string[],
  cameraDecodes: [] as ((text: string) => void)[],
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    isScanning = false
    static getCameras = vi.fn().mockResolvedValue([])
    constructor(public elementId: string) {}
    start = vi.fn((_target: unknown, _config: unknown, onSuccess: (t: string) => void) => {
      cameraStarts.push(this.elementId)
      cameraDecodes.push(onSuccess)
      return Promise.resolve()
    })
    stop = vi.fn(() => {
      cameraStops.push(this.elementId)
      return Promise.resolve()
    })
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

const RETURN_STAGING_KEY = 'ecomate:scanner:staged-returns'
const LEGACY_RETURN_STAGING_KEY = 'ecomate:scanner:return-staged'
/** The selected scan task is persisted (Part 0) — reset it per test. */
const SCAN_TASK_KEY = 'ecomate:scanner:task'

const resetStagedStorage = () => {
  localStorage.removeItem(RETURN_STAGING_KEY)
  localStorage.removeItem(LEGACY_RETURN_STAGING_KEY)
  localStorage.removeItem(SCAN_TASK_KEY)
}

describe('Scanner page', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    cameraStarts.length = 0
    cameraStops.length = 0
    cameraDecodes.length = 0
    mockGet.mockResolvedValue({ data: purposes })
    resetStagedStorage()
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
    // ONE line covers every accepted return identifier.
    expect(
      page.getByText(/courier dispatch ID, tracking code, order QR\/barcode, or an RTN/i),
    ).not.toBeNull()
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
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    expect(page.getByText('No active return/exchange for this order.', { exact: false })).not.toBeNull()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
  })

  it('RETURN_RECEIVE stages the single linked return for batch receiving (never executes)', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: { ...orderPreview('o1', 'ORD-1', [], 'Md. Rahim', '01700000001'), items: [{ name: 'Black Tee', quantity: 1, price: 450 }] },
            linked: [{
              kind: 'return', id: 'ret-1', displayId: 'RTN-1', status: 'REQUESTED', orderDisplayId: 'ORD-1',
              coversUnits: 2, orderUnits: 3, processable: true, reason: null,
              items: [{ name: 'Blue Hoodie', variantLabel: 'Size: M', sku: 'HD-BLU-M', image: null, quantity: 2, price: 600 }],
            }],
            message: 'One active return RTN-1 is linked to this order — ready to receive.',
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    // Staged for batch receiving — never executed by a scan.
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await expect.element(page.getByText('Staged returns')).toBeInTheDocument()
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    // Row context: customer name + phone + WhatsApp affordance.
    await expect.element(page.getByText('Md. Rahim', { exact: false })).toBeInTheDocument()
    expect(document.querySelector('a[href^="tel:01700000001"]')).not.toBeNull()
    expect(document.querySelector('a[href*="wa.me"]')).not.toBeNull()
    // The scan result feed records the staging event.
    await expect.element(page.getByText('RTN-1 — Staged')).toBeInTheDocument()
  })

  it('RETURN_RECEIVE stages the picked leg from the picker (no execute)', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'selection_required', identifier: 'ORD-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', []),
            linked: [
              { kind: 'return', id: 'ret-1', displayId: 'RTN-1', status: 'REQUESTED', orderDisplayId: 'ORD-1', processable: true, reason: null, items: [{ name: 'Blue Hoodie', quantity: 2 }] },
              { kind: 'exchange', id: 'ex-1', displayId: 'ORD-EX-1', status: 'Shipping', orderDisplayId: 'ORD-1', processable: true, reason: null, items: [{ name: 'Red Cap', quantity: 1 }] },
            ],
            message: 'Multiple returns/exchanges are linked to this order. Select one to continue.',
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    // Picker lists both legs; no execute fired yet.
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('ORD-EX-1', { exact: true })).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await userEvent.click(page.getByRole('button', { name: 'Select RTN-1' }))
    // Picked leg staged — still zero executions. The unpicked leg never stages.
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('ORD-EX-1', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('RTN-1 — Staged')).toBeInTheDocument()
    // The picked row keeps the customer context carried by the resolve payload
    // (same as the single-leg path — the picker must not lose the order).
    expect(document.querySelector('a[href^="tel:01700000001"]')).not.toBeNull()
  })
})

describe('Scanner page — staged returns: persistence, attention rows, batch processing', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    cameraStarts.length = 0
    cameraStops.length = 0
    cameraDecodes.length = 0
    mockGet.mockResolvedValue({ data: purposes })
    resetStagedStorage()
  })

  const returnLeg = (overrides: Record<string, unknown> = {}) => ({
    kind: 'return', id: 'ret-1', displayId: 'RTN-1', status: 'REQUESTED', orderDisplayId: 'ORD-1',
    coversUnits: 2, orderUnits: 3, processable: true, reason: null,
    items: [{ name: 'Blue Hoodie', variantLabel: 'Size: M', sku: 'HD-BLU-M', image: null, quantity: 2, price: 600 }],
    ...overrides,
  })

  const mockReturnResolve = (leg: Record<string, unknown>, identifier = 'ORD-1') => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier, dispatches: [],
            order: orderPreview('o1', identifier, [], 'Md. Rahim', '01700000001'),
            linked: [returnLeg(leg)],
            message: 'One active return is linked to this order.',
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
  }

  it('a duplicate scan keeps one row and records Already staged in the feed', async () => {
    mockReturnResolve({})
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    await scanText(page, 'ORD-1')
    await expect.element(page.getByText('RTN-1 — Already staged')).toBeInTheDocument()
    // Exactly one staged row for RTN-1.
    await expect.element(page.getByRole('button', { name: 'Remove RTN-1 from staged list' })).toBeInTheDocument()
  })

  it('confirmed RETURN_RECEIVE lines carry receive-time damage into the ONE Process call', async () => {
    mockReturnResolve({
      itemsConfirmed: true,
      items: [{
        productId: 'p-1', variantId: 'v-1', name: 'Blue Hoodie', variantLabel: 'Size: M',
        sku: 'HD-BLU-M', image: null, quantity: 2, maxQuantity: 2, price: 600,
      }],
    })
    const base = mockPost.getMockImplementation()!
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/scanner/scan') {
        return Promise.resolve({
          data: {
            status: 'success', identifier: 'ORD-1', title: 'RTN-1 — Received',
            message: 'Return RTN-1 → RESTOCKED; 1 unit(s) damaged — not restocked.',
            details: { restocked: true },
            ...body,
          },
        })
      }
      return base(url, body)
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    await userEvent.click(page.getByRole('button', { name: 'Expand RTN-1' }))
    await userEvent.fill(page.getByLabelText('Damaged quantity for Blue Hoodie'), '1')
    await userEvent.click(page.getByRole('button', { name: /Process returns/ }))

    const calls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({
      purpose: 'RETURN_RECEIVE',
      identifier: 'ORD-1',
      returnId: 'ret-1',
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2, damagedQuantity: 1 }],
    })
    await expect.element(page.getByText(/1 unit\(s\) damaged — not restocked/)).toBeInTheDocument()
  })

  it('a RESTOCKED leg stages as an attention row with its reason and blocks processing', async () => {
    mockReturnResolve({ id: 'ret-3', displayId: 'RTN-3', status: 'RESTOCKED', processable: false, reason: 'Already received — stock was restored earlier.' })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    // Row staged; the reason is recorded in the feed as a warning.
    await expect.element(page.getByText('RTN-3', { exact: true })).toBeInTheDocument()
    // The reason is on the ROW and in the feed — both are correct.
    await expect.element(page.getByText('Already received — stock was restored earlier.').first()).toBeInTheDocument()
    // Amber row tint on the attention row.
    expect(document.querySelector('[data-staged-row="ret-3"]')?.className).toMatch(/amber/)
    // Process button states the counts and is disabled: nothing is ready.
    const button = page.getByRole('button', { name: /Process returns/ })
    await expect.element(page.getByText('Process returns (0 ready · 1 need attention)', { exact: false })).toBeInTheDocument()
    await expect.element(button).toBeDisabled()
  })

  it('survives a malformed localStorage seed without crashing and still stages normally', async () => {
    localStorage.setItem(RETURN_STAGING_KEY, 'not-json{')
    mockReturnResolve({})
    const page = await renderPage()
    await expect.element(page.getByText('Ready to scan')).toBeInTheDocument()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    await expect.element(page.getByText('Staged returns')).toBeInTheDocument()
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/resolve')).toHaveLength(1)
  })

  it('refresh keeps the staged list: rows restore from localStorage without any resolve call', async () => {
    localStorage.setItem(RETURN_STAGING_KEY, JSON.stringify([{
      key: 'ret-1', identifier: 'ORD-1', kind: 'return', legId: 'ret-1', displayId: 'RTN-1',
      orderDisplayId: 'ORD-1', status: 'REQUESTED', processable: true, reason: null,
      customerName: 'Md. Rahim', customerPhone: '01700000001',
      items: [{ name: 'Blue Hoodie', variantLabel: 'Size: M', sku: 'HD-BLU-M', image: null, quantity: 2, price: 600 }],
    }]))
    mockPost.mockImplementation(() => Promise.resolve({ data: {} }))
    const page = await renderPage()
    // Restored rows show under their own task (RETURN_RECEIVE).
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Md. Rahim', { exact: false })).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/resolve')).toHaveLength(0)
    // Expansion data persists with the row.
    await userEvent.click(page.getByRole('button', { name: 'Expand RTN-1' }))
    await expect.element(page.getByText('Blue Hoodie', { exact: false })).toBeInTheDocument()
    // ONE staged list: switching task keeps it visible (never cleared/hidden).
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
  })

  it('clear asks for confirmation mentioning unprocessed legs, then empties list and storage', async () => {
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/scanner/resolve') {
        const id = body?.identifier ?? 'ORD-1'
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: id, dispatches: [],
            order: orderPreview('o1', id, [], 'Md. Rahim', '01700000001'),
            linked: [returnLeg({ id: id === 'ORD-1' ? 'ret-1' : 'ret-2', displayId: id === 'ORD-1' ? 'RTN-1' : 'RTN-2', orderDisplayId: id })],
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    await scanText(page, 'ORD-2')
    await userEvent.click(page.getByRole('button', { name: 'Clear' }).first())
    await expect.element(page.getByText('Clear staged list?')).toBeInTheDocument()
    await expect.element(page.getByText(/unprocessed/i)).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Clear 2' }))
    await expect.element(page.getByText('RTN-1', { exact: true })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(RETURN_STAGING_KEY) ?? '[]')).toHaveLength(0)
  })

  it('process batch is sequential, removes settled rows, keeps failed rows with the live reason, and never scans attention rows', async () => {
    const legs: Record<string, Record<string, unknown>> = {
      'ORD-1': returnLeg({}),
      'ORD-2': { kind: 'exchange', id: 'ex-2', displayId: 'ORD-EX-1', status: 'Shipping', orderDisplayId: 'ORD-2', processable: true, reason: null, items: [{ name: 'Red Cap', quantity: 1 }] },
      'ORD-3': returnLeg({ id: 'ret-2', displayId: 'RTN-2', orderDisplayId: 'ORD-3', items: [{ name: 'Wool Scarf', quantity: 1 }] }),
      'ORD-4': returnLeg({ id: 'ret-3', displayId: 'RTN-3', orderDisplayId: 'ORD-4', status: 'RESTOCKED', processable: false, reason: 'Already received — stock was restored earlier.' }),
    }
    let ret2Attempts = 0
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/scanner/resolve') {
        const id = body?.identifier ?? ''
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: id, dispatches: [],
            order: orderPreview('o1', id, [], 'Md. Rahim', '01700000001'),
            linked: [legs[id]],
            message: 'One active return is linked to this order.',
          },
        })
      }
      if (url === '/scanner/scan') {
        const key = body?.returnId ?? body?.exchangeId
        if (key === 'ret-1') {
          return Promise.resolve({ data: { status: 'success', identifier: 'ORD-1', title: 'RTN-1 — Received', message: 'Return received and restocked (idempotent per return).', details: { returnId: 'ret-1' } } })
        }
        if (key === 'ex-2') {
          return Promise.resolve({ data: { status: 'duplicate', identifier: 'ORD-2', title: 'ORD-EX-1 — Already handled', message: 'This exchange was already received.' } })
        }
        if (key === 'ret-2') {
          ret2Attempts += 1
          return Promise.resolve({
            data: ret2Attempts === 1
              ? { status: 'error', identifier: 'ORD-3', title: 'RTN-2 — Cannot receive', message: 'Return cannot be received in its current state.' }
              : { status: 'success', identifier: 'ORD-3', title: 'RTN-2 — Received', message: 'Return received and restocked.' },
          })
        }
        return Promise.resolve({ data: {} })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    for (const id of ['ORD-1', 'ORD-2', 'ORD-3', 'ORD-4']) await scanText(page, id)
    await expect.element(page.getByText('Process returns (3 ready · 1 need attention)', { exact: false })).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /Process returns/ }))
    // Sequential — row order, per-row payload (identifier + returnId/exchangeId), attention row skipped.
    const scanCalls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan').map((c) => c[1])
    // Processing follows the staged list order (top-down, newest scan first).
    expect(scanCalls).toEqual([
      expect.objectContaining({ purpose: 'RETURN_RECEIVE', identifier: 'ORD-3', returnId: 'ret-2' }),
      expect.objectContaining({ purpose: 'RETURN_RECEIVE', identifier: 'ORD-2', exchangeId: 'ex-2' }),
      expect.objectContaining({ purpose: 'RETURN_RECEIVE', identifier: 'ORD-1', returnId: 'ret-1' }),
    ])
    expect(scanCalls.some((p) => (p as any).returnId === 'ret-3')).toBe(false)
    // Settled rows leave the list; the failed + attention rows stay.
    await expect.element(page.getByText('RTN-1', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('ORD-EX-1', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('RTN-2', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('RTN-3', { exact: true })).toBeInTheDocument()
    // Feed preserved each outcome.
    await expect.element(page.getByText('RTN-1 — Received')).toBeInTheDocument()
    await expect.element(page.getByText('ORD-EX-1 — Already handled')).toBeInTheDocument()
    // Failed row carries the live error reason; it counts as attention but is
    // retryable in place (Process stays enabled).
    await expect.element(page.getByText('Process returns (0 ready · 2 need attention)', { exact: false })).toBeInTheDocument()
    const retry = page.getByRole('button', { name: /Process returns/ })
    await expect.element(retry).toBeEnabled()
    await userEvent.click(page.getByRole('button', { name: 'Expand RTN-2' }))
    // Reason shows BOTH in the expanded row note and in the feed error event.
    await expect.element(page.getByText('Return cannot be received in its current state.').first()).toBeInTheDocument()

    // Retry-in-place: the failed row re-validates and settles; the untouched
    // attention row is still never scanned.
    await userEvent.click(retry)
    await expect.element(page.getByText('RTN-2', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('RTN-3', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Process returns (0 ready · 1 need attention)', { exact: false })).toBeInTheDocument()
    const retried = mockPost.mock.calls
      .filter((c) => c[0] === '/scanner/scan')
      .map((c) => c[1])
      .filter((p: any) => p?.returnId === 'ret-2')
    expect(retried).toHaveLength(2)
    // Only the untouched attention row persists.
    expect(JSON.parse(localStorage.getItem(RETURN_STAGING_KEY) ?? '[]')).toHaveLength(1)
  })

  it('sticker staged rows expand into the ORDER items pre-fetched from the scan outcome', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: { ...orderPreview('o1', 'ORD-1', []), items: [{ name: 'Printed Mug', sku: 'MUG-1', image: null, quantity: 1, price: 300 }] },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.click(page.getByRole('switch'))
    await userEvent.selectOptions(page.getByRole('combobox'), 'STICKER_PRINT')
    await scanText(page, 'ORD-1')
    await expect.element(page.getByText('Staged prints')).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await userEvent.click(page.getByRole('button', { name: 'Expand ORD-1' }))
    await expect.element(page.getByText('Order items')).toBeInTheDocument()
    await expect.element(page.getByText('Printed Mug')).toBeInTheDocument()
  })

  it('ORDER_STATUS staged rows expand into the order items from the resolve payload', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'ORD-1', dispatches: [],
            order: { ...orderPreview('o1', 'ORD-1', [{ id: 'st-delivered', name: 'Delivered' }]), items: [{ name: 'Black Tee', sku: 'TEE-BLK-M', image: null, quantity: 2, price: 600 }] },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await scanText(page, 'ORD-1')
    await expect.element(page.getByText('Staged orders')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Expand ORD-1' }))
    await expect.element(page.getByText('Order items')).toBeInTheDocument()
    await expect.element(page.getByText('Black Tee')).toBeInTheDocument()
    await expect.element(page.getByText('× 2')).toBeInTheDocument()
  })

  it('dispatch staged rows expand into that dispatch order items', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'CONS-1',
            dispatches: [{ ...dispatchPreview('d1', 'CONS-1'), items: [{ name: 'Cargo Bag', sku: 'BAG-CG-1', image: null, quantity: 3, price: 500 }] }],
            order: null,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.click(page.getByRole('switch'))
    await scanText(page, 'CONS-1')
    await expect.element(page.getByText('Staged dispatches')).toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Expand CONS-1' }))
    await expect.element(page.getByText('Order items')).toBeInTheDocument()
    await expect.element(page.getByText('Cargo Bag')).toBeInTheDocument()
    await expect.element(page.getByText('× 3')).toBeInTheDocument()
  })

  it('RETURN staged rows expand into the RETURNED items — never the order items', async () => {
    mockReturnResolve({})
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')
    await userEvent.click(page.getByRole('button', { name: 'Expand RTN-1' }))
    await expect.element(page.getByText('Returned items')).toBeInTheDocument()
    await expect.element(page.getByText('Blue Hoodie')).toBeInTheDocument()
    await expect.element(page.getByText('Size: M · HD-BLU-M')).toBeInTheDocument()
    await expect.element(page.getByText('× 2')).toBeInTheDocument()
    await expect.element(page.getByText('৳600')).toBeInTheDocument()
    // The order's own line items must never appear in the return staging panel.
    await expect.element(page.getByText('Order items')).not.toBeInTheDocument()
  })
})

describe('Scanner page — Process return (DISPATCH_RETURN) is stage-only', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    cameraStarts.length = 0
    cameraStops.length = 0
    cameraDecodes.length = 0
    mockGet.mockResolvedValue({ data: purposes })
    resetStagedStorage()
  })

  const dispatchReturn = (overrides: Record<string, unknown> = {}) => ({
    ...dispatchPreview('d-r1', 'CONS-R1'),
    status: 'RETURN_PENDING',
    processable: true,
    reason: null,
    items: [{
      productId: 'p-1',
      variantId: null,
      name: 'Blue Hoodie',
      variantLabel: 'Size: M',
      sku: 'HD-BLU-M',
      image: null,
      quantity: 2,
      maxQuantity: 2,
      price: 600,
    }],
    ...overrides,
  })

  const mockDispatchResolve = (dispatch: Record<string, unknown>, status = 'resolved') => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status,
            identifier: 'CONS-R1',
            dispatches: [dispatch],
            order: null,
            ...(status === 'selection_required'
              ? { message: 'Multiple dispatches are linked to this order. Select the dispatch to continue.' }
              : {}),
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
  }

  it('single-match scan STAGES with zero execute calls and shows the return context', async () => {
    mockDispatchResolve(dispatchReturn())
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'CONS-R1')

    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await expect.element(page.getByText('Staged returns')).toBeInTheDocument()
    await expect.element(page.getByText('CONS-R1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('ORD-260930-0001', { exact: false }).first()).toBeInTheDocument()
    await expect.element(page.getByText('Md. Rahim', { exact: false }).first()).toBeInTheDocument()
    await expect.element(page.getByText('pathao').first()).toBeInTheDocument()
    await expect.element(page.getByText('RETURN_PENDING').first()).toBeInTheDocument()
    await expect.element(page.getByText('CONS-R1 — Staged')).toBeInTheDocument()
  })

  it('picker path also stages the selected dispatch and never executes', async () => {
    mockDispatchResolve(dispatchReturn(), 'selection_required')
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'CONS-R1')
    await userEvent.click(page.getByRole('button', { name: 'Select CONS-R1 (pathao)' }))

    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await expect.element(page.getByText('CONS-R1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('CONS-R1 — Staged')).toBeInTheDocument()
  })

  it('duplicate scan keeps one row and records Already staged', async () => {
    mockDispatchResolve(dispatchReturn())
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'CONS-R1')
    await scanText(page, 'CONS-R1')

    await expect.element(page.getByText('CONS-R1 — Already staged')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Remove CONS-R1 from staged list' })).toBeInTheDocument()
  })

  it('an already-finalized dispatch stages as attention with its reason and is never processed', async () => {
    mockDispatchResolve(dispatchReturn({
      status: 'RETURNED',
      processable: false,
      reason: 'Already returned — stock was settled earlier. No action needed.',
    }))
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'CONS-R1')

    await expect.element(page.getByText('Already returned — stock was settled earlier. No action needed.').first()).toBeInTheDocument()
    await expect.element(page.getByText('Process returns (0 ready · 1 need attention)', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /Process returns/ })).toBeDisabled()
    expect(document.querySelector('[data-staged-row="d-r1"]')?.className).toMatch(/amber/)
  })

  it('a refresh restores BOTH purposes from the ONE staged-returns key under any task', async () => {
    localStorage.setItem(RETURN_STAGING_KEY, JSON.stringify([
      {
        key: 'ret-1', purpose: 'RETURN_RECEIVE', identifier: 'ORD-1', kind: 'return',
        legId: 'ret-1', orderId: 'o1', displayId: 'RTN-1', orderDisplayId: 'ORD-1',
        status: 'REQUESTED', processable: true, reason: null,
        customerName: 'Md. Rahim', customerPhone: '01700000001', items: [],
      },
      {
        key: 'd-r1', purpose: 'DISPATCH_RETURN', identifier: 'CONS-R1', kind: 'dispatch',
        legId: 'd-r1', dispatchId: 'd-r1', orderId: 'o1', displayId: 'CONS-R1',
        orderDisplayId: 'ORD-260930-0001', status: 'RETURN_PENDING', processable: true,
        reason: null, customerName: 'Md. Rahim', customerPhone: '01700000001',
        courier: 'pathao', trackingCode: 'TRK-1', items: [],
      },
    ]))
    const page = await renderPage()
    // Default task is DISPATCH_HANDED_OVER — the unified list still shows.
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('CONS-R1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('TRK-1', { exact: false })).toBeInTheDocument()
  })

  it('Process executes exactly once with the confirmed damaged line and removes the row', async () => {
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'CONS-R1', dispatches: [dispatchReturn()], order: null } })
      }
      if (url === '/scanner/scan') {
        return Promise.resolve({
          data: {
            status: 'success',
            identifier: 'CONS-R1',
            title: 'CONS-R1 — Returned',
            message: 'Order ORD-260930-0001 → Returned; stock restored. 1 unit(s) damaged — not restocked.',
            details: { dispatchId: 'd-r1', restoredItems: [{ productId: 'p-1', variantId: null, quantity: 1, damagedQuantity: 1 }] },
            ...body,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'CONS-R1')
    await userEvent.click(page.getByRole('button', { name: 'Expand CONS-R1' }))
    await userEvent.fill(page.getByLabelText('Damaged quantity for Blue Hoodie'), '1')
    await userEvent.click(page.getByRole('button', { name: /Process returns/ }))

    const calls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({
      purpose: 'DISPATCH_RETURN',
      identifier: 'CONS-R1',
      dispatchId: 'd-r1',
      items: [{ productId: 'p-1', variantId: null, quantity: 2, damagedQuantity: 1 }],
    })
    await expect.element(page.getByText('CONS-R1', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText(/1 unit\(s\) damaged — not restocked/)).toBeInTheDocument()
  })
})

describe('Scanner page — ONE merged Process return task (cross-kind resolve)', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    cameraStarts.length = 0
    cameraStops.length = 0
    cameraDecodes.length = 0
    mockGet.mockResolvedValue({ data: purposes })
    resetStagedStorage()
  })

  const returnLeg = (overrides: Record<string, unknown> = {}) => ({
    kind: 'return',
    labelKind: 'return',
    id: 'ret-1',
    displayId: 'RTN-1',
    status: 'REQUESTED',
    orderDisplayId: 'ORD-1',
    coversUnits: 2,
    orderUnits: 3,
    processable: true,
    reason: null,
    items: [{ name: 'Blue Hoodie', variantLabel: 'Size: M', sku: 'HD-BLU-M', image: null, quantity: 2, price: 600 }],
    ...overrides,
  })

  const dispatchReturn = (overrides: Record<string, unknown> = {}) => ({
    ...dispatchPreview('d-r1', 'CONS-R1'),
    status: 'RETURN_PENDING',
    processable: true,
    reason: null,
    items: [{
      productId: 'p-1', variantId: null, name: 'Blue Hoodie', variantLabel: 'Size: M',
      sku: 'HD-BLU-M', image: null, quantity: 2, maxQuantity: 2, price: 600,
    }],
    ...overrides,
  })

  it('offers exactly ONE return task — Process return — and no Receive return / exchange', async () => {
    const page = await renderPage()
    await expect.element(page.getByRole('option', { name: /Process return/ })).toBeInTheDocument()
    const labels = Array.from(
      document.querySelectorAll<HTMLOptionElement>('#scan-task option'),
    ).map((o) => o.textContent ?? '')
    expect(labels.some((l) => /Process return/.test(l))).toBe(true)
    expect(labels.some((l) => /Receive return/i.test(l))).toBe(false)
    // The hidden backend purpose never appears as a selectable task.
    expect(
      Array.from(document.querySelectorAll<HTMLOptionElement>('#scan-task option')).some(
        (o) => o.value === 'RETURN_RECEIVE',
      ),
    ).toBe(false)
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
  })

  it('RTN display-id scan stages the Return leg through the merged task', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'RTN-1', dispatches: [],
            order: orderPreview('o1', 'ORD-1', [], 'Md. Rahim', '01700000001'),
            linked: [returnLeg()],
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'RTN-1')

    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await expect.element(page.getByText('RTN-1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('RTN-1 — Staged')).toBeInTheDocument()
  })

  it('tracking-code scan stages the dispatch row', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: { status: 'resolved', identifier: 'TRK-9001', dispatches: [dispatchReturn()], order: null, linked: [] },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'TRK-9001')

    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)
    await expect.element(page.getByText('CONS-R1', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('CONS-R1 — Staged')).toBeInTheDocument()
  })

  it('order number matching BOTH kinds opens one picker with plain labels; the chosen dispatch stages', async () => {
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'selection_required', identifier: 'ORD-1', dispatches: [dispatchReturn()],
            order: orderPreview('o1', 'ORD-1', [], 'Md. Rahim', '01700000001'),
            linked: [
              returnLeg(),
              returnLeg({ kind: 'return', labelKind: 'exchange', id: 'ret-ex', displayId: 'RTN-EX-9', status: 'REQUESTED' }),
            ],
            message: 'Multiple return options are linked to this order. Select the dispatch, return, or exchange to continue.',
          },
        })
      }
      if (url === '/scanner/scan') return Promise.resolve({ data: { status: 'success', identifier: 'CONS-R1', title: 'Returned', message: 'Done', ...body } })
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'ORD-1')

    // Never silently picked one kind: all three candidates are listed, labelled plainly.
    await expect.element(page.getByText(/Courier return — CONS-R1/)).toBeInTheDocument()
    await expect.element(page.getByText(/Return RTN-1/)).toBeInTheDocument()
    await expect.element(page.getByText(/Exchange RTN-EX-9/)).toBeInTheDocument()
    expect(mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')).toHaveLength(0)

    await userEvent.click(page.getByRole('button', { name: 'Select CONS-R1 (pathao)' }))
    await userEvent.click(page.getByRole('button', { name: /Process returns/ }))

    const calls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual(expect.objectContaining({
      purpose: 'DISPATCH_RETURN',
      identifier: 'ORD-1',
      dispatchId: 'd-r1',
    }))
  })

  it('exchange RTN scan stages with the receive path + damaged controls (labelled Exchange in the picker)', async () => {
    mockPost.mockImplementation((url: string, body?: any) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: {
            status: 'resolved', identifier: 'RTN-EX-9', dispatches: [],
            order: orderPreview('o1', 'ORD-1', [], 'Md. Rahim', '01700000001'),
            linked: [returnLeg({
              id: 'ret-ex', displayId: 'RTN-EX-9', labelKind: 'exchange', itemsConfirmed: true,
              items: [{
                productId: 'p-1', variantId: 'v-1', name: 'Blue Hoodie', variantLabel: 'Size: M',
                sku: 'HD-BLU-M', image: null, quantity: 2, maxQuantity: 2, price: 600,
              }],
            })],
          },
        })
      }
      if (url === '/scanner/scan') return Promise.resolve({ data: { status: 'success', identifier: 'RTN-EX-9', title: 'Received', message: 'Done', ...body } })
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await scanText(page, 'RTN-EX-9')

    await userEvent.click(page.getByRole('button', { name: 'Expand RTN-EX-9' }))
    // Damage controls are present — exchange returns receive through the return path.
    await userEvent.fill(page.getByLabelText('Damaged quantity for Blue Hoodie'), '1')
    await userEvent.click(page.getByRole('button', { name: /Process returns/ }))

    const calls = mockPost.mock.calls.filter((c) => c[0] === '/scanner/scan')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual(expect.objectContaining({
      purpose: 'RETURN_RECEIVE',
      identifier: 'RTN-EX-9',
      returnId: 'ret-ex',
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2, damagedQuantity: 1 }],
    }))
  })
})

describe('Scanner page — persisted scan task + ONE camera session', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    cameraStarts.length = 0
    cameraStops.length = 0
    cameraDecodes.length = 0
    mockGet.mockResolvedValue({ data: purposes })
    resetStagedStorage()
  })

  it('persists the selected task and restores it on reload', async () => {
    const page = await renderPage()
    await userEvent.selectOptions(page.getByRole('combobox'), 'DISPATCH_RETURN')
    await expect
      .poll(() => (page.getByRole('combobox').element() as HTMLSelectElement).value)
      .toBe('DISPATCH_RETURN')

    // "Reload": a fresh mount reads the persisted task back.
    const reloaded = await renderPage()
    const reloadedSelect = reloaded.container.querySelector('#scan-task') as HTMLSelectElement
    await expect.poll(() => reloadedSelect.value).toBe('DISPATCH_RETURN')
  })

  it('falls back to the first task when the stored task is unknown', async () => {
    localStorage.setItem(SCAN_TASK_KEY, 'TASK_THAT_WAS_REMOVED')
    const page = await renderPage()
    await expect
      .poll(() => (page.getByRole('combobox').element() as HTMLSelectElement).value)
      .toBe('DISPATCH_HANDED_OVER')
  })

  it('keeps ONE camera session across decodes and task switches; closing stops it once', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({
          data: { status: 'resolved', identifier: 'CONS-1', dispatches: [], order: null, linked: [] },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await userEvent.click(page.getByRole('button', { name: 'Open camera scanner' }))
    await vi.waitFor(() => expect(cameraStarts).toHaveLength(1))

    // Three camera decodes — the session must NOT restart.
    cameraDecodes[0]?.('CONS-1')
    cameraDecodes[0]?.('CONS-2')
    cameraDecodes[0]?.('CONS-3')
    await new Promise((r) => setTimeout(r, 50))
    expect(cameraStarts).toHaveLength(1)
    expect(cameraStops).toHaveLength(0)

    // Switching the task must not corrupt the session.
    await userEvent.selectOptions(page.getByRole('combobox'), 'ORDER_STATUS')
    await new Promise((r) => setTimeout(r, 50))
    expect(cameraStarts).toHaveLength(1)
    expect(cameraStops).toHaveLength(0)

    // Closing the camera stops the session exactly once.
    await userEvent.click(page.getByRole('button', { name: 'Close camera scanner' }))
    await vi.waitFor(() => expect(cameraStops).toHaveLength(1))
    expect(cameraStarts).toHaveLength(1)
  })
})

describe('Scanner page — page-level nits', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
    cameraStarts.length = 0
    cameraStops.length = 0
    cameraDecodes.length = 0
    mockGet.mockResolvedValue({ data: purposes })
    resetStagedStorage()
  })

  it('keeps the Enter hint INSIDE the scan input row (no floating chip under the card)', async () => {
    const page = await renderPage()
    const input = page.getByPlaceholder(/Scan or enter/i).element() as HTMLInputElement
    const kbd = input.parentElement?.querySelector('kbd')
    expect(kbd).not.toBeNull()
    expect(kbd?.textContent).toContain('Enter')
  })

  it('shows a COMPACT Recent-scans empty state whose hint matches the task hint', async () => {
    const page = await renderPage()
    const strip = document.querySelector('[data-testid="recent-scans-empty"]') as HTMLElement
    expect(strip).not.toBeNull()
    // The hint copy is the TASK hint (it used to omit "tracking code").
    expect(strip.textContent).toContain('tracking code')
    // A compact strip, not a ~250px empty box.
    expect(strip.getBoundingClientRect().height).toBeLessThan(90)
  })

  it('gives the Recent-scans Clear a real button (≥36px, visible)', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/scanner/resolve') {
        return Promise.resolve({ data: { status: 'resolved', identifier: 'CONS-1', dispatches: [], order: null, linked: [] } })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderPage()
    await scanText(page, 'CONS-1')
    const clear = page.getByRole('button', { name: 'Clear' })
    const el = clear.element() as HTMLElement
    expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(36)
    expect(el.className).toMatch(/border/)
  })
})
