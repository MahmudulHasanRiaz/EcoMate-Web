import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LinkedReturnsSection } from './linked-returns-section'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
// SafeImage falls back to a placeholder once the (test-env) 404 fires — mock
// it so the assertion sees exactly the src the section resolved.
vi.mock('@/components/safe-image', () => ({
  SafeImage: ({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) => (
    <img src={src ?? ''} alt={alt ?? ''} className={className} />
  ),
}))

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a onClick={() => mockNavigate()}>{children}</a>,
}))

const orderItems = [
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
      attributeValues: [{ attributeValue: { value: 'M', hexCode: null, attribute: { name: 'Size' } } }],
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
]

const returnsRows = [
  {
    id: 'ret-1',
    displayId: 'RTN-261001-0001',
    orderId: 'order-1',
    type: 'PARTIAL',
    status: 'RESTOCKED',
    source: 'STAFF',
    items: [
      { productId: 'p-1', variantId: 'v-1', quantity: 2, damagedQuantity: 1 },
      { productId: 'p-2', variantId: null, quantity: 1 },
    ],
    receivedAt: '2026-10-21T10:30:00Z',
    receivedBy: { id: 'staff-1', firstName: 'Karim', lastName: 'Uddin', email: 'karim@ecomate.com' },
    order: { id: 'order-1', displayId: 'ORD-1', items: orderItems },
    createdAt: '',
    updatedAt: '',
  },
  { id: 'ret-2', displayId: 'RTN-261001-0002', orderId: 'order-1', type: 'FULL', status: 'CLOSED', source: 'STAFF', items: [], createdAt: '', updatedAt: '' },
]
const readiness = {
  orderId: 'order-1',
  linked: true,
  exchanges: [
    {
      id: 'ex-1',
      displayId: 'ORD-261001-0099',
      delivered: true,
      items: [
        {
          productId: 'p-3',
          variantId: null,
          quantity: 1,
          price: 450,
          productName: 'Replacement Cap',
          productSku: 'CAP-1',
          productImages: ['/uploads/cap.jpg'],
          variantSku: null,
          variantImage: null,
          variantImages: [],
          variantAttributes: [],
        },
      ],
    },
  ],
  returns: [],
  exchangeDelivered: true,
  returnArrived: false,
  canConfirmReturned: false,
  blockReason: null,
}

async function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LinkedReturnsSection orderId='order-1' />
    </QueryClientProvider>,
  )
}

describe('LinkedReturnsSection', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') return Promise.resolve({ data: { data: returnsRows, meta: { total: 2, page: 1, limit: 100 } } })
      if (url.startsWith('/exchange/readiness/')) return Promise.resolve({ data: readiness })
      return Promise.resolve({ data: {} })
    })
  })

  it('lists RTN rows with type, status and link', async () => {
    const page = await renderSection()
    expect(page.getByText('Linked returns & exchanges', { exact: false })).not.toBeNull()
    expect(page.getByText('RTN-261001-0001', { exact: true })).not.toBeNull()
    expect(page.getByText('PARTIAL', { exact: true })).not.toBeNull()
    expect(page.getByText('REQUESTED', { exact: true })).not.toBeNull()
    // Closed history stays visible too.
    expect(page.getByText('RTN-261001-0002', { exact: true })).not.toBeNull()
  })

  it('lists linked exchanges with delivery state and link', async () => {
    const page = await renderSection()
    expect(page.getByText('ORD-261001-0099', { exact: true })).not.toBeNull()
    expect(page.getByText(/delivered/i)).not.toBeNull()
  })

  it('renders the RETURN\'s product lines (image, name, variant, SKU, qty) with a damaged marker', async () => {
    const page = await renderSection()
    await expect.element(page.getByText('Classic Tee', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('TEE-BLK-M', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Printed Mug', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('damaged', { exact: true })).toBeInTheDocument()
    // The product image rides along.
    const srcs = Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs).toContain('/uploads/tee-m.jpg')
    expect(srcs).toContain('/uploads/mug.jpg')
  })

  it('shows the LIVE status and the "Received by" log of a received return', async () => {
    const page = await renderSection()
    await expect.element(page.getByText('RESTOCKED', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText(/Received by Karim Uddin/)).toBeInTheDocument()
  })

  it('shows the exchange order\'s product lines', async () => {
    const page = await renderSection()
    await expect.element(page.getByText('Replacement Cap', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('CAP-1', { exact: true })).toBeInTheDocument()
  })

  it('shows an empty state when nothing is linked', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/returns') return Promise.resolve({ data: { data: [], meta: { total: 0, page: 1, limit: 100 } } })
      if (url.startsWith('/exchange/readiness/')) {
        return Promise.resolve({ data: { ...readiness, linked: false, exchanges: [] } })
      }
      return Promise.resolve({ data: {} })
    })
    const page = await renderSection()
    expect(page.getByText(/no linked returns or exchanges/i)).not.toBeNull()
  })
})
