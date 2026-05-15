import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException, BadRequestException } from '@nestjs/common'
import { OrdersService } from './orders.service'
import { PrismaService } from '../prisma/prisma.service'

describe('OrdersService', () => {
  let service: OrdersService
  let prisma: PrismaService

  const mockInitialStatus = { id: 'status-pending', name: 'Pending', isInitial: true, nextStatuses: ['status-processing'] }
  const mockProcessingStatus = { id: 'status-processing', name: 'Processing', isInitial: false, nextStatuses: ['status-shipped'] }
  const mockShippedStatus = { id: 'status-shipped', name: 'Shipped', isInitial: false, nextStatuses: [] }

  const mockOrder = {
    id: 'order-id-1',
    displayId: 'ORD-250115-0001',
    customerId: 'customer-id-1',
    statusId: 'status-pending',
    subtotal: 2000,
    shippingCharge: 100,
    discount: 50,
    discountType: 'flat',
    total: 2050,
    shippingAddress: { address: '123 Test St', city: 'Test City' },
    customerNotes: null,
    officeNotes: null,
    timeline: [{ status: 'Pending', timestamp: new Date().toISOString(), note: 'Order created' }],
    createdAt: new Date('2025-01-15'),
    updatedAt: new Date('2025-01-15'),
    status: mockInitialStatus,
    customer: { id: 'customer-id-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', phoneNumber: '+1234567890' },
    items: [
      {
        id: 'item-id-1',
        orderId: 'order-id-1',
        productId: 'prod-1',
        variantId: 'variant-1',
        quantity: 2,
        price: 1000,
        product: { id: 'prod-1', name: 'Test Product', slug: 'test-product', images: ['img1.jpg'] },
      },
    ],
    payments: [],
    shipment: null,
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: {
            order: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            orderStatus: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
            },
            orderItem: {
              deleteMany: jest.fn(),
              createMany: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
            },
            productVariant: {
              update: jest.fn(),
            },
            inventoryLog: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile()

    service = module.get<OrdersService>(OrdersService)
    prisma = module.get<PrismaService>(PrismaService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('findAll', () => {
    it('should return paginated orders', async () => {
      ;(prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder])
      ;(prisma.order.count as jest.Mock).mockResolvedValue(1)

      const result = await service.findAll({ page: 1, perPage: 10 })

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      )
      expect(prisma.order.count).toHaveBeenCalled()
      expect(result.data).toHaveLength(1)
      expect(result.meta).toEqual({ total: 1, page: 1, perPage: 10, totalPages: 1 })
    })

    it('should filter by search and statusId', async () => {
      ;(prisma.order.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.order.count as jest.Mock).mockResolvedValue(0)

      await service.findAll({ search: 'ORD-25', statusId: 'status-pending', page: 1, perPage: 10 })

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            displayId: { contains: 'ORD-25', mode: 'insensitive' },
            statusId: 'status-pending',
          },
        }),
      )
    })

    it('should use default pagination values when not provided', async () => {
      ;(prisma.order.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.order.count as jest.Mock).mockResolvedValue(0)

      await service.findAll({})

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      )
    })

    it('should handle custom sort and order', async () => {
      ;(prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder])
      ;(prisma.order.count as jest.Mock).mockResolvedValue(1)

      await service.findAll({ sort: 'total', order: 'asc' })

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { total: 'asc' } }),
      )
    })
  })

  describe('findOne', () => {
    it('should return an order by id', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)

      const result = await service.findOne('order-id-1')

      expect(prisma.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-id-1' } }),
      )
      expect(result).toEqual(mockOrder)
    })

    it('should throw NotFoundException if order not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException)
    })
  })

  describe('create', () => {
    const createOrderDto = {
      customerId: 'customer-id-1',
      items: [
        { productId: 'prod-1', variantId: 'variant-1', quantity: 2, price: 1000 },
        { productId: 'prod-2', quantity: 1, price: 500 },
      ],
      shippingCharge: 100,
      discount: 50,
      discountType: 'flat' as const,
      shippingAddress: { address: '123 Test St' },
      customerNotes: 'Please deliver fast',
    }

    it('should create an order successfully', async () => {
      ;(prisma.order.findFirst as jest.Mock).mockResolvedValue(null)
      ;(prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(mockInitialStatus)
      ;(prisma.order.create as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.productVariant.update as jest.Mock).mockResolvedValue({ id: 'variant-1', stock: 8 })

      const result = await service.create(createOrderDto)

      expect(prisma.orderStatus.findFirst).toHaveBeenCalledWith({ where: { isInitial: true } })
      expect(prisma.order.create).toHaveBeenCalled()
      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-1' },
        data: { stock: { decrement: 2 } },
      })
      expect(result).toEqual(mockOrder)
    })

    it('should throw BadRequestException if no initial status configured', async () => {
      ;(prisma.order.findFirst as jest.Mock).mockResolvedValue(null)
      ;(prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(null)

      await expect(service.create(createOrderDto)).rejects.toThrow(BadRequestException)
    })

    it('should generate sequential display IDs', async () => {
      ;(prisma.order.findFirst as jest.Mock).mockResolvedValue({ displayId: 'ORD-250115-0005' })
      ;(prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(mockInitialStatus)
      ;(prisma.order.create as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.productVariant.update as jest.Mock).mockResolvedValue({})

      await service.create(createOrderDto)

      const createCall = (prisma.order.create as jest.Mock).mock.calls[0][0]
      expect(createCall.data.displayId).toMatch(/^ORD-\d{6}-0006$/)
    })

    it('should not decrement variant stock if no variantId', async () => {
      const dtoWithoutVariant = {
        ...createOrderDto,
        items: [{ productId: 'prod-2', quantity: 1, price: 500 }],
      }

      ;(prisma.order.findFirst as jest.Mock).mockResolvedValue(null)
      ;(prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(mockInitialStatus)
      ;(prisma.order.create as jest.Mock).mockResolvedValue(mockOrder)

      await service.create(dtoWithoutVariant)

      expect(prisma.productVariant.update).not.toHaveBeenCalled()
    })
  })

  describe('updateStatus', () => {
    const updateStatusDto = { statusId: 'status-processing', note: 'Processing order' }
    const userId = 'admin-user-id'

    it('should update order status successfully', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(mockProcessingStatus)
      ;(prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-processing',
        status: mockProcessingStatus,
      })

      const result = await service.updateStatus('order-id-1', updateStatusDto, userId)

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-id-1' },
        include: { status: true },
      })
      expect(prisma.orderStatus.findUnique).toHaveBeenCalledWith({ where: { id: 'status-processing' } })
      expect(prisma.order.update).toHaveBeenCalled()
      expect(result.statusId).toBe('status-processing')
    })

    it('should throw NotFoundException if order not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.updateStatus('nonexistent-id', updateStatusDto, userId)).rejects.toThrow(NotFoundException)
    })

    it('should throw NotFoundException if status not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.updateStatus('order-id-1', updateStatusDto, userId)).rejects.toThrow(NotFoundException)
    })

    it('should throw BadRequestException for invalid status transition', async () => {
      const invalidStatusDto = { statusId: 'status-shipped' }

      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(mockShippedStatus)

      await expect(service.updateStatus('order-id-1', invalidStatusDto, userId)).rejects.toThrow(BadRequestException)
    })
  })

  describe('updateOrder', () => {
    const updateOrderDto = {
      shippingCharge: 150,
      discount: 100,
      customerNotes: 'Updated notes',
    }

    it('should update an order successfully', async () => {
      const existingOrder = {
        ...mockOrder,
        shippingCharge: 100,
        discount: 50,
      }

      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder)
      ;(prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        shippingCharge: 150,
        discount: 100,
        subtotal: 2000,
        total: 2050,
      })

      const result = await service.updateOrder('order-id-1', updateOrderDto)

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-id-1' },
        include: { items: { include: { product: { select: { id: true, name: true } } } } },
      })
      expect(prisma.order.update).toHaveBeenCalled()
      expect(result.shippingCharge).toBe(150)
    })

    it('should throw NotFoundException if order not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.updateOrder('nonexistent-id', updateOrderDto)).rejects.toThrow(NotFoundException)
    })

    it('should replace items when items are provided', async () => {
      const dtoWithItems = {
        items: [{ productId: 'prod-3', quantity: 3, price: 800 }],
      }

      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 }

      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder)
      ;(prisma.orderItem.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })
      ;(prisma.orderItem.createMany as jest.Mock).mockResolvedValue({ count: 1 })
      ;(prisma.order.update as jest.Mock).mockResolvedValue(mockOrder)

      await service.updateOrder('order-id-1', dtoWithItems)

      expect(prisma.orderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: 'order-id-1' } })
      expect(prisma.orderItem.createMany).toHaveBeenCalled()
    })
  })

  describe('addNote', () => {
    it('should add a note to order timeline', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.order.update as jest.Mock).mockResolvedValue(mockOrder)

      await service.addNote('order-id-1', 'Test note', 'public', 'user-id-1')

      expect(prisma.order.update).toHaveBeenCalled()
      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0]
      expect(updateCall.data.timeline).toHaveLength(2)
      expect(updateCall.data.timeline[1].note).toBe('Test note')
    })

    it('should throw NotFoundException if order not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.addNote('nonexistent-id', 'Note', 'public', 'user-id-1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('addItem', () => {
    it('should add an item to order and recalculate', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.orderItem.create as jest.Mock).mockResolvedValue({ id: 'new-item', productId: 'prod-2', quantity: 1, price: 500 })
      ;(prisma.order.update as jest.Mock).mockResolvedValue(mockOrder)

      await service.addItem('order-id-1', { productId: 'prod-2', quantity: 1, price: 500 })

      expect(prisma.orderItem.create).toHaveBeenCalled()
      expect(prisma.order.update).toHaveBeenCalled()
    })

    it('should throw NotFoundException if order not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.addItem('nonexistent-id', { productId: 'prod-2', quantity: 1, price: 500 })).rejects.toThrow(NotFoundException)
    })
  })

  describe('removeItem', () => {
    it('should remove an item from order and recalculate', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder)
      ;(prisma.orderItem.delete as jest.Mock).mockResolvedValue({ id: 'item-id-1' })
      ;(prisma.order.update as jest.Mock).mockResolvedValue(mockOrder)

      await service.removeItem('order-id-1', 'item-id-1')

      expect(prisma.orderItem.delete).toHaveBeenCalledWith({ where: { id: 'item-id-1' } })
      expect(prisma.order.update).toHaveBeenCalled()
    })

    it('should throw NotFoundException if order not found', async () => {
      ;(prisma.order.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.removeItem('nonexistent-id', 'item-id-1')).rejects.toThrow(NotFoundException)
    })
  })
})
