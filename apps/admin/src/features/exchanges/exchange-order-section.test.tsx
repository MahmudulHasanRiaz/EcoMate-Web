import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExchangeOrderSection } from './exchange-order-section'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'ex-1' }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: { children?: React.ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={to.replace('$id', params?.id ?? '$id')} {...rest}>{children}</a>
  ),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Deterministic thumbnail assertion: SafeImage's placeholder fallback is
// timing-dependent in the browser test env — mock it to expose the src.
vi.mock('@/components/safe-image', () => ({
  SafeImage: ({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) => (
    <img src={src ?? ''} alt={alt ?? ''} className={className} />
  ),
}))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mockGet, post: vi.fn(), put: vi.fn() } }))

const exchangeOrder = {
  id: 'ex-1',
  displayId: 'ORD-261014-0002',
  kind: 'EXCHANGE',
  exchangeScope: 'PARTIAL',
  exchangeOfOrderId: 'order-1',
  exchangedCreditAmount: '350',
  settlementDelta: '150',
  settlementStatus: 'SETTLED_DUE',
  settlementSettledAt: '2026-10-15T10:00:00Z',
  exchangeOfOrder: {
    id: 'order-1',
    displayId: 'ORD-261014-0001',
    kind: 'ORDER',
    total: 2050,
    items: [
      {
        productId: 'p-1',
        variantId: 'v-1',
        quantity: 2,
        price: 600,
        product: { id: 'p-1', name: 'Blue Tee', sku: 'T-BLUE', images: ['/uploads/tee.jpg'] },
        variant: { id: 'v-1', sku: 'T-BLUE-M', image: '/uploads/tee-m.jpg', images: ['/uploads/tee-m.jpg'] },
      },
    ],
  },
  items: [
    {
      productId: 'p-9',
      variantId: null,
      quantity: 2,
      price: 500,
      product: { id: 'p-9', name: 'Red Hoodie', sku: 'HOOD-RED', images: ['/uploads/hood.jpg'] },
    },
  ],
  payments: [
    { id: 'pay-1', sourceOrderId: 'order-1', sourcePaymentId: 'pay-src-1', status: 'verified', amount: 350 },
  ],
}

function renderSection(overrides: Record<string, unknown> = {}) {
  const order = { ...exchangeOrder, ...overrides }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ExchangeOrderSection order={order} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGet.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/returns'))
      return Promise.resolve({
        data: {
          data: [{ id: 'ret-9', displayId: 'RTN-261014-0009', status: 'REQUESTED', items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2 }] }],
        },
      })
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
})

describe('ExchangeOrderSection', () => {
  it('renders the exchange type chip, original-order link and linked return row', async () => {
    const { getByText, container } = await renderSection()
    await expect.element(getByText('PARTIAL')).toBeInTheDocument()
    await expect.element(getByText('Original order')).toBeInTheDocument()
    await expect.element(getByText('Linked return')).toBeInTheDocument()
    await expect.element(getByText('RTN-261014-0009')).toBeInTheDocument()
    const orig = container.querySelector('a[href="/op/orders/order-1"]')
    expect(orig).not.toBeNull()
  })

  it('lists OLD goods (original order lines) and NEW goods (exchange lines) with qty', async () => {
    const { getByText } = await renderSection()
    await expect.element(getByText('Blue Tee')).toBeInTheDocument()
    await expect.element(getByText('Red Hoodie')).toBeInTheDocument()
    await expect.element(getByText('× 2 · ৳600')).toBeInTheDocument()
    await expect.element(getByText('× 2 · ৳500')).toBeInTheDocument()
  })

  it('renders thumbs through the canonical order-line resolver — non-variant lines keep their product image', async () => {
    const { container } = await renderSection()
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs).toContain('/uploads/tee-m.jpg') // original line variant image
    expect(srcs).toContain('/uploads/hood.jpg') // exchange line product-image fallback
  })

  it('renders billing rows: credit consumed, collect-on-delivery delta, settled date', async () => {
    const { getByText } = await renderSection()
    await expect.element(getByText('Credit consumed')).toBeInTheDocument()
    await expect.element(getByText('৳350')).toBeInTheDocument()
    await expect.element(getByText('Collect on delivery')).toBeInTheDocument()
    await expect.element(getByText('+৳150')).toBeInTheDocument()
    await expect.element(getByText('Settled due')).toBeInTheDocument()
    await expect.element(getByText(/15 Oct 2026/)).toBeInTheDocument()
  })

  it('links the first source payment to the original order detail', async () => {
    const { container } = await renderSection()
    const [origLink, sourceLink] = [...container.querySelectorAll('a[href="/op/orders/order-1"]')]
    expect(origLink).toBeDefined()
    expect(origLink?.textContent).toContain('ORD-261014-0001')
    expect(sourceLink).toBeDefined()
    expect(sourceLink?.textContent).toContain('Source payment')
    expect(sourceLink?.textContent).toContain('ORD-261014-0001')
  })

  it('derives Full/Partial from the linked return when exchangeScope is unknown', async () => {
    const { getByText } = await renderSection({ exchangeScope: null })
    await expect.element(getByText('FULL')).toBeInTheDocument()
  })

  it('renders nothing for a plain ORDER (zero delta for normal orders)', async () => {
    const { container } = await renderSection({ kind: 'ORDER' })
    expect(container.children.length).toBe(0)
  })
})
