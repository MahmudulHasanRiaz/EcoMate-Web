import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { StickerTemplate, getCourierInfo } from '../sticker-template'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mockGet,
  },
}))

describe('getCourierInfo', () => {
  it('identifies not dispatched when no consignment/tracking exists', () => {
    const order = { id: 'ord-1' }
    const info = getCourierInfo(order)
    expect(info.isDispatched).toBe(false)
    expect(info.barcodeValue).toBe('')
    expect(info.title).toBe('CONSIGNMENT NO.')
  })

  it('resolves Steadfast consignment ID and title', () => {
    const order = {
      id: 'ord-1',
      courierService: 'steadfast',
      courierConsignmentId: 'CN-784512963',
    }
    const info = getCourierInfo(order)
    expect(info.isDispatched).toBe(true)
    expect(info.courierName).toBe('Steadfast')
    expect(info.title).toBe('STEADFAST CONSIGNMENT NO.')
    expect(info.barcodeValue).toBe('CN-784512963')
  })

  it('resolves Pathao parcel ID from dispatches array', () => {
    const order = {
      id: 'ord-1',
      dispatches: [
        {
          courier: 'pathao',
          consignmentId: 'PT-998877',
        },
      ],
    }
    const info = getCourierInfo(order)
    expect(info.isDispatched).toBe(true)
    expect(info.courierName).toBe('Pathao')
    expect(info.title).toBe('PATHAO PARCEL ID')
    expect(info.barcodeValue).toBe('PT-998877')
  })

  it('resolves Carrybee parcel ID and title', () => {
    const order = {
      id: 'ord-1',
      courierService: 'carrybee',
      courierConsignmentId: 'CB-112233',
    }
    const info = getCourierInfo(order)
    expect(info.isDispatched).toBe(true)
    expect(info.courierName).toBe('Carrybee')
    expect(info.title).toBe('CARRYBEE PARCEL ID')
    expect(info.barcodeValue).toBe('CB-112233')
  })

  it('resolves RedX parcel ID and title', () => {
    const order = {
      id: 'ord-1',
      courierService: 'redx',
      courierTrackingCode: 'REDX-554433',
    }
    const info = getCourierInfo(order)
    expect(info.isDispatched).toBe(true)
    expect(info.courierName).toBe('RedX')
    expect(info.title).toBe('REDX PARCEL ID')
    expect(info.barcodeValue).toBe('REDX-554433')
  })
})

describe('StickerTemplate Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({
      data: {
        store: { name: 'FIXED PLUS', phone: '+8801516774099' },
        branding: { storeLogo: '', storefrontFavicon: '' },
        systems: [{ display: 'name' }],
        currency: { symbol: '৳' },
      },
    })
  })

  const sampleOrder = {
    id: 'ord-123',
    displayId: 'ORD-260930-0004',
    createdAt: '2026-09-30T10:00:00.000Z',
    customerFirstName: 'Durjoy',
    customerPhone: '+8801740968302',
    shippingAddress: {
      address: 'Nouga jala, mohadavpur thana ,mataji hat',
    },
    courierService: 'steadfast',
    courierConsignmentId: 'CN-784512963',
    subtotal: 4880,
    shippingCharge: 130,
    total: 5010,
    payments: [],
    items: [
      {
        id: 'item-1',
        quantity: 1,
        price: 890,
        product: { name: 'Low Cut Baggy', sku: 'LCB-103' },
        variant: {
          sku: 'LCB-103',
          attributeValues: [
            { attributeValue: { value: 'Light Grey' } },
          ],
        },
      },
      {
        id: 'item-2',
        quantity: 2,
        price: 450,
        product: { name: 'Premium Cotton T-Shirt' },
        variant: {
          sku: 'TS-201',
          attributeValues: [
            { attributeValue: { value: 'Black' } },
          ],
        },
      },
    ],
  }

  async function renderSticker(order: any = sampleOrder) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <StickerTemplate order={order} />
      </QueryClientProvider>
    )
  }

  it('renders order display ID, QR code, customer info, and date', async () => {
    const { getByText } = await renderSticker()

    await expect.element(getByText('ORD-260930-0004')).toBeInTheDocument()
    await expect.element(getByText('Durjoy')).toBeInTheDocument()
    await expect.element(getByText('+8801740968302')).toBeInTheDocument()
    await expect.element(getByText('Nouga jala, mohadavpur thana ,mataji hat')).toBeInTheDocument()
    await expect.element(getByText('30/09/2026')).toBeInTheDocument()
    await expect.element(getByText(/Scan to view/i)).toBeInTheDocument()
  })

  it('renders courier title and consignment barcode value when dispatched', async () => {
    const { getByText } = await renderSticker()

    await expect.element(getByText('STEADFAST CONSIGNMENT NO.')).toBeInTheDocument()
    await expect.element(getByText('CN-784512963')).toBeInTheDocument()
  })

  it('renders "Not yet dispatched to courier" when order is not dispatched', async () => {
    const undispatchedOrder = {
      ...sampleOrder,
      courierService: null,
      courierConsignmentId: null,
      courierTrackingCode: null,
      dispatches: [],
    }
    const { getByText } = await renderSticker(undispatchedOrder)

    await expect.element(getByText('Not yet dispatched to courier')).toBeInTheDocument()
  })

  it('renders products table with variant attributes in brackets, quantity, and amounts', async () => {
    const { getByText } = await renderSticker()

    await expect.element(getByText('Low Cut Baggy')).toBeInTheDocument()
    await expect.element(getByText('(Light Grey)')).toBeInTheDocument()
    await expect.element(getByText('Premium Cotton T-Shirt')).toBeInTheDocument()
    await expect.element(getByText('(Black)')).toBeInTheDocument()
    await expect.element(getByText('×1')).toBeInTheDocument()
    await expect.element(getByText('×2')).toBeInTheDocument()
    await expect.element(getByText('৳890').first()).toBeInTheDocument()
    await expect.element(getByText('৳900')).toBeInTheDocument()
  })

  it('renders long product titles with separate base name and preserved variant badge at the end', async () => {
    const longTitleOrder = {
      ...sampleOrder,
      items: [
        {
          id: 'item-long',
          quantity: 1,
          price: 1200,
          product: { name: 'Super Ultra Long Combed Organic Cotton Oversized Heavyweight Drop Shoulder T-Shirt' },
          variant: {
            sku: 'TS-LONG-BLK-L',
            attributeValues: [
              { attributeValue: { value: 'Black' } },
              { attributeValue: { value: 'L' } },
            ],
          },
        },
      ],
    }
    const { getByText } = await renderSticker(longTitleOrder)

    await expect.element(getByText('Super Ultra Long Combed Organic Cotton Oversized Heavyweight Drop Shoulder T-Shirt')).toBeInTheDocument()
    await expect.element(getByText('(Black, L)')).toBeInTheDocument()
  })

  it('renders bottom bill summary with COD as due amount, paid amount, shipping, and total', async () => {
    // Partially paid order: total 5010, paid 1000 => COD = 4010
    const partialOrder = {
      ...sampleOrder,
      payments: [
        { id: 'p1', amount: 1000, status: 'PAID' },
      ],
    }
    const { getByText } = await renderSticker(partialOrder)

    await expect.element(getByText('COD')).toBeInTheDocument()
    await expect.element(getByText('৳4,010')).toBeInTheDocument()
    await expect.element(getByText('PAID AMOUNT')).toBeInTheDocument()
    await expect.element(getByText('৳1,000')).toBeInTheDocument()
    await expect.element(getByText('DELIVERY CHARGE')).toBeInTheDocument()
    await expect.element(getByText('৳130')).toBeInTheDocument()
    await expect.element(getByText('TOTAL AMOUNT')).toBeInTheDocument()
    await expect.element(getByText('৳5,010')).toBeInTheDocument()
  })

  it('renders exact 8-item order from reference design and takes screenshot', async () => {
    const fullOrder = {
      id: 'ord-exact',
      displayId: 'ORD-260930-0004',
      createdAt: '2026-09-30T06:00:00.000Z',
      customerFirstName: 'Durjoy',
      customerPhone: '+8801740968302',
      shippingAddress: {
        address: 'Nouga jala, mohadavpur thana ,mataji hat',
      },
      courierService: 'steadfast',
      courierConsignmentId: 'CN-784512963',
      subtotal: 4880,
      shippingCharge: 130,
      total: 5010,
      payments: [],
      items: [
        {
          id: '1',
          quantity: 1,
          price: 890,
          product: { name: 'Low Cut Baggy', sku: 'LCB-103' },
          variant: { sku: 'LCB-103', attributeValues: [{ attributeValue: { value: 'Light Grey' } }] },
        },
        {
          id: '2',
          quantity: 2,
          price: 450,
          product: { name: 'Premium Cotton T-Shirt', sku: 'TS-201' },
          variant: { sku: 'TS-201', attributeValues: [{ attributeValue: { value: 'Black' } }] },
        },
        {
          id: '3',
          quantity: 1,
          price: 1150,
          product: { name: 'Men’s Cargo Pant', sku: 'CP-305' },
          variant: { sku: 'CP-305', attributeValues: [{ attributeValue: { value: 'Beige' } }] },
        },
        {
          id: '4',
          quantity: 1,
          price: 120,
          product: { name: 'Cotton Socks', sku: 'SK-001' },
          variant: { sku: 'SK-001', attributeValues: [{ attributeValue: { value: 'White' } }] },
        },
        {
          id: '5',
          quantity: 1,
          price: 1350,
          product: { name: 'Hoodie Jacket', sku: 'HJ-404' },
          variant: { sku: 'HJ-404', attributeValues: [{ attributeValue: { value: 'Navy Blue' } }] },
        },
        {
          id: '6',
          quantity: 1,
          price: 250,
          product: { name: 'Cap', sku: 'CP-101' },
          variant: { sku: 'CP-101', attributeValues: [{ attributeValue: { value: 'Black' } }] },
        },
        {
          id: '7',
          quantity: 1,
          price: 350,
          product: { name: 'Belt', sku: 'BL-210' },
          variant: { sku: 'BL-210', attributeValues: [{ attributeValue: { value: 'Brown' } }] },
        },
        {
          id: '8',
          quantity: 1,
          price: 490,
          product: { name: 'Wallet', sku: 'WL-002' },
          variant: { sku: 'WL-002', attributeValues: [{ attributeValue: { value: 'Tan' } }] },
        },
      ],
    }

    const { getByText } = await renderSticker(fullOrder)

    await expect.element(getByText('ORD-260930-0004')).toBeInTheDocument()
    await expect.element(getByText('STEADFAST CONSIGNMENT NO.')).toBeInTheDocument()
    await expect.element(getByText('CN-784512963')).toBeInTheDocument()
    await expect.element(getByText('COD')).toBeInTheDocument()
    await expect.element(getByText('৳5,010').first()).toBeInTheDocument()
  })
})
