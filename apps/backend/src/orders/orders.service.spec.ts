import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersEventService } from './orders-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingCaptureService } from '../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../tracking/tracking-settings.service';
import { CustomersService } from '../customers/customers.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { SecurityService } from '../security/security.service';
import { CouponsService } from '../coupons/coupons.service';
import { ManagedStockLedgerService } from '../inventory/managed-stock-ledger.service';
import { CostingLotService } from '../stock/costing-lot.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { OrderEditLockService } from './order-edit-lock.service';
import { CommissionsService } from '../commissions/commissions.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;
  let blockedEntries: BlockedEntriesService;
  let customers: CustomersService;
  let editLock: OrderEditLockService;
  let module: TestingModule;

  const mockInitialStatus = {
    id: 'status-pending',
    name: 'Pending',
    isInitial: true,
    nextStatuses: ['status-processing'],
  };
  const mockConfirmedStatus = {
    id: 'status-confirmed',
    name: 'Confirmed',
    isInitial: false,
    nextStatuses: [],
  };
  const mockShippedStatus = {
    id: 'status-shipped',
    name: 'Shipped',
    isInitial: false,
    nextStatuses: [],
  };

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
    viewToken: 'mock-view-token',
    shippingAddress: { address: '123 Test St', city: 'Test City', zone: '' },
    customerNotes: null,
    officeNotes: null,
    timeline: [
      {
        status: 'Pending',
        timestamp: new Date().toISOString(),
        note: 'Order created',
      },
    ],
    createdAt: new Date('2025-01-15'),
    updatedAt: new Date('2025-01-15'),
    editLock: null,
    trackingUrl: null,
    status: mockInitialStatus,
    customer: {
      id: 'customer-id-1',
      name: 'John Doe',
      firstName: 'John Doe',
      lastName: '',
      email: 'john@example.com',
      phone: '+1234567890',
      phoneNumber: '+1234567890',
    },
    items: [
      {
        id: 'item-id-1',
        orderId: 'order-id-1',
        productId: 'prod-1',
        variantId: 'variant-1',
        quantity: 2,
        price: 1000,
        product: {
          id: 'prod-1',
          name: 'Test Product',
          slug: 'test-product',
          images: ['img1.jpg'],
        },
      },
    ],
    payments: [],
    shipment: null,
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            order: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              count: jest.fn(),
              groupBy: jest.fn().mockResolvedValue([]),
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
              update: jest.fn().mockResolvedValue({}),
              findMany: jest.fn().mockResolvedValue([]),
            },
            physicalReservation: {
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            orderCounter: {
              upsert: jest.fn(),
            },
            productVariant: {
              findMany: jest.fn().mockResolvedValue([
                {
                  id: 'variant-1',
                  price: 1000,
                  isActive: true,
                  productId: 'prod-1',
                  managedStockQuantity: 10,
                  reservedStock: 0,
                },
              ]),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            product: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'prod-1',
                basePrice: 1000,
                salePrice: null,
                isActive: true,
                availabilityMode: 'MANAGED_STOCK',
                warehouseId: 'wh-1',
              }),
              findMany: jest.fn().mockImplementation(async (args) => {
                if (args?.where?.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
                  return [];
                }
                return [
                  {
                    id: 'prod-1',
                    basePrice: 1000,
                    salePrice: null,
                    isActive: true,
                    availabilityMode: 'MANAGED_STOCK',
                    name: 'Prod 1',
                    type: 'variable',
                    managedStockQuantity: 25,
                    reservedStock: 0,
                  },
                  {
                    id: 'prod-2',
                    basePrice: 500,
                    salePrice: null,
                    isActive: true,
                    availabilityMode: 'MANAGED_STOCK',
                    name: 'Prod 2',
                    type: 'simple',
                    managedStockQuantity: 25,
                    reservedStock: 0,
                  },
                ];
              }),
            },
            combo: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            coupon: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            payment: {
              create: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
            },
            customerProfile: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              upsert: jest.fn().mockResolvedValue({ id: 'customer-id-1' }),
              update: jest.fn().mockResolvedValue({ id: 'customer-id-1' }),
            },
            customer: {
              update: jest.fn().mockResolvedValue({ id: 'customer-id-1' }),
            },
            checkoutLead: {
              updateMany: jest.fn(),
            },
            systemSetting: {
              findMany: jest.fn().mockResolvedValue([]),
              findUnique: jest.fn().mockResolvedValue(null),
            },
            user: {
              findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
            },
            inventoryLog: {
              create: jest.fn(),
            },
            costingLotRestoration: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
            orderStockCycle: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({ id: 'cycle-1' }),
            },
            userProfile: {
              findUnique: jest.fn().mockResolvedValue({ status: 'active' }),
              findFirst: jest.fn().mockResolvedValue({ status: 'active' }),
            },
          },
        },
        {
          provide: OrdersEventService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: TrackingCaptureService,
          useValue: {
            capture: jest
              .fn()
              .mockResolvedValue({ status: 'CAPTURED', snapshotId: 'snap-1' }),
          },
        },
        {
          provide: TrackingSettingsService,
          useValue: {
            buildConfigSnapshot: jest.fn().mockResolvedValue({
              enabledProviders: ['meta'],
              normalizerVersion: 1,
              capturedAt: '2025-01-15T00:00:00.000Z',
            }),
            get: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: OrderEditLockService,
          useValue: {
            getLock: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CustomersService,
          useValue: {
            isPhoneBlocked: jest.fn().mockResolvedValue(false),
            findOrCreateCustomer: jest
              .fn()
              .mockResolvedValue({ id: 'customer-id-1' }),
          },
        },
        {
          provide: StockService,
          useValue: {
            reserve: jest.fn().mockResolvedValue(undefined),
            release: jest.fn().mockResolvedValue(undefined),
            deduct: jest.fn().mockResolvedValue(undefined),
            add: jest.fn().mockResolvedValue(undefined),
            scrap: jest.fn().mockResolvedValue(undefined),
            operate: jest.fn().mockResolvedValue(undefined),
            getAvailableStock: jest
              .fn()
              .mockResolvedValue({ stock: 10, reserved: 0, available: 10 }),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(true),
            resolve: jest.fn().mockReturnValue({
              ms: 'reserve',
              pi: 'skip',
            }),
          },
        },
        {
          provide: BlockedEntriesService,
          useValue: {
            findOrderBlockedIp: jest.fn().mockResolvedValue(null),
            findBlockedPhone: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CouponsService,
          useValue: {
            validate: jest.fn().mockResolvedValue({
              valid: true,
              coupon: { type: 'flat', value: 50, minOrderValue: null },
            }),
            apply: jest.fn().mockResolvedValue({ success: true, discount: 50 }),
          },
        },
        {
          provide: SecurityService,
          useValue: {
            recordOrder: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ManagedStockLedgerService,
          useValue: {
            record: jest.fn().mockResolvedValue({}),
            hasExistingRestock: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: CostingLotService,
          useValue: {
            restoreForReturn: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CancelReturnStockService,
          useValue: {
            restoreForOrder: jest.fn().mockResolvedValue(undefined),
            holdReservationForReturnPending: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: OrderStockDeductService,
          useValue: {
            deductForOrder: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CommissionsService,
          useValue: {
            processOrderCommissions: jest.fn().mockResolvedValue(0),
            reverseForOrder: jest
              .fn()
              .mockResolvedValue({ reversed: 0, already: 0 }),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    blockedEntries = module.get<BlockedEntriesService>(BlockedEntriesService);
    customers = module.get<CustomersService>(CustomersService);
    editLock = module.get<OrderEditLockService>(OrderEditLockService);

    // Set up default implementation for $transaction to pass the prisma mock
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb) =>
      cb(prisma),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated orders', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      (prisma.order.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(prisma.order.count).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        perPage: 10,
        totalPages: 1,
        statusCounts: {},
      });
    });

    it('should filter by search and statusId', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({
        search: 'ORD-25',
        statusId: 'status-pending',
        page: 1,
        perPage: 10,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { displayId: { contains: 'ORD-25', mode: 'insensitive' } },
              {
                customer: {
                  name: { contains: 'ORD-25', mode: 'insensitive' },
                },
              },
              { customer: { phone: { contains: 'ORD-25' } } },
              { guestName: { contains: 'ORD-25', mode: 'insensitive' } },
              { guestPhone: { contains: 'ORD-25' } },
            ],
            statusId: 'status-pending',
            trashedAt: null,
          },
        }),
      );
    });

    it('should use default pagination values when not provided', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('should handle custom sort and order', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);
      (prisma.order.count as jest.Mock).mockResolvedValue(1);

      await service.findAll({ sort: 'total', order: 'asc' });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { total: 'asc' } }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an order by id when a matching token is provided', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      const result = await service.findOne('order-id-1', {
        token: 'mock-view-token',
      });

      expect(prisma.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-id-1' } }),
      );
      expect(result).toEqual(mockOrder);
    });

    it('loads product.category + combo relations so the browser Purchase can map content metadata (F1)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await service.findOne('order-id-1', { token: 'mock-view-token' });

      const call = (prisma.order.findUnique as jest.Mock).mock.calls[0][0];
      expect(call.include.items.include).toEqual(
        expect.objectContaining({
          product: expect.objectContaining({
            select: expect.objectContaining({
              category: { select: { name: true } },
            }),
          }),
          combo: { select: { id: true, name: true } },
        }),
      );
    });

    it('should throw NotFoundException for non-guest order without matching token', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await expect(service.findOne('order-id-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks a staff viewer when another user holds a live edit lock', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        editLock: {
          orderId: 'order-id-1',
          userId: 'user-b',
          expiresAt: new Date(Date.now() + 60_000),
          user: { firstName: 'Bilal', lastName: 'Hossain' },
        },
      });

      await expect(
        service.findOne('order-id-1', {
          userId: 'user-a',
          role: 'admin',
        }),
      ).rejects.toMatchObject({
        response: {
          statusCode: 409,
          code: 'ORDER_LOCKED',
          message: expect.stringContaining('Bilal Hossain'),
        },
      });
    });

    it('allows the lock holder to view while they hold the lock', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        editLock: {
          orderId: 'order-id-1',
          userId: 'user-a',
          expiresAt: new Date(Date.now() + 60_000),
          user: { firstName: 'Ayesha', lastName: 'Khan' },
        },
      });

      const result = await service.findOne('order-id-1', {
        userId: 'user-a',
        role: 'admin',
      });
      expect(result.id).toBe('order-id-1');
      expect(result.editLock).toBeDefined();
    });

    it('ignores an expired edit lock when viewing as staff', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        editLock: {
          orderId: 'order-id-1',
          userId: 'user-b',
          expiresAt: new Date(Date.now() - 5_000),
          user: { firstName: 'Bilal', lastName: 'Hossain' },
        },
      });

      const result = await service.findOne('order-id-1', {
        userId: 'user-a',
        role: 'admin',
      });
      expect(result.id).toBe('order-id-1');
    });
  });

  describe('create', () => {
    const createOrderDto = {
      customerId: 'customer-id-1',
      items: [
        {
          productId: 'prod-1',
          variantId: 'variant-1',
          quantity: 2,
          price: 1000,
        },
        { productId: 'prod-2', quantity: 1, price: 500 },
      ],
      shippingCharge: 100,
      discount: 50,
      discountType: 'flat' as const,
      shippingAddress: { address: '123 Test St' },
      customerNotes: 'Please deliver fast',
    };

    it('should create an order successfully', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({
        id: 'variant-1',
        stock: 8,
      });

      const result = await service.create(createOrderDto);

      expect(prisma.orderStatus.findFirst).toHaveBeenCalledWith({
        where: { isInitial: true },
      });
      expect(prisma.order.create).toHaveBeenCalled();
      expect(result).toEqual(mockOrder);
    });

    const makeGuestDto = () => ({
      ...createOrderDto,
      customerId: undefined,
      guestPhone: '01712345678',
      guestName: 'Guest Buyer',
    });

    const runTx = () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
      });
    };

    it('hard-blocks storefront (guest) orders from a blocked IP', async () => {
      runTx();
      (blockedEntries.findOrderBlockedIp as jest.Mock).mockResolvedValue({
        id: 'ip-block-1',
      });

      await expect(
        service.create(makeGuestDto(), '203.0.113.9'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('hard-blocks storefront (guest) orders from a blocked phone', async () => {
      runTx();
      (blockedEntries.findBlockedPhone as jest.Mock).mockResolvedValue({
        id: 'phone-block-1',
      });

      await expect(service.create(makeGuestDto(), undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('hard-blocks storefront (guest) orders from a suspended customer', async () => {
      runTx();
      (customers.isPhoneBlocked as jest.Mock).mockResolvedValue(true);

      await expect(service.create(makeGuestDto(), undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows staff-created orders for blocked phones and returns warnings', async () => {
      runTx();
      (blockedEntries.findBlockedPhone as jest.Mock).mockResolvedValue({
        id: 'phone-block-1',
      });

      const result = await service.create(
        makeGuestDto(),
        '10.0.0.1',
        { userId: 'admin-1', role: 'admin' },
      );

      expect(prisma.order.create).toHaveBeenCalled();
      expect((result as any).warnings).toEqual([
        'This phone number is blocked for storefront ordering.',
      ]);
    });

    it('allows staff-created orders for blocked IPs and returns warnings', async () => {
      runTx();
      (blockedEntries.findOrderBlockedIp as jest.Mock).mockResolvedValue({
        id: 'ip-block-1',
      });

      const result = await service.create(
        makeGuestDto(),
        '203.0.113.9',
        { userId: 'admin-1', role: 'admin' },
      );

      expect(prisma.order.create).toHaveBeenCalled();
      expect((result as any).warnings).toEqual([
        'This IP address is blocked for storefront ordering.',
      ]);
    });

    it('adds no warnings for staff orders without active blocks', async () => {
      runTx();
      (blockedEntries.findOrderBlockedIp as jest.Mock).mockResolvedValue(null);
      (blockedEntries.findBlockedPhone as jest.Mock).mockResolvedValue(null);
      (customers.isPhoneBlocked as jest.Mock).mockResolvedValue(false);

      const result = await service.create(
        makeGuestDto(),
        '10.0.0.2',
        { userId: 'admin-1', role: 'admin' },
      );

      expect((result as any).warnings).toBeUndefined();
    });

    it('allows staff-created orders for suspended customers with warnings', async () => {
      runTx();
      (customers.isPhoneBlocked as jest.Mock).mockResolvedValue(true);

      const result = await service.create(
        makeGuestDto(),
        undefined,
        { userId: 'admin-1', role: 'admin' },
      );

      expect(prisma.order.create).toHaveBeenCalled();
      expect((result as any).warnings).toEqual([
        'This customer account is suspended; the order was created by staff.',
      ]);
    });

    describe('managed-stock availability gate (zero/negative stock)', () => {
      const runTx = () => {
        (prisma.$transaction as jest.Mock).mockImplementation(
          async (cb: (tx: any) => Promise<any>) =>
            cb({
              ...prisma,
              orderCounter: {
                upsert: jest
                  .fn()
                  .mockResolvedValue({ date: '250115', seq: 1 }),
              },
            }),
        );
        (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
          mockInitialStatus,
        );
      };

      it('blocks a MANAGED_STOCK variant with zero stock', async () => {
        runTx();
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'variant-1',
            price: 1000,
            isActive: true,
            productId: 'prod-1',
            managedStockQuantity: 0,
            reservedStock: 0,
          },
        ]);

        await expect(service.create(createOrderDto)).rejects.toThrow(
          'out of stock and cannot be ordered',
        );
      });

      it('blocks a MANAGED_STOCK variant with negative stock', async () => {
        runTx();
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'variant-1',
            price: 1000,
            isActive: true,
            productId: 'prod-1',
            managedStockQuantity: -3,
            reservedStock: 0,
          },
        ]);

        await expect(service.create(createOrderDto)).rejects.toThrow(
          'out of stock and cannot be ordered',
        );
      });

      it('blocks a variant whose reservations consume the full stock', async () => {
        runTx();
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'variant-1',
            price: 1000,
            isActive: true,
            productId: 'prod-1',
            managedStockQuantity: 5,
            reservedStock: 5,
          },
        ]);

        await expect(service.create(createOrderDto)).rejects.toThrow(
          'out of stock and cannot be ordered',
        );
      });

      it('blocks a quantity exceeding the available stock', async () => {
        runTx();
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'variant-1',
            price: 1000,
            isActive: true,
            productId: 'prod-1',
            managedStockQuantity: 1,
            reservedStock: 0,
          },
        ]);

        await expect(service.create(createOrderDto)).rejects.toThrow(
          'Only 1 unit(s) of "Prod 1" are in stock (requested 2)',
        );
      });

      it('blocks a MANAGED_STOCK simple product with zero stock', async () => {
        runTx();
        (prisma.product.findMany as jest.Mock).mockImplementation(
          async (args: any) => {
            if (args?.where?.availabilityMode === 'ALWAYS_OUT_OF_STOCK') {
              return [];
            }
            return [
              {
                id: 'prod-2',
                basePrice: 500,
                salePrice: null,
                isActive: true,
                availabilityMode: 'MANAGED_STOCK',
                name: 'Prod 2',
                type: 'simple',
                managedStockQuantity: 0,
                reservedStock: 0,
              },
            ];
          },
        );

        await expect(
          service.create({
            ...createOrderDto,
            items: [{ productId: 'prod-2', quantity: 1, price: 500 }],
          }),
        ).rejects.toThrow('out of stock and cannot be ordered');
      });

      it('blocks a combo whose simple component is out of stock', async () => {
        runTx();
        (prisma.combo.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'combo-1',
            basePrice: 900,
            salePrice: null,
            isActive: true,
            name: 'Combo A',
            items: [
              {
                productId: 'prod-2',
                variantId: null,
                quantity: 2,
                product: {
                  type: 'simple',
                  availabilityMode: 'MANAGED_STOCK',
                  name: 'Prod 2',
                  managedStockQuantity: 0,
                  reservedStock: 0,
                },
              },
            ],
          },
        ]);

        await expect(
          service.create({
            ...createOrderDto,
            items: [{ comboId: 'combo-1', quantity: 1, price: 900 }],
          }),
        ).rejects.toThrow('out of stock and cannot be ordered');
      });

      it('blocks a combo whose variable component variant is out of stock', async () => {
        runTx();
        (prisma.combo.findMany as jest.Mock).mockResolvedValue([
          {
            id: 'combo-1',
            basePrice: 900,
            salePrice: null,
            isActive: true,
            name: 'Combo A',
            items: [
              {
                productId: 'prod-1',
                variantId: null,
                quantity: 1,
                product: {
                  type: 'variable',
                  availabilityMode: 'MANAGED_STOCK',
                  name: 'Prod 1',
                  managedStockQuantity: 25,
                  reservedStock: 0,
                },
              },
            ],
          },
        ]);
        (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
          id: 'variant-9',
          managedStockQuantity: 0,
          reservedStock: 0,
        });

        await expect(
          service.create({
            ...createOrderDto,
            items: [
              {
                comboId: 'combo-1',
                quantity: 1,
                price: 900,
                comboSelection: { 'prod-1': 'variant-9' },
              },
            ],
          }),
        ).rejects.toThrow('out of stock and cannot be ordered');
      });
    });

    it('copies the current default office note on create when input is empty/blank (Hotfix 2 rule)', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'default_office_note',
        value: 'default-note',
      });
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({ ...createOrderDto, officeNotes: '' });

      expect(
        (prisma.order.create as jest.Mock).mock.calls[0][0].data.officeNotes,
      ).toBe('default-note');
    });

    it('persists source attribution dimensions and the resolved division on create', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
            shippingZoneGroup: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({
        ...createOrderDto,
        district: 'Dhaka',
        salesChannel: 'WEBSITE' as any,
        sourcePlatform: 'FACEBOOK',
        sourceType: 'AD',
        sourceEntity: 'EcoMate Store',
      });

      const createData = (prisma.order.create as jest.Mock).mock.calls[0][0]
        .data;
      expect(createData.salesChannel).toBe('WEBSITE');
      expect(createData.sourcePlatform).toBe('FACEBOOK');
      expect(createData.sourceType).toBe('AD');
      expect(createData.sourceEntity).toBe('EcoMate Store');
      // Canonical division resolved from the selected district (spec §19-21).
      expect(createData.shippingAddress.division).toBe('Dhaka');
    });

    it('resolves source platform/type from first-party landing attribution', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
            shippingZoneGroup: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({
        ...createOrderDto,
        district: 'Dhaka',
        salesChannel: 'WEBSITE' as any,
        attribution: {
          utmSource: 'facebook',
          utmMedium: 'cpc',
          fbclid: 'AbCd',
          referrer: 'https://www.instagram.com/',
        },
      });

      const createData = (prisma.order.create as jest.Mock).mock.calls[0][0]
        .data;
      // Recognized utm_source wins over click-id/referrer (spec §21 precedence).
      expect(createData.sourcePlatform).toBe('FACEBOOK');
      expect(createData.sourceType).toBe('AD');
    });

    it('explicit sourcePlatform/sourceType win over inferred attribution', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
            shippingZoneGroup: {
              findMany: jest.fn().mockResolvedValue([]),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({
        ...createOrderDto,
        district: 'Dhaka',
        salesChannel: 'WEBSITE' as any,
        sourcePlatform: 'INSTAGRAM',
        sourceType: 'CHAT',
        attribution: {
          utmSource: 'facebook',
          utmMedium: 'cpc',
        },
      });

      const createData = (prisma.order.create as jest.Mock).mock.calls[0][0]
        .data;
      // Explicit caller-provided dimensions are authoritative.
      expect(createData.sourcePlatform).toBe('INSTAGRAM');
      expect(createData.sourceType).toBe('CHAT');
    });

    it('uses a non-empty provided office note on create (overrides the default)', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'default_office_note',
        value: 'default-note',
      });
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({ ...createOrderDto, officeNotes: 'Override' });

      expect(
        (prisma.order.create as jest.Mock).mock.calls[0][0].data.officeNotes,
      ).toBe('Override');
    });

    it('creates COD cash payment rows as UNPAID so the Delivered path can verify them', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({
        ...createOrderDto,
        paymentOptionType: 'CASH_ON_DELIVERY',
      } as any);

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gatewayCode: 'cash',
            status: 'UNPAID',
          }),
        }),
      );
    });

    it('should throw BadRequestException if no initial status configured', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.create(createOrderDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should generate sequential display IDs', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 6 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create(createOrderDto);

      const createCall = (prisma.order.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.displayId).toMatch(/^ORD-\d{6}-0006$/);
    });

    it('should not decrement variant stock if no variantId', async () => {
      const dtoWithoutVariant = {
        ...createOrderDto,
        items: [{ productId: 'prod-2', quantity: 1, price: 500 }],
      };

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);

      await service.create(dtoWithoutVariant);

      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('should store trackingSessionId on the created order when provided', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        trackingSessionId: 'ctx-123',
      });
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({
        ...createOrderDto,
        trackingSessionId: 'ctx-123',
      });

      const createCall = (prisma.order.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.trackingSessionId).toBe('ctx-123');
    });

    it('supersedes pending checkout leads for the order session (ctxId) and phone', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
            customerProfile: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ phone: '01700000000' }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        trackingSessionId: 'ctx-123',
        guestPhone: '01700000000',
      });
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create({
        ...createOrderDto,
        trackingSessionId: 'ctx-123',
      });

      const updateCall = (prisma.checkoutLead.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(updateCall.where.status).toBe('PENDING');
      expect(updateCall.where.OR).toEqual(
        expect.arrayContaining([
          { ctxId: 'ctx-123' },
          {
            phone: { in: ['01700000000'] },
            lastSeenAt: { gte: expect.any(Date) },
          },
        ]),
      );
      expect(updateCall.data.status).toBe('SUPERSEDED');
    });

    it('captures an instant purchase snapshot inside the order transaction', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        trackingSessionId: 'ctx-123',
      });
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        trackingSessionId: 'ctx-123',
      });
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.create({
        ...createOrderDto,
        trackingSessionId: 'ctx-123',
      });

      const capture = trackingCapture.capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      const [input, txArg] = capture.mock.calls[0];
      expect(input.eventId).toBe('purchase_order-id-1');
      expect(input.eventType).toBe('Purchase');
      expect(input.ctxId).toBe('ctx-123');
      expect(input.payload.value).toBe(2050);
      // capture runs inside the business transaction client
      expect(txArg).toBeDefined();
      expect((txArg as any).orderCounter).toBeDefined();
    });

    it('staff creates an order with the selected customer and edited info, not their own identity', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        status: 'active',
        phoneNumber: '01712345678',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      });

      await service.create(
        {
          ...createOrderDto,
          customerId: 'customer-id-1',
          guestName: 'Edited Name',
          guestPhone: '01712345678',
          guestEmail: 'edited@example.com',
        },
        '127.0.0.1',
        { userId: 'staff-1', role: 'admin' },
      );

      // Order must link to the selected customer, never the staff account.
      const createCall = (prisma.order.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.customerId).toBe('customer-id-1');
      expect(createCall.data.guestName).toBe('Edited Name');
      expect(createCall.data.guestPhone).toBe('+8801712345678');
      // The edited customer info is persisted back onto the customer profile.
      expect(prisma.customerProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-id-1' },
          update: expect.objectContaining({
            name: 'Edited Name',
            phone: '+8801712345678',
            email: 'edited@example.com',
          }),
        }),
      );
    });

    it('authenticated customer order is locked to their own identity', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);

      await service.create(
        {
          ...createOrderDto,
          customerId: 'someone-else',
          guestName: 'Spoofed',
          guestPhone: '01712345678',
        },
        '127.0.0.1',
        { userId: 'cust-1', role: 'customer' },
      );

      const createCall = (prisma.order.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.customerId).toBe('cust-1');
      expect(createCall.data.guestName).toBeUndefined();
      expect(createCall.data.guestPhone).toBeUndefined();
    });
  });

  describe('updateStatus', () => {
    const updateStatusDto = {
      statusId: 'status-confirmed',
      note: 'Confirming order',
    };
    const userId = 'admin-user-id';

    it('should update order status successfully', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const result = await service.updateStatus(
        'order-id-1',
        updateStatusDto,
        userId,
      );

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-id-1' },
        include: { status: true },
      });
      expect(prisma.orderStatus.findUnique).toHaveBeenCalledWith({
        where: { id: 'status-confirmed' },
      });
      expect(prisma.order.update).toHaveBeenCalled();
      expect(result.statusId).toBe('status-confirmed');
    });

    it('should throw NotFoundException if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateStatus('nonexistent-id', updateStatusDto, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if status not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateStatus('order-id-1', updateStatusDto, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid status transition', async () => {
      const invalidStatusDto = { statusId: 'status-shipped' };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockShippedStatus,
      );

      await expect(
        service.updateStatus('order-id-1', invalidStatusDto, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows Cancelled → Hold and re-establishes the stock reservation', async () => {
      const cancelledOrder = {
        ...mockOrder,
        status: { id: 'status-cancelled', name: 'Cancelled' },
      };
      const holdStatus = {
        id: 'status-hold',
        name: 'Hold',
        isInitial: false,
        nextStatuses: [],
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(cancelledOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(holdStatus);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...cancelledOrder,
        statusId: 'status-hold',
        status: holdStatus,
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(prisma),
      );
      (prisma.orderStockCycle.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.orderStockCycle.create as jest.Mock).mockResolvedValue({
        id: 'cycle-1',
      });
      (prisma.orderItemComboComponent as any) = {
        findMany: jest.fn().mockResolvedValue([]),
      };
      (prisma.physicalInventory as any) = {
        findFirst: jest.fn().mockResolvedValue(null),
      };
      (prisma.physicalReservation as any).findUnique = jest
        .fn()
        .mockResolvedValue(null);

      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-hold', note: 'Customer asked to pause' },
        userId,
      );

      expect(prisma.order.update).toHaveBeenCalled();
      // verifyStockForOrder ran → a fresh ACTIVE cycle was created (the
      // cancelled order's reservation was restored, Hold now holds stock).
      expect(prisma.orderStockCycle.findFirst).toHaveBeenCalledWith({
        where: { orderId: 'order-id-1', status: 'ACTIVE' },
      });
    });

    it('allows Confirmed → Hold and re-verifies stock', async () => {
      const confirmedOrder = {
        ...mockOrder,
        status: { id: 'status-confirmed', name: 'Confirmed' },
      };
      const holdStatus = {
        id: 'status-hold',
        name: 'Hold',
        isInitial: false,
        nextStatuses: [],
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(confirmedOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(holdStatus);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...confirmedOrder,
        statusId: 'status-hold',
        status: holdStatus,
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(prisma),
      );
      (prisma.orderStockCycle.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.orderStockCycle.create as jest.Mock).mockResolvedValue({
        id: 'cycle-1',
      });
      (prisma.orderItemComboComponent as any) = {
        findMany: jest.fn().mockResolvedValue([]),
      };
      (prisma.physicalInventory as any) = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-hold', note: 'Customer asked to pause' },
        userId,
      );

      expect(prisma.order.update).toHaveBeenCalled();
      // verifyStockForOrder ran → a fresh ACTIVE cycle was created (the
      // Confirmed order's reservation is validated, Hold now holds stock).
      expect(prisma.orderStockCycle.findFirst).toHaveBeenCalledWith({
        where: { orderId: 'order-id-1', status: 'ACTIVE' },
      });
    });

    it('allows Cancelled → Confirmed and re-verifies stock', async () => {
      const cancelledOrder = {
        ...mockOrder,
        status: { id: 'status-cancelled', name: 'Cancelled' },
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(cancelledOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...cancelledOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb) =>
        cb(prisma),
      );
      (prisma.orderStockCycle.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.orderStockCycle.create as jest.Mock).mockResolvedValue({
        id: 'cycle-1',
      });
      (prisma.orderItemComboComponent as any) = {
        findMany: jest.fn().mockResolvedValue([]),
      };
      (prisma.physicalInventory as any) = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-confirmed' },
        userId,
      );

      expect(prisma.order.update).toHaveBeenCalled();
      expect(prisma.orderStockCycle.create).toHaveBeenCalled();
      expect(result.statusId).toBe('status-confirmed');
    });

    describe('confirm re-verifies stock truthfully (zero/negative)', () => {
      const buildConfirmOrder = (productOverrides: Record<string, unknown>) => ({
        ...mockOrder,
        status: { id: 'status-cancelled', name: 'Cancelled' },
        items: [
          {
            id: 'item-id-1',
            orderId: 'order-id-1',
            productId: 'prod-1',
            variantId: 'variant-1',
            quantity: 2,
            price: 1000,
            product: {
              id: 'prod-1',
              name: 'Test Product',
              availabilityMode: 'MANAGED_STOCK',
              manageStock: true,
              type: 'simple',
              warehouseId: null,
              syncManagedStock: null,
              ...productOverrides,
            },
          },
        ],
      });

      const stubConfirmCommon = (order: Record<string, unknown>) => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          mockConfirmedStatus,
        );
        (prisma.order.update as jest.Mock).mockResolvedValue({
          ...order,
          statusId: 'status-confirmed',
          status: mockConfirmedStatus,
        });
        (prisma.$transaction as jest.Mock).mockImplementation(async (cb) =>
          cb(prisma),
        );
        (prisma.orderStockCycle.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.orderStockCycle.create as jest.Mock).mockResolvedValue({
          id: 'cycle-1',
        });
        (prisma.orderItemComboComponent as any) = {
          findMany: jest.fn().mockResolvedValue([]),
        };
        (prisma.physicalInventory as any) = {
          findFirst: jest.fn().mockResolvedValue(null),
        };
      };

      it('rejects confirm when managed stock available has dropped to zero', async () => {
        stubConfirmCommon(buildConfirmOrder({}));
        (module.get<StockService>(StockService).getAvailableStock as jest.Mock)
          .mockResolvedValue({ stock: 0, reserved: 0, available: 0 });

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          'Insufficient stock for "Test Product". Available: 0, needed: 2.',
        );
      });

      it('rejects confirm when managed stock available is negative', async () => {
        stubConfirmCommon(buildConfirmOrder({}));
        (module.get<StockService>(StockService).getAvailableStock as jest.Mock)
          .mockResolvedValue({ stock: 4, reserved: 7, available: -3 });

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          'Insufficient stock for "Test Product". Available: -3, needed: 2.',
        );
      });

      it('rejects confirm for an ALWAYS_OUT_OF_STOCK product', async () => {
        stubConfirmCommon(
          buildConfirmOrder({ availabilityMode: 'ALWAYS_OUT_OF_STOCK' }),
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          'Product "Test Product" is out of stock and cannot be ordered',
        );
      });

      it('rejects confirm when physical stock available is zero', async () => {
        const stockService = module.get<StockService>(StockService);
        (stockService as any).hasExistingPhysicalReservation = jest
          .fn()
          .mockResolvedValue(false);
        (module.get<StockRouterService>(StockRouterService).resolve as jest.Mock)
          .mockReturnValue({ ms: 'skip', pi: 'allocate' });
        stubConfirmCommon(
          buildConfirmOrder({
            availabilityMode: 'INVENTORY_CONTROLLED',
            warehouseId: 'wh-1',
          }),
        );
        (prisma.physicalInventory as any) = {
          findFirst: jest.fn().mockResolvedValue({
            quantity: 2,
            reservedQuantity: 2,
          }),
        };

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          'Insufficient physical stock for "Test Product". Available: 0, needed: 2.',
        );
      });

      it('rejects confirm when physical reservations exceed quantity (negative available)', async () => {
        const stockService = module.get<StockService>(StockService);
        (stockService as any).hasExistingPhysicalReservation = jest
          .fn()
          .mockResolvedValue(false);
        (module.get<StockRouterService>(StockRouterService).resolve as jest.Mock)
          .mockReturnValue({ ms: 'skip', pi: 'allocate' });
        stubConfirmCommon(
          buildConfirmOrder({
            availabilityMode: 'INVENTORY_CONTROLLED',
            warehouseId: 'wh-1',
          }),
        );
        (prisma.physicalInventory as any) = {
          findFirst: jest.fn().mockResolvedValue({
            quantity: 2,
            reservedQuantity: 5,
          }),
        };

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          'Insufficient physical stock for "Test Product". Available: -3, needed: 2.',
        );
      });

      it('rejects confirm when a combo component managed stock is zero', async () => {
        stubConfirmCommon({
          ...mockOrder,
          status: { id: 'status-cancelled', name: 'Cancelled' },
          items: [
            {
              id: 'item-id-1',
              orderId: 'order-id-1',
              comboId: 'combo-1',
              quantity: 1,
              price: 1000,
              product: null,
            },
          ],
        });
        (prisma.orderItemComboComponent as any) = {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'comp-1',
              orderItemId: 'item-id-1',
              productId: 'comp-prod',
              variantId: null,
              totalQuantity: 1,
              managedStockReserved: false,
              product: {
                id: 'comp-prod',
                name: 'Comp A',
                availabilityMode: 'MANAGED_STOCK',
                manageStock: true,
                type: 'simple',
                warehouseId: null,
                syncManagedStock: null,
              },
            },
          ]),
        };
        (module.get<StockService>(StockService).getAvailableStock as jest.Mock)
          .mockResolvedValue({ stock: 0, reserved: 0, available: 0 });

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          'Insufficient managed stock for combo component "Comp A". Available: 0, needed: 1.',
        );
      });
    });

    it('rejects Cancelled → Shipping (not in allowed transitions)', async () => {
      const cancelledOrder = {
        ...mockOrder,
        status: { id: 'status-cancelled', name: 'Cancelled' },
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(cancelledOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockShippedStatus,
      );

      await expect(
        service.updateStatus(
          'order-id-1',
          { statusId: 'status-shipped' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a return to be started from Shipping without requiring delivery', async () => {
      const shippingOrder = {
        ...mockOrder,
        status: { ...mockInitialStatus, name: 'Shipping' },
      };
      const returnPendingStatus = {
        id: 'status-return-pending',
        name: 'Return Pending',
        isInitial: false,
        nextStatuses: [],
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(shippingOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnPendingStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...shippingOrder,
        statusId: 'status-return-pending',
        status: returnPendingStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);

      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-return-pending', note: 'Courier return before delivery' },
        userId,
      );

      expect(prisma.order.update).toHaveBeenCalled();
    });

    describe('Partial automation-stop (authoritative rule)', () => {
      const partialOrder = {
        ...mockOrder,
        status: { id: 'status-partial', name: 'Partial' },
      };
      const deliveredStatus = {
        id: 'status-delivered',
        name: 'Delivered',
        isInitial: false,
        nextStatuses: [],
      };
      const returnPendingStatus = {
        id: 'status-return-pending',
        name: 'Return Pending',
        isInitial: false,
        nextStatuses: [],
      };

      it('blocks automated actors from moving a Partial order to Delivered', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder);
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          deliveredStatus,
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-delivered' },
            'system',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.order.update).not.toHaveBeenCalled();
      });

      it.each([
        ['system', 'system'],
        ['webhook', 'webhook'],
        ['reconcile', 'reconcile'],
      ])('blocks automated actor %s from moving a Partial order', async (_label, actor) => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder);
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          deliveredStatus,
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-delivered' },
            actor,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.order.update).not.toHaveBeenCalled();
      });

      it('blocks automated actors from moving a Partial order to Returned', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder);
        const returnedStatus = {
          id: 'status-returned',
          name: 'Returned',
          isInitial: false,
          nextStatuses: [],
        };
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          returnedStatus,
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-returned' },
            'system',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.order.update).not.toHaveBeenCalled();
      });

      it('allows a manual staff member to move a Partial order forward', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder);
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          returnPendingStatus,
        );
        (prisma.order.update as jest.Mock).mockResolvedValue({
          ...partialOrder,
          statusId: 'status-return-pending',
          status: returnPendingStatus,
        });
        (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
        (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.updateStatus(
          'order-id-1',
          { statusId: 'status-return-pending', note: 'Manual staff decision' },
          userId,
        );

        expect(prisma.order.update).toHaveBeenCalled();
        expect(result.statusId).toBe('status-return-pending');
      });
    });

    it('captures a validated purchase snapshot inside the status transaction', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Confirmed' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.updateStatus('order-id-1', updateStatusDto, userId);

      const capture = trackingCapture.capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      const [input, txArg] = capture.mock.calls[0];
      expect(input.eventId).toBe('purchase_order-id-1');
      expect(input.eventType).toBe('Purchase');
      expect(input.ctxId).toBeUndefined(); // mockOrder has no trackingSessionId
      // capture runs inside the business transaction client
      expect(txArg).toBeDefined();
    });

    it('marks the COD cash payment PAID on Delivered (single delivered path)', async () => {
      const deliveredStatus = {
        id: 'status-delivered',
        name: 'Delivered',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: { id: 'status-shipping', name: 'Shipping' },
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        deliveredStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: deliveredStatus,
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'pay-cod',
        gatewayCode: 'cash',
        status: 'UNPAID',
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);

      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-delivered' },
        userId,
      );

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-cod' },
          data: expect.objectContaining({
            status: 'PAID',
            verifiedBy: userId,
          }),
        }),
      );
    });

    it('fires the validated Purchase from verifyPayment when payment verification confirms', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        paymentStatus: 'PAYMENT_VERIFYING',
        status: mockConfirmedStatus,
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        paymentStatus: 'PAID',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Confirmed' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.verifyPayment('order-id-1', true, 'note');

      const capture = trackingCapture.capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      const [input] = capture.mock.calls[0];
      expect(input.eventId).toBe('purchase_order-id-1');
      expect(input.eventType).toBe('Purchase');
      expect(input.actionSource).toBe('website');
    });

    it('does NOT fire a validated Purchase when verifyPayment reaches a non-configured status', async () => {
      const deliveredStatus = {
        id: 'status-delivered',
        name: 'Delivered',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        paymentStatus: 'PAYMENT_VERIFYING',
        status: mockConfirmedStatus,
      });
      // Simulate the configured validated status being Delivered — but the
      // actual reachable status from verifyPayment is Confirmed.
      (prisma.orderStatus.findUnique as jest.Mock).mockImplementation((arg) =>
        Promise.resolve(
          arg?.where?.name === 'Delivered'
            ? deliveredStatus
            : arg?.where?.name === 'Confirmed'
              ? mockConfirmedStatus
              : null,
        ),
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        paymentStatus: 'PAID',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Delivered' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.verifyPayment('order-id-1', true, 'note');

      // Confirmed ≠ configured Delivered → no validated Purchase.
      expect(trackingCapture.capture).not.toHaveBeenCalled();
    });

    it('fires exactly one validated Purchase when verifyPayment reaches the configured target', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        paymentStatus: 'PAYMENT_VERIFYING',
        status: mockConfirmedStatus,
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        paymentStatus: 'PAID',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Confirmed' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.verifyPayment('order-id-1', true, 'note');

      const capture = trackingCapture.capture as jest.Mock;
      // One logical Purchase, one capture (same purchase_{orderId} event id).
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].eventId).toBe('purchase_order-id-1');
    });

    it('does NOT add a second Purchase from payment verification in instant mode', async () => {
      // Instant mode: the Purchase already fired at order creation. Even if a
      // validated status is configured, payment verification must not add a
      // second logical Purchase (spec §3 test 4 / one-Purchase-per-order).
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        paymentStatus: 'PAYMENT_VERIFYING',
        status: mockConfirmedStatus,
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        paymentStatus: 'PAID',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'instant' },
        { key: 'tracking_meta_validated_status', value: 'Confirmed' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.verifyPayment('order-id-1', true, 'note');

      // mode is instant → validated trigger suppressed entirely.
      expect(trackingCapture.capture).not.toHaveBeenCalled();
    });

    it('does not write internalNote to the order when a note string is passed', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        paymentStatus: 'PAYMENT_VERIFYING',
        status: mockConfirmedStatus,
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        paymentStatus: 'PAID',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.verifyPayment(
        'order-id-1',
        true,
        'payment screenshot attached',
      );

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-id-1' },
          data: expect.objectContaining({
            paymentStatus: 'PAID',
            statusId: 'status-confirmed',
          }),
        }),
      );
      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('internalNote');
    });

    it('does not write internalNote when no note is passed', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        salesChannel: 'WEBSITE',
        paymentStatus: 'PAYMENT_VERIFYING',
        status: mockConfirmedStatus,
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockImplementation((arg) =>
        Promise.resolve(
          arg?.where?.name === 'Payment Pending'
            ? { id: 'status-payment-pending', name: 'Payment Pending' }
            : mockConfirmedStatus,
        ),
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        paymentStatus: 'PAYMENT_PENDING',
        status: { id: 'status-payment-pending', name: 'Payment Pending' },
      });

      await service.verifyPayment('order-id-1', false);

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('internalNote');
      expect(updateCall.data.paymentStatus).toBe('PAYMENT_PENDING');
      expect(updateCall.data.statusId).toBe('status-payment-pending');
    });

    it('fires a validated Purchase when configured status matches (Delivered)', async () => {
      const deliveredStatus = {
        id: 'status-delivered',
        name: 'Delivered',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: { id: 'status-shipping', name: 'Shipping' },
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        deliveredStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: deliveredStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Delivered' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.updateStatus('order-id-1', { statusId: 'status-delivered' }, userId);

      expect(trackingCapture.capture).toHaveBeenCalledTimes(1);
      expect(trackingCapture.capture).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'Purchase' }),
        expect.anything(),
      );
    });

    it('does NOT fire a validated Purchase for an earlier status when Delivered is configured', async () => {
      // configured = Delivered; actual transition = Confirmed → should NOT fire
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Delivered' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.updateStatus('order-id-1', { statusId: 'status-confirmed' }, userId);

      // Confirmed ≠ configured Delivered → no validated Purchase
      expect(trackingCapture.capture).not.toHaveBeenCalled();
    });

    it('fires only for the configured status, not for a different valid status', async () => {
      // configured = Processing; actual transition = Confirmed → should NOT fire
      const processingStatus = {
        id: 'status-processing',
        name: 'Processing',
        isInitial: false,
        nextStatuses: ['status-confirmed'],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Processing' },
      ]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.updateStatus('order-id-1', { statusId: 'status-confirmed' }, userId);

      // Confirmed ≠ configured Processing → no validated Purchase
      expect(trackingCapture.capture).not.toHaveBeenCalled();
    });

    it('captures a refund snapshot inside the transaction for cancelled orders', async () => {
      const cancelledStatus = {
        id: 'status-cancelled',
        name: 'Cancelled',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        cancelledStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-cancelled',
        status: cancelledStatus,
      });
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'tracking_refund_enabled',
        value: 'true',
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-cancelled', note: 'x' },
        userId,
      );

      const capture = trackingCapture.capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].eventId).toBe('refund_order-id-1');
      expect(capture.mock.calls[0][0].eventType).toBe('Refund');
      expect(capture.mock.calls[0][0].payload.value).toBe(-2050);
    });

    it('reverses approved commissions when the order is Cancelled (G-01 hook)', async () => {
      const cancelledStatus = {
        id: 'status-cancelled',
        name: 'Cancelled',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        cancelledStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-cancelled',
        status: cancelledStatus,
      });
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'tracking_refund_enabled',
        value: 'false',
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-cancelled', note: 'x' },
        userId,
      );

      const commissions = module.get<CommissionsService>(CommissionsService);
      expect(commissions.reverseForOrder).toHaveBeenCalledWith(
        'order-id-1',
        undefined,
        'Order cancelled',
      );
    });

    it('does NOT reverse commissions on a Confirmed transition (no-op for confirm path)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-confirmed' },
        userId,
      );

      const commissions = module.get<CommissionsService>(CommissionsService);
      expect(commissions.reverseForOrder).not.toHaveBeenCalled();
    });

    it('blocks automated actors (system) from marking an order Returned', async () => {
      const returnPendingOrder = {
        ...mockOrder,
        status: { ...mockInitialStatus, name: 'Return Pending' },
      };
      const returnedStatus = {
        id: 'status-returned',
        name: 'Returned',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(
        returnPendingOrder,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnedStatus,
      );

      await expect(
        service.updateStatus(
          'order-id-1',
          { statusId: 'status-returned' },
          'system',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('allows a manual staff transition to Returned and runs restore side effects', async () => {
      const returnPendingOrder = {
        ...mockOrder,
        status: { ...mockInitialStatus, name: 'Return Pending' },
      };
      const returnedStatus = {
        id: 'status-returned',
        name: 'Returned',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(
        returnPendingOrder,
      );
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...returnPendingOrder,
        statusId: 'status-returned',
        status: returnedStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const cancelReturnStock = module.get<CancelReturnStockService>(
        CancelReturnStockService,
      );
      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-returned' },
        'staff-123',
      );

      expect(result.statusId).toBe('status-returned');
      expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ referencePrefix: 'return' }),
      );
    });

    it('auto-assigns the acting staff member on a manual status change', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.cancelReturnStock as any) = undefined;
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.updateStatus(
        'order-id-1',
        updateStatusDto,
        'staff-123',
      );

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.assignedToId).toBe('staff-123');
      expect(updateCall.data.assignedAt).toBeInstanceOf(Date);
    });

    it('never auto-assigns for automated actors (webhook/system)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.updateStatus('order-id-1', updateStatusDto, 'system');

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.assignedToId).toBeUndefined();
      expect(updateCall.data.assignedAt).toBeUndefined();
    });

    it('preserves an existing assignment when another staff member mutates (sticky first assignment)', async () => {
      const assignedOrder = { ...mockOrder, assignedToId: 'user-a' };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(assignedOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...assignedOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.updateStatus(
        'order-id-1',
        updateStatusDto,
        'user-b',
      );

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.assignedToId).toBeUndefined();
      expect(updateCall.data.assignedAt).toBeUndefined();
    });

    it('assigns the FIRST manual actor when the order is unassigned', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        mockConfirmedStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-confirmed',
        status: mockConfirmedStatus,
      });
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      await service.updateStatus('order-id-1', updateStatusDto, 'user-a');

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.assignedToId).toBe('user-a');
      expect(updateCall.data.assignedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateOrder', () => {
    const updateOrderDto = {
      shippingCharge: 150,
      discount: 100,
      customerNotes: 'Updated notes',
    };

    it('preserves an existing assignment when another staff edits the order', async () => {
      const existingOrder = {
        ...mockOrder,
        assignedToId: 'user-a',
        shippingCharge: 100,
        discount: 50,
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        shippingCharge: 150,
        discount: 100,
        subtotal: 2000,
        total: 2050,
      });

      await service.updateOrder('order-id-1', updateOrderDto, {
        userId: 'user-b',
      });

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.assignedToId).toBeUndefined();
      expect(updateCall.data.assignedAt).toBeUndefined();
    });

    it('blocks a save when another staff member holds a live edit lock', async () => {
      const existingOrder = {
        ...mockOrder,
        shippingCharge: 100,
        discount: 50,
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (editLock.getLock as jest.Mock).mockResolvedValue({
        orderId: 'order-id-1',
        userId: 'user-b',
        userName: 'Bilal Hossain',
        acquiredAt: new Date(),
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        service.updateOrder('order-id-1', updateOrderDto, {
          userId: 'user-a',
        }),
      ).rejects.toMatchObject({
        response: {
          statusCode: 409,
          code: 'ORDER_LOCKED',
          message: expect.stringContaining('Bilal Hossain'),
        },
      });
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('allows a save while the caller holds the live lock', async () => {
      const existingOrder = {
        ...mockOrder,
        shippingCharge: 100,
        discount: 50,
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (editLock.getLock as jest.Mock).mockResolvedValue(null);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        shippingCharge: 150,
        discount: 100,
        subtotal: 2000,
        total: 2050,
      });

      const result = await service.updateOrder('order-id-1', updateOrderDto, {
        userId: 'user-a',
      });
      expect(result.shippingCharge).toBe(150);
    });

    it('updates the payment row when the mode is switched to COD', async () => {
      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        paymentOptionType: 'CASH_ON_DELIVERY',
        paymentStatus: 'UNPAID',
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'pay-1',
        gatewayCode: 'bkash',
        amount: 2050,
        status: 'PENDING',
      });

      await service.updateOrder('order-id-1', {
        paymentOptionType: 'CASH_ON_DELIVERY',
        gatewayCode: 'cash',
      });

      const paymentUpdate = (prisma.payment.update as jest.Mock).mock
        .calls[0][0];
      expect(paymentUpdate.where).toEqual({ id: 'pay-1' });
      expect(paymentUpdate.data).toMatchObject({
        gatewayCode: 'cash',
        amount: 2050,
        status: 'UNPAID',
      });
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(orderUpdate.data.paymentOptionType).toBe('CASH_ON_DELIVERY');
      expect(orderUpdate.data.paymentStatus).toBe('UNPAID');
      expect(orderUpdate.data.partialAmount).toBeNull();
    });

    it('creates a payment row when the order had none', async () => {
      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        paymentOptionType: 'FULL_PAYMENT',
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);

      await service.updateOrder('order-id-1', {
        paymentOptionType: 'FULL_PAYMENT',
        gatewayCode: 'bkash',
      });

      const paymentCreate = (prisma.payment.create as jest.Mock).mock
        .calls[0][0];
      expect(paymentCreate.data).toMatchObject({
        orderId: 'order-id-1',
        gatewayCode: 'bkash',
        amount: 2050,
        status: 'PENDING',
      });
    });

    it('rejects partial payment amounts outside the valid range', async () => {
      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);

      await expect(
        service.updateOrder('order-id-1', {
          paymentOptionType: 'PARTIAL_PAYMENT',
          gatewayCode: 'bkash',
          partialAmount: 99999,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('refuses to change the gateway when a payment is already paid', async () => {
      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.payment.count as jest.Mock).mockResolvedValue(1);

      await expect(
        service.updateOrder('order-id-1', {
          paymentOptionType: 'CASH_ON_DELIVERY',
          gatewayCode: 'cash',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('assigns the first manual editor when the order is unassigned', async () => {
      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        shippingCharge: 150,
        discount: 100,
        subtotal: 2000,
        total: 2050,
      });

      await service.updateOrder('order-id-1', updateOrderDto, {
        userId: 'user-a',
      });

      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.assignedToId).toBe('user-a');
      expect(updateCall.data.assignedAt).toBeInstanceOf(Date);
    });

    it('should update an order successfully', async () => {
      const existingOrder = {
        ...mockOrder,
        shippingCharge: 100,
        discount: 50,
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...existingOrder,
        shippingCharge: 150,
        discount: 100,
        subtotal: 2000,
        total: 2050,
      });

      const result = await service.updateOrder('order-id-1', updateOrderDto);

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-id-1' },
        include: {
          items: { include: { product: { select: { id: true, name: true, availabilityMode: true } } } },
        },
      });
      expect(prisma.order.update).toHaveBeenCalled();
      expect(result.shippingCharge).toBe(150);
    });

    it('should throw NotFoundException if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateOrder('nonexistent-id', updateOrderDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should replace items when items are provided', async () => {
      const dtoWithItems = {
        items: [{ productId: 'prod-3', quantity: 3, price: 800 }],
      };

      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orderItem.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.orderItem.createMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', dtoWithItems);

      expect(prisma.orderItem.deleteMany).toHaveBeenCalledWith({
        where: { orderId: 'order-id-1' },
      });
      expect(prisma.orderItem.createMany).toHaveBeenCalled();
    });

    it('throws a friendly ConflictException when another customer owns the phone', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue({
        id: 'other-customer',
      });
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await expect(
        service.updateOrder('order-id-1', {
          customerInfo: {
            firstName: 'Jane',
            phoneNumber: '01812345678',
          },
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    });

    it('targets CustomerProfile (not UserProfile) so staff identity can never be overwritten', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane', email: 'free@x.com' },
      });

      // The write must land on the order's CustomerProfile only.
      const calls = (prisma.customerProfile.update as jest.Mock).mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toEqual({ where: { id: 'customer-id-1' }, data: { name: 'Jane', email: 'free@x.com' } });
      const userProfileUpdate = (prisma.userProfile as any).update;
      expect(userProfileUpdate).toBeUndefined();
    });

    it('omits an empty email so a customer without one can still be saved', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane', email: '' },
      });

      // Empty email never reaches the unique-key write (no P2002/409).
      expect(prisma.customerProfile.findFirst).not.toHaveBeenCalled();
      const updateCall = (prisma.customerProfile.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('email');
      expect(updateCall.data.name).toBe('Jane');
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('updates the customer email when no other customer owns it', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane', email: 'free@x.com' },
      });

      const updateCall = (prisma.customerProfile.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.email).toBe('free@x.com');
    });
  });

  describe('bulkStatusChange', () => {
    const pendingOrder = {
      id: 'order-1',
      displayId: 'ORD-1',
      timeline: [],
      statusId: 'status-pending',
      status: { name: 'Shipping' },
    };
    const confirmedOrder = {
      id: 'order-2',
      displayId: 'ORD-2',
      timeline: [],
      statusId: 'status-confirmed',
      status: { name: 'Confirmed' },
    };
    const returnPendingStatus = {
      id: 'status-rp',
      name: 'Return Pending',
    };
    const confirmedStatus = { id: 'status-c', name: 'Confirmed' };
    const returnedStatus = { id: 'status-rt', name: 'Returned' };

    it('reports real updated/skipped counts and failure reasons', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnPendingStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        pendingOrder,
        confirmedOrder,
      ]);

      // pendingOrder: Pending -> Return Pending is allowed; confirmedOrder not.
      const result = await service.bulkStatusChange(
        ['order-1', 'order-2'],
        'status-rp',
        'staff-123',
      );

      expect(result.updated).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failedDetails[0]).toMatchObject({
        id: 'order-2',
        reason: expect.stringContaining('Cannot transition'),
      });
    });

    it('reports missing orders as failures instead of pretending success', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnPendingStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([pendingOrder]);

      const result = await service.bulkStatusChange(
        ['order-1', 'ghost-order'],
        'status-rp',
        'staff-123',
      );

      expect(result.updated).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failedDetails[0]).toMatchObject({
        id: 'ghost-order',
        reason: 'Order not found',
      });
    });

    it('runs Returned restore side effects per valid order', async () => {
      const returnPendingOrder = {
        ...pendingOrder,
        status: { name: 'Return Pending' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        returnPendingOrder,
      ]);
      (prisma.order.update as jest.Mock).mockResolvedValue(returnPendingOrder);

      const cancelReturnStock = module.get<CancelReturnStockService>(
        CancelReturnStockService,
      );
      await service.bulkStatusChange(
        ['order-1'],
        'status-rt',
        'staff-123',
      );

      expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', referencePrefix: 'return' }),
      );
    });

    it('assigns the actor on bulk update only to currently-unassigned orders', async () => {
      const pendingToConfirmed = { ...pendingOrder, status: { name: 'Pending' } };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        pendingToConfirmed,
      ]);

      await service.bulkStatusChange(
        ['order-1'],
        'status-c',
        'staff-123',
      );

      const calls = (prisma.order.updateMany as jest.Mock).mock.calls;
      // First updateMany applies the status to all valid orders, with no assignment.
      expect(calls[0][0].data.statusId).toBe('status-c');
      expect(calls[0][0].data.assignedToId).toBeUndefined();
      // Unassigned orders get a second update that assigns the actor.
      const assignCall = calls.find(
        (c) => c[0].data && c[0].data.assignedToId === 'staff-123',
      );
      expect(assignCall).toBeDefined();
      expect(assignCall[0].where.id.in).toEqual(['order-1']);
    });

    it('preserves existing assignments on a staff bulk change', async () => {
      const assignedToB = {
        ...pendingOrder,
        status: { name: 'Pending' },
        assignedToId: 'user-a',
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([assignedToB]);

      await service.bulkStatusChange(['order-1'], 'status-c', 'staff-123');

      const calls = (prisma.order.updateMany as jest.Mock).mock.calls;
      expect(calls[0][0].data.assignedToId).toBeUndefined();
      const assignCall = calls.find(
        (c) => c[0].data && c[0].data.assignedToId === 'staff-123',
      );
      expect(assignCall).toBeUndefined();
    });

    it('does not auto-assign on automated bulk (system)', async () => {
      const pendingToConfirmed = { ...pendingOrder, status: { name: 'Pending' } };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        pendingToConfirmed,
      ]);

      await service.bulkStatusChange(['order-1'], 'status-c', 'system');

      const updateManyCall = (prisma.order.updateMany as jest.Mock).mock.calls[0][0];
      expect(updateManyCall.data.assignedToId).toBeUndefined();
      expect(updateManyCall.data.assignedAt).toBeUndefined();
    });

    it('rejects system bulk to Returned', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        returnedStatus,
      );

      await expect(
        service.bulkStatusChange(['order-1'], 'status-rt', 'system'),
      ).rejects.toThrow(BadRequestException);
    });

    it('captures validated purchase snapshots for orders touched by a bulk change', async () => {
      const pendingToConfirmed = { ...pendingOrder, status: { name: 'Pending' } };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        pendingToConfirmed,
      ]);
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Confirmed' },
      ]);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.bulkStatusChange(['order-1'], 'status-c', 'staff-123');

      const capture = trackingCapture.capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      const [input] = capture.mock.calls[0];
      expect(input.eventId).toBe('purchase_order-id-1');
      expect(input.eventType).toBe('Purchase');
    });

    it('does NOT fire validated Purchase in bulk when configured status does not match', async () => {
      // configured = Delivered; bulk target = Confirmed → should NOT fire
      const pendingToConfirmed = { ...pendingOrder, status: { name: 'Pending' } };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        confirmedStatus,
      );
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        pendingToConfirmed,
      ]);
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'tracking_meta_purchase_mode', value: 'validated' },
        { key: 'tracking_meta_validated_status', value: 'Delivered' },
      ]);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.bulkStatusChange(['order-1'], 'status-c', 'staff-123');

      // Confirmed ≠ configured Delivered → no validated Purchase
      expect(trackingCapture.capture).not.toHaveBeenCalled();
    });
  });

  describe('bulkAssign', () => {
    it('reports the real number of rows the updateMany touched', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'order-1' },
        { id: 'order-2' },
      ]);
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      const res = await service.bulkAssign(['order-1', 'order-2', 'missing'], 'staff-1');

      expect(res).toEqual({ updated: 2, total: 3 });
      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['order-1', 'order-2', 'missing'] }, trashedAt: null },
        select: { id: true },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['order-1', 'order-2'] } },
        data: { assignedToId: 'staff-1', assignedAt: expect.any(Date) },
      });
    });

    it('reports zero when none of the ids match an existing order', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      const res = await service.bulkAssign(['ghost-1', 'ghost-2'], 'staff-1');

      expect(res).toEqual({ updated: 0, total: 2 });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('does not assign trashed orders', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'order-1' },
      ]);
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

await service.bulkAssign(['order-1', 'trashed-1'], 'staff-1');

      expect(prisma.order.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['order-1', 'trashed-1'] },
          trashedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['order-1'] } },
        data: { assignedToId: 'staff-1', assignedAt: expect.any(Date) },
      });
    });

    it('clears assignedAt when unassigning', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'order-1' },
      ]);
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.bulkAssign(['order-1'], null);

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['order-1'] } },
        data: { assignedToId: null, assignedAt: null },
      });
    });

    it('propagates updateMany failures instead of reporting success', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'order-1' },
      ]);
      (prisma.order.updateMany as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.bulkAssign(['order-1'], 'staff-1'),
      ).rejects.toThrow('db down');
    });
  });

  describe('cancelByCustomer', () => {
    it('cancels a Pending order by view token and releases stock', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
      });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      const out: any = {};
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) => {
          const txOrderUpdate = jest.fn().mockResolvedValue({
            ...mockOrder,
            status: { id: 'status-cancelled', name: 'Cancelled' },
          });
          const tx = { ...prisma, order: { ...prisma.order, update: txOrderUpdate } };
          out.data = (await cb(tx)) && txOrderUpdate.mock.calls[0]?.[0]?.data;
          return { ...mockOrder, status: { id: 'status-cancelled', name: 'Cancelled' } };
        },
      );

      const result = await service.cancelByCustomer('order-id-1', 'the-token');

      const cancelReturnStock = module.get<CancelReturnStockService>(
        CancelReturnStockService,
      );
      expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-id-1',
          referencePrefix: 'cancel',
        }),
      );
      const commissions = module.get<CommissionsService>(CommissionsService);
      expect(commissions.reverseForOrder).toHaveBeenCalledWith(
        'order-id-1',
        undefined,
        'Order cancelled',
      );
      expect((result as any).status.name).toBe('Cancelled');
      expect(out.data.statusId).toBe('status-cancelled');
      const timeline = out.data.timeline;
      expect(timeline[timeline.length - 1].note).toBe('Cancelled by customer');
    });

    it('throws ForbiddenException when no token is supplied', async () => {
      await expect(
        service.cancelByCustomer('order-id-1', ''),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the token does not match', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-real-token',
      });

      await expect(
        service.cancelByCustomer('order-id-1', 'wrong-token'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for trashed orders', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
        trashedAt: new Date(),
      });

      await expect(
        service.cancelByCustomer('order-id-1', 'the-token'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects cancellation when the status transition is not allowed', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
        status: { id: 'status-delivered', name: 'Delivered' },
      });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });

      await expect(
        service.cancelByCustomer('order-id-1', 'the-token'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when Cancelled status is not configured', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
      });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.cancelByCustomer('order-id-1', 'the-token'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addNote', () => {
    it('should add a note to order timeline', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.addNote('order-id-1', 'Test note', 'public', 'user-id-1');

      expect(prisma.order.update).toHaveBeenCalled();
      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.timeline).toHaveLength(2);
      expect(updateCall.data.timeline[1].note).toBe('Test note');
    });

    it('should throw NotFoundException if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addNote('nonexistent-id', 'Note', 'public', 'user-id-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addItem', () => {
    it('should add an item to order and recalculate', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderItem.create as jest.Mock).mockResolvedValue({
        id: 'new-item',
        productId: 'prod-2',
        quantity: 1,
        price: 500,
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.addItem('order-id-1', {
        productId: 'prod-2',
        quantity: 1,
        price: 500,
      });

      expect(prisma.orderItem.create).toHaveBeenCalled();
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addItem('nonexistent-id', {
          productId: 'prod-2',
          quantity: 1,
          price: 500,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeItem', () => {
    it('should remove an item from order and recalculate', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderItem.delete as jest.Mock).mockResolvedValue({
        id: 'item-id-1',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.removeItem('order-id-1', 'item-id-1');

      expect(prisma.orderItem.delete).toHaveBeenCalledWith({
        where: { id: 'item-id-1' },
      });
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.removeItem('nonexistent-id', 'item-id-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleReturnedSideEffects', () => {
    it('should call cancelReturnStock.restoreForOrder', async () => {
      const cancelReturnStock = module.get<CancelReturnStockService>(CancelReturnStockService);

      await (service as any).handleReturnedSideEffects(prisma, 'order-id-1');

      expect(cancelReturnStock.restoreForOrder).toHaveBeenCalledWith({
        orderId: 'order-id-1',
        referencePrefix: 'return',
        performedBy: undefined,
        tx: prisma,
      });
    });
  });

  describe('buildAndSendPurchaseEvent', () => {
    const captureService = () =>
      module.get<TrackingCaptureService>(TrackingCaptureService);

    const baseOrder = {
      id: 'order-id-1',
      customerId: 'customer-id-1',
      total: 2050,
      createdAt: new Date('2025-01-15'),
      salesChannel: 'WEBSITE',
      customer: {
        id: 'customer-id-1',
        name: 'John Doe',
        firstName: 'John Doe',
        lastName: '',
        email: 'john@example.com',
        phoneNumber: '+1234567890',
      },
      items: [
        {
          id: 'item-id-1',
          productId: 'prod-1',
          quantity: 2,
          price: 1000,
        },
      ],
    };

    it('captures a Purchase snapshot with eventId/payload/ctxId and no legacy track', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        { ...baseOrder, trackingSessionId: 'ctx-123' },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      const [input] = capture.mock.calls[0];
      expect(input.eventId).toBe('purchase_order-id-1');
      expect(input.eventType).toBe('Purchase');
      expect(input.orderId).toBe('order-id-1');
      expect(input.ctxId).toBe('ctx-123');
      expect(input.actionSource).toBe('website');
      expect(input.eventTime).toBe(
        Math.floor(new Date('2025-01-15').getTime() / 1000),
      );
      expect(input.payload).toEqual(
        expect.objectContaining({
          value: 2050,
          currency: 'BDT',
          content_ids: ['prod-1'],
          num_items: 2,
          orderId: 'order-id-1',
          contents: [
            { id: 'prod-1', quantity: 2, item_price: 1000 },
          ],
          customer: {
            email: 'john@example.com',
            phone: '+1234567890',
            firstName: 'John Doe',
            lastName: undefined,
            city: undefined,
            country: 'BD',
          },
        }),
      );
      expect(input.configSnapshot).toEqual(
        expect.objectContaining({
          enabledProviders: ['meta'],
          normalizerVersion: 1,
        }),
      );
      expect((capture.mock.calls[0] as any[])[1]).toBeUndefined();
    });

    it('degrades gracefully when order has no trackingSessionId (ctxId undefined)', async () => {
      await (service as any).buildAndSendPurchaseEvent(baseOrder, 'instant');

      const capture = captureService().capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].ctxId).toBeUndefined();
    });

    it('passes a supplied transaction client through to capture', async () => {
      const tx = { order: {} } as any;
      await (service as any).buildAndSendPurchaseEvent(
        { ...baseOrder, trackingSessionId: 'ctx-123' },
        'validated',
        tx,
      );

      const capture = captureService().capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      expect((capture.mock.calls[0] as any[])[1]).toBe(tx);
    });

    it('includes shipping state/zip as EMQ match keys (Wave-2.5)', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          shippingAddress: { city: 'Dhaka', state: 'Dhaka Division', zipCode: '1212' },
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.customer).toMatchObject({
        city: 'Dhaka',
        state: 'Dhaka Division',
        zip: '1212',
        country: 'BD',
      });
    });

    it('falls back to storefront aliases (division/postalCode) for state and zip', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          shippingAddress: { division: 'Chattogram', postalCode: '4000' },
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.customer).toMatchObject({
        state: 'Chattogram',
        zip: '4000',
      });
    });

    it('uses the configured currency from the capture-time config snapshot', async () => {
      const settings =
        module.get<TrackingSettingsService>(TrackingSettingsService);
      (settings.buildConfigSnapshot as jest.Mock).mockResolvedValueOnce({
        enabledProviders: ['meta'],
        normalizerVersion: 1,
        capturedAt: '2025-01-15T00:00:00.000Z',
        currency: 'USD',
      });

      await (service as any).buildAndSendPurchaseEvent(
        { ...baseOrder, trackingSessionId: 'ctx-123' },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.currency).toBe('USD');
    });

    it('lazily resolves the division from the district for historical orders without one', async () => {
      // No `division` stored — old order, district only. The resolver must
      // derive the division at capture time (spec §21, §22: st = division).
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          shippingAddress: { district: "Cox's Bazar", postalCode: '4700' },
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.customer).toMatchObject({
        city: "Cox's Bazar",
        state: 'Chittagong',
        zip: '4700',
        country: 'BD',
      });
    });

    it('keeps an explicitly stored division authoritative (no re-resolution)', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          shippingAddress: {
            district: 'Dhaka',
            division: 'Rangpur', // stored value wins — canonical, not re-derived
          },
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.customer.state).toBe('Rangpur');
    });

    it('maps a CALL-channel order purchase to action_source phone_call via the resolver', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          salesChannel: 'OFFLINE',
          sourcePlatform: 'PHONE',
          sourceType: 'CALL',
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.actionSource).toBe('phone_call');
    });

    it('maps a WhatsApp-chat offline order purchase to action_source chat via the resolver', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          salesChannel: 'OFFLINE',
          sourcePlatform: 'WHATSAPP',
          sourceType: 'CHAT',
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.actionSource).toBe('chat');
    });

    it('maps content_name/content_category from the first line item', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          items: [
            {
              id: 'item-id-1',
              productId: 'prod-1',
              quantity: 1,
              price: 500,
              product: {
                id: 'prod-1',
                name: 'Organic Rice',
                category: { name: 'Groceries' },
              },
            },
          ],
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.content_name).toBe('Organic Rice');
      expect(input.payload.content_category).toBe('Groceries');
    });

    it('falls back to the combo name when the first line item is a combo', async () => {
      await (service as any).buildAndSendPurchaseEvent(
        {
          ...baseOrder,
          items: [
            {
              id: 'item-id-1',
              comboId: 'combo-1',
              quantity: 1,
              price: 900,
              combo: { id: 'combo-1', name: 'Starter Pack' },
            },
          ],
        },
        'instant',
      );

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.payload.content_name).toBe('Starter Pack');
      expect(input.payload.content_ids).toEqual(['combo-1']);
    });
  });

  describe('fireRefundEvent', () => {
    const captureService = () =>
      module.get<TrackingCaptureService>(TrackingCaptureService);

    const refundOrder = {
      id: 'order-id-1',
      trackingSessionId: 'ctx-123',
      total: 2050,
      salesChannel: 'WEBSITE',
      customer: {
        firstName: 'John Doe',
        phoneNumber: '+1234567890',
      },
      items: [
        { id: 'item-id-1', productId: 'prod-1', quantity: 2, price: 1000 },
      ],
    };

    it('captures a Refund snapshot with negative value and no legacy track', async () => {
      await (service as any).fireRefundEvent(refundOrder);

      const capture = captureService().capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      const [input] = capture.mock.calls[0];
      expect(input.eventId).toBe('refund_order-id-1');
      expect(input.eventType).toBe('Refund');
      expect(input.orderId).toBe('order-id-1');
      expect(input.ctxId).toBe('ctx-123');
      expect(input.actionSource).toBe('website');
      expect(input.payload).toEqual(
        expect.objectContaining({
          value: -2050,
          currency: 'BDT',
          content_ids: ['prod-1'],
          num_items: 2,
          orderId: 'order-id-1',
          contents: [{ id: 'prod-1', quantity: 2, item_price: 1000 }],
          customer: {
            phone: '+1234567890',
            firstName: 'John Doe',
            country: 'BD',
          },
        }),
      );
    });

    it('degrades gracefully when order has no trackingSessionId', async () => {
      await (service as any).fireRefundEvent({
        ...refundOrder,
        trackingSessionId: null,
      });

      const capture = captureService().capture as jest.Mock;
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].ctxId).toBeUndefined();
    });

    it('skips capture when refunds are disabled', async () => {
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'tracking_refund_enabled',
        value: 'false',
      });

      await (service as any).fireRefundEvent(refundOrder);

      expect(captureService().capture).not.toHaveBeenCalled();
    });

    it('uses the action_source resolver for offline chat refunds', async () => {
      await (service as any).fireRefundEvent({
        ...refundOrder,
        salesChannel: 'OFFLINE',
        sourcePlatform: 'WHATSAPP',
        sourceType: 'CHAT',
      });

      const capture = captureService().capture as jest.Mock;
      const [input] = capture.mock.calls[0];
      expect(input.eventType).toBe('Refund');
      expect(input.actionSource).toBe('chat');
    });
  });

  describe('bulkOrders', () => {
    it('normalizes customer name/phone and shipping address via transformOrder', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'order-1',
          displayId: 'ORD-250115-0001',
          createdAt: new Date('2025-01-15'),
          total: 2050,
          shippingCharge: 100,
          guestName: 'Guest Buyer',
          guestPhone: '+8801712345678',
          shippingAddress: {
            district: 'Dhaka',
            thana: 'Mirpur',
            addressLine: 'House 12, Road 5',
          },
          customer: {
            id: 'cust-1',
            name: 'John Doe',
            email: 'john@example.com',
            phone: '+8801711111111',
          },
          status: { name: 'Pending' },
          items: [
            {
              id: 'item-1',
              productId: 'prod-1',
              quantity: 1,
              price: 1000,
              product: { id: 'prod-1', name: 'Test Product', images: [] },
            },
          ],
        },
      ]);

      const result = await service.bulkOrders(['order-1']);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['order-1'] } } }),
      );
      const order = result[0] as any;
      // transformOrder maps single-name customer to firstName/phoneNumber
      expect(order.customer.firstName).toBe('John Doe');
      expect(order.customer.phoneNumber).toBe('+8801711111111');
      // shippingAddress gains an address key derived from addressLine
      expect(order.shippingAddress.address).toBe('House 12, Road 5');
      // guest fields remain for template fallback
      expect(order.guestName).toBe('Guest Buyer');
      expect(order.guestPhone).toBe('+8801712345678');
    });
  });
});
