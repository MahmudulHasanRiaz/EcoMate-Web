import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReturnDetail } from './detail'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'ret-1' }),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/global-search-bar', () => ({ GlobalSearchBar: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null, Separator: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// SafeImage falls back to a placeholder data-URI once the (test-env) 404 fires —
// mock it so the assertion sees exactly the src the page resolved.
vi.mock('@/components/safe-image', () => ({
  SafeImage: ({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) => (
    <img src={src ?? ''} alt={alt ?? ''} className={className} />
  ),
}))

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: mockPost, put: vi.fn() } }))

/** Original ORDER snapshot embedded in GET /returns/:id (Tasks 1–2 shapes). */
const orderSnapshot = {
  id: 'order-1',
  displayId: 'ORD-261014-0001',
  kind: 'ORDER',
  createdAt: '2026-10-10T09:00:00Z',
  customerFirstName: 'Karim',
  customerLastName: 'Uddin',
  guestName: null,
  customerPhone: '+8801712345678',
  guestPhone: null,
  secondaryPhone: '+8801911111111',
  customer: { id: 'cust-1', name: 'Karim Uddin', email: 'karim@example.com', phone: '+8801712345678' },
  items: [
    {
      productId: 'p-1',
      variantId: 'v-1',
      quantity: 2,
      price: 600,
      product: { id: 'p-1', name: 'Classic Tee', sku: 'TEE-BLK', images: ['/uploads/tee.jpg'] },
      variant: {
        id: 'v-1',
        sku: 'TEE-BLK-M',
        image: '/uploads/tee-m.jpg',
        images: ['/uploads/tee-m.jpg'],
        attributeValues: [
          { attributeValue: { value: 'M', hexCode: null, attribute: { name: 'Size' } } },
        ],
      },
    },
    {
      productId: 'p-2',
      variantId: null,
      quantity: 1,
      price: 300,
      product: { id: 'p-2', name: 'Printed Mug', sku: 'MUG-1', images: ['/uploads/mug.jpg'] },
      variant: null,
    },
  ],
}

const baseDetail = {
  id: 'ret-1',
  displayId: 'RTN-261014-0001',
  orderId: 'order-1',
  type: 'FULL' as const,
  status: 'IN_TRANSIT',
  source: 'STAFF',
  items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }],
  reason: 'changed mind',
  courier: 'steadfast',
  courierReturnId: 'RTN-CG-1',
  courierStatus: 'return_list_accepted',
  stockReconciled: false,
  refundId: 'refund-1',
  exchangeOrderId: 'ex-1',
  createdBy: 'staff@ecomate.com',
  createdAt: '2026-10-14T10:00:00Z',
  updatedAt: '2026-10-14T10:00:00Z',
  order: orderSnapshot,
  exchangeOrder: { id: 'ex-1', displayId: 'ORD-261014-0002' },
  refund: { id: 'refund-1', status: 'pending' },
}

function renderDetail(overrides: Record<string, unknown> = {}) {
  const detail = { ...baseDetail, ...overrides }
  mockGet.mockImplementation((url: string) => {
    if (url === '/returns/ret-1') return Promise.resolve({ data: detail })
    if (url === '/orders/order-1')
      return Promise.resolve({ data: { id: 'order-1', courierConsignmentId: 'CG-1' } })
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReturnDetail />
    </QueryClientProvider>,
  )
}

describe('ReturnDetail (coverage panel)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns/ret-1') return Promise.resolve({ data: baseDetail })
      if (url === '/orders/order-1')
        return Promise.resolve({ data: { id: 'order-1', courierConsignmentId: 'CG-1' } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    mockPost.mockResolvedValue({ data: { ok: true } })
  })

  it('FULL return shows the coverage line ONCE (no repeated FULL/PARTIAL line)', async () => {
    // FULL: return items X = 3, order items Y = 3.
    const { getByText, container } = await renderDetail({
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }, { productId: 'p-2', variantId: null, quantity: 1 }],
    })
    await expect.element(getByText('This return covers 3 of 3 items from ORD-261014-0001')).toBeInTheDocument()
    // The type chip already carries the type — the banner must not repeat it.
    expect(container.textContent ?? '').not.toContain('FULL — all 3 items')
    expect(container.textContent ?? '').not.toContain('items\nPARTIAL')
  })

  it('PARTIAL return shows the X of Y coverage line exactly once', async () => {
    const { getByText, container } = await renderDetail({ type: 'PARTIAL' })
    await expect.element(getByText('This return covers 2 of 3 items from ORD-261014-0001')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain('PARTIAL — 2 of 3 items')
  })

  it('PARTIAL return that covers ALL ordered items raises the red contradiction warning (owner accident)', async () => {
    const { getByText } = await renderDetail({
      type: 'PARTIAL',
      items: [
        { productId: 'p-1', variantId: 'v-1', quantity: 2 },
        { productId: 'p-2', variantId: null, quantity: 1 },
      ],
    })
    await expect.element(
      getByText('PARTIAL return covers ALL 3 ordered items — verify this is not a FULL-return mistake.'),
    ).toBeInTheDocument()
  })

  it('FULL return whose items miss some ordered items raises the red missing-items warning', async () => {
    // type FULL but X = 2 < Y = 3.
    const { getByText } = await renderDetail()
    await expect.element(
      getByText('FULL return covers only 2 of 3 — some ordered items are missing.'),
    ).toBeInTheDocument()
  })

  it('courier-sourced return with NO item rows shows the quantities-not-confirmed note (never 0 of 0)', async () => {
    const { getByText, container } = await renderDetail({ source: 'COURIER', items: [] as unknown[] })
    await expect.element(
      getByText('Coverage quantities not confirmed — the courier never reports the split; confirm exact quantities at mark-received.'),
    ).toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain('This return covers')
  })
})

describe('ReturnDetail (customer + line items)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns/ret-1') return Promise.resolve({ data: baseDetail })
      if (url === '/orders/order-1')
        return Promise.resolve({ data: { id: 'order-1', courierConsignmentId: 'CG-1' } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    mockPost.mockResolvedValue({ data: { ok: true } })
  })

  it('renders the customer snapshot: tel: phone, secondary phone, WhatsApp contact action', async () => {
    const { getByText, container } = await renderDetail()
    await expect.element(getByText('Karim Uddin')).toBeInTheDocument()
    const telLinks = container.querySelectorAll('a[href^="tel:"]')
    expect(telLinks.length).toBe(2)
    expect(telLinks[0].getAttribute('href')).toBe('tel:+8801712345678')
    expect(container.querySelectorAll('a[href*="wa.me"]').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the RETURNING line with variant, sku, qty × price and line subtotal', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('Classic Tee')).toBeInTheDocument()
    await expect.element(getByText('Size: M')).toBeInTheDocument()
    await expect.element(getByText('TEE-BLK-M')).toBeInTheDocument()
    await expect.element(getByText('× 2')).toBeInTheDocument()
    await expect.element(getByText('৳600')).toBeInTheDocument()
  })

  it('lists a line that is NOT returning in its own demoted section (no inputs, no money)', async () => {
    const { getByText, getByLabelText, container } = await renderDetail()
    await expect.element(getByText('Not in this return — kept by customer (1)')).toBeInTheDocument()
    await expect.element(getByText('Printed Mug')).toBeInTheDocument()
    await expect.element(getByText('Ordered ×1')).toBeInTheDocument()
    // No "returned 0 of N" noise, no damaged/received inputs for a kept line.
    expect(container.textContent ?? '').not.toContain('returned 0 of')
    expect(container.querySelector('[aria-label="Damaged quantity for Printed Mug"]')).toBeNull()
    expect(container.querySelector('[aria-label="Received quantity for Printed Mug"]')).toBeNull()
    void getByLabelText
  })

  it('renders thumbs through the canonical order-line resolver — non-variant lines keep their product image', async () => {
    const { getByText, container } = await renderDetail()
    await expect.element(getByText('Classic Tee')).toBeInTheDocument()
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs).toContain('/uploads/tee-m.jpg') // variant's own image
    expect(srcs).toContain('/uploads/mug.jpg') // product-image fallback (no variant on the line)
  })

  it('a PARTIAL return keeps the returning line editable and the kept line input-free', async () => {
    const { getByText, container } = await renderDetail({
      type: 'PARTIAL',
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }],
    })
    // Section heads: returning items vs kept-by-customer items.
    await expect.element(getByText('Items in this return (2)')).toBeInTheDocument()
    await expect.element(getByText('Not in this return — kept by customer (1)')).toBeInTheDocument()
    // The returning line keeps its damage input, the kept line has none.
    expect(container.querySelector('[aria-label="Damaged quantity for Classic Tee"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Damaged quantity for Printed Mug"]')).toBeNull()
    // The kept line carries no money math.
    expect(container.textContent ?? '').not.toContain('৳300')
  })

  it('a FULL return renders NO "kept by customer" section', async () => {
    const { getByText, container } = await renderDetail({
      type: 'FULL',
      items: [
        { productId: 'p-1', variantId: 'v-1', quantity: 2 },
        { productId: 'p-2', variantId: null, quantity: 1 },
      ],
    })
    await expect.element(getByText('Items in this return (3)')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain('Not in this return')
  })

  it('the return total sums ONLY the returning lines', async () => {
    const { getByText } = await renderDetail({
      type: 'PARTIAL',
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }],
    })
    // 2 × ৳600 = ৳1200 — the kept ৳300 line is NOT part of the return value.
    await expect.element(getByText('Return value')).toBeInTheDocument()
    await expect.element(getByText('৳1200', { exact: true })).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('৳1500')
  })

  it('the Mark received payload contains the RETURNING lines only', async () => {
    const { getByText, getByLabelText } = await renderDetail({
      type: 'PARTIAL',
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }],
    })
    // A confirmed receive without edits keeps the historical empty body…
    await getByText('Mark received').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/returns/ret-1/mark-received', {})
    })

    // …and a receive WITH damage carries the returning line only.
    mockPost.mockClear()
    await getByLabelText('Damaged quantity for Classic Tee').fill('1')
    await getByText('Mark received').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/returns/ret-1/mark-received', {
        items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2, damagedQuantity: 1 }],
      })
    })
    // The kept line (p-2) is never sent.
    const call = mockPost.mock.calls.find((c: unknown[]) => c[0] === '/returns/ret-1/mark-received')
    expect(JSON.stringify(call)).not.toContain('p-2')
  })

  it('never claims "X of 0" — an order snapshot without line items shows an explicit unavailable note', async () => {
    const { getByText, container } = await renderDetail({ order: { ...orderSnapshot, items: [] } })
    await expect.element(getByText(/Order line items unavailable/i)).toBeInTheDocument()
    expect(container.textContent).not.toContain('of 0 items')
  })
})

describe('ReturnDetail (Task 7 headers/links + actions)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns/ret-1') return Promise.resolve({ data: baseDetail })
      if (url === '/orders/order-1')
        return Promise.resolve({ data: { id: 'order-1', courierConsignmentId: 'CG-1' } })
      return Promise.reject(new Error(`Unexpected URL ${url}`))
    })
    mockPost.mockResolvedValue({ data: { ok: true } })
  })

  it('shows header badges, created date, created-by + all detail links', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('RTN-261014-0001')).toBeInTheDocument()
    await expect.element(getByText('Created by staff@ecomate.com')).toBeInTheDocument()
    await expect.element(getByText(/Oct 2026/)).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0001').first()).toBeInTheDocument()
    await expect.element(getByText('ORD-261014-0002')).toBeInTheDocument()
    await expect.element(getByText('RTN-CG-1')).toBeInTheDocument()
    await expect.element(getByText('changed mind')).toBeInTheDocument()
  })

  it('Check return status posts the consignment id to the reconcile endpoint', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('Check return status')).toBeInTheDocument()
    await getByText('Check return status').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/couriers/steadfast/reconcile-return',
        expect.objectContaining({ consignmentId: 'CG-1' }),
      )
    })
  })

  it('Mark received posts to the mark-received endpoint', async () => {
    const { getByText } = await renderDetail()
    await expect.element(getByText('Mark received')).toBeInTheDocument()
    await getByText('Mark received').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/returns/ret-1/mark-received', {})
    })
  })

  it('unconfirmed courier rows accept per-line received + damaged quantities and send them', async () => {
    const { getByText, getByLabelText } = await renderDetail({ items: [] })
    const received = getByLabelText('Received quantity for Classic Tee')
    const damaged = getByLabelText('Damaged quantity for Classic Tee')
    await expect.element(received).toBeInTheDocument()
    await received.fill('1')
    await damaged.fill('1')
    await getByText('Mark received').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/returns/ret-1/mark-received',
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ productId: 'p-1', variantId: 'v-1', quantity: 1, damagedQuantity: 1 }),
          ]),
        }),
      )
    })
  })

  it('confirmed lines can be marked damaged at receive and are sent with the receipt', async () => {
    const { getByText, getByLabelText } = await renderDetail()
    await getByLabelText('Damaged quantity for Classic Tee').fill('1')
    await getByText('Mark received').click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/returns/ret-1/mark-received', {
        items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2, damagedQuantity: 1 }],
      })
    })
  })

  it('post-receive damage writes off only the remaining good units via mark-damaged', async () => {
    const { getByText, getByLabelText } = await renderDetail({
      status: 'RESTOCKED',
      stockReconciled: true,
      items: [{
        productId: 'p-1', variantId: 'v-1', quantity: 2, damagedQuantity: 1,
        damageLog: [{ qty: 1, at: '2026-10-14T10:00:00Z', phase: 'receive', by: 'staff@ecomate.com' }],
      }],
    })
    await expect.element(getByText('1 restored · 1 damaged (not restocked)')).toBeInTheDocument()
    await getByLabelText('Damage now for Classic Tee').fill('1')
    const buttons = getByText('Mark as damaged')
    await buttons.first().click()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/returns/ret-1/mark-damaged', {
        items: [{ productId: 'p-1', variantId: 'v-1', quantity: 1 }],
      })
    })
  })
})
