import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersEventService } from './orders-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingCaptureService } from '../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../tracking/tracking-settings.service';
import { TrackingContextService } from '../tracking/tracking-context.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerAddressService } from '../customers/customer-address.service';
import { SalesChannelService } from '../sales-channel/sales-channel.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { SecurityService } from '../security/security.service';
import { CouponsService } from '../coupons/coupons.service';
import { ManagedStockLedgerService } from '../inventory/managed-stock-ledger.service';
import { CostingLotService } from '../stock/costing-lot.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';
import { CustomizationService } from '../customization/customization.service';
import { OrderStockDeductService } from '../stock/order-stock-deduct.service';
import { OrderEditLockService } from './order-edit-lock.service';
import { CommissionsService } from '../commissions/commissions.service';
import { DiscountsService } from '../discounts/discounts.service';
import { TrackingEligibilityGate } from '../tracking/tracking-eligibility-gate';
import { CacheService } from '../cache/cache.service';

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
              // F24: order-level verify flips every PENDING row to PAID in the
              // same transaction, then re-reads the order.
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              count: jest.fn().mockResolvedValue(0),
              // Task 9 (D5) cancel gate: netPaid side of outstanding.
              aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
            },
            // Task 9 (D5) cancel gate: legacy-refund side of outstanding
            // (approved/completed rows with method NULL). Default 0 so every
            // pre-existing cancel test sees a settled order and passes through.
            refund: {
              aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
            },
            customerProfile: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              upsert: jest.fn().mockResolvedValue({ id: 'customer-id-1' }),
              update: jest.fn().mockResolvedValue({ id: 'customer-id-1' }),
              create: jest.fn().mockResolvedValue({ id: 'customer-id-1' }),
              // Race-safe latest-order telemetry write (conditional updateMany).
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
            // Journey-session fallback for the attribution snapshot. No session
            // is the common test case → null.
            marketingSession: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
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
            trackingSnapshot: {
              findUnique: jest.fn(),
            },
            trackingOutbox: {
              findUnique: jest.fn(),
            },
            // Task 4 (Fix 8) exchange-Returned gate: child exchanges +
            // EXCHANGE return legs + exchange dispatches. Default EMPTY so
            // every pre-existing test sees an unlinked order and passes
            // straight through the gate.
            dispatch: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            return: {
              findMany: jest.fn().mockResolvedValue([]),
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
          provide: TrackingContextService,
          useValue: {
            getByCtxId: jest.fn().mockResolvedValue(null),
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
            getLinkedPhones: jest.fn().mockResolvedValue([]),
            linkPhones: jest.fn().mockImplementation(async (_id: string, phones: string[]) => phones),
            resolveCustomerIdByPhones: jest
              .fn()
              .mockResolvedValue({ customerId: null, conflicted: false }),
          },
        },
        {
          provide: CustomerAddressService,
          useValue: { syncFromOrder: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: SalesChannelService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({
              channel: null, channelEntity: null, sourceSlug: null,
              acquisitionType: null, warnings: [],
            }),
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
            releaseForCancellation: jest.fn().mockResolvedValue(undefined),
            restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
            holdReservationForReturnPending: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CustomizationService,
          useValue: new CustomizationService({ canUse: () => true } as any),
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
        {
          provide: TrackingEligibilityGate,
          useValue: {
            checkOrderEvent: jest.fn().mockResolvedValue({
              eligible: true,
              category: 'DIRECT_WEBSITE',
              configKey: 'tracking_send_website_orders',
              configValue: true,
              reason: 'Order source "DIRECT_WEBSITE" is eligible for tracking',
              metadata: {},
            }),
            isOrderEligible: jest.fn().mockResolvedValue(true),
            requireEligible: jest.fn().mockResolvedValue({
              eligible: true,
              category: 'DIRECT_WEBSITE',
              configKey: 'tracking_send_website_orders',
              configValue: true,
              reason: 'Order source "DIRECT_WEBSITE" is eligible for tracking',
              metadata: {},
            }),
          },
        },
        {
          // @Optional() on the service: pre-existing tests run without
          // it (auto skipped). Default-zero keeps them identical, while
          // coupon tests below override the evaluation per case.
          provide: DiscountsService,
          useValue: {
            evaluateForCart: jest.fn().mockResolvedValue({
              autoDiscount: 0,
              lines: [],
              byDiscount: [],
              subtotal: 0,
              skipped: [],
            }),
          },
        },
        {
          provide: CacheService,
          useValue: {
            invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
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
    it('should return paginated orders', async () => {      (prisma.order.findMany as jest.Mock).mockResolvedValue([mockOrder]);
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

    it('allows 1000-row pages but clamps anything larger', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);
      (prisma.order.groupBy as jest.Mock).mockResolvedValue([]);

      const atCap = await service.findAll({ page: 1, perPage: 1000 });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1000 }),
      );
      expect(atCap.meta.perPage).toBe(1000);

      const overCap = await service.findAll({ page: 1, perPage: 5000 });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1000 }),
      );
      expect(overCap.meta.perPage).toBe(1000);
    });

    it('falls back to page 1 on garbage page input', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);
      (prisma.order.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll({ page: NaN } as any);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
      expect(result.meta.page).toBe(1);
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
                returnOfOrder: {
                  displayId: { contains: 'ORD-25', mode: 'insensitive' },
                },
              },
              {
                courierConsignmentId: { contains: 'ORD-25', mode: 'insensitive' },
              },
              {
                courierTrackingCode: { contains: 'ORD-25', mode: 'insensitive' },
              },
              {
                customer: {
                  name: { contains: 'ORD-25', mode: 'insensitive' },
                },
              },
              { guestName: { contains: 'ORD-25', mode: 'insensitive' } },
              {
                items: {
                  some: {
                    OR: [
                      {
                        variant: {
                          sku: { contains: 'ORD-25', mode: 'insensitive' },
                        },
                      },
                      {
                        product: {
                          sku: { contains: 'ORD-25', mode: 'insensitive' },
                        },
                      },
                    ],
                  },
                },
              },
            ],
            statusId: 'status-pending',
            trashedAt: null,
            kind: { not: 'RETURN' },
          },
        }),
      );
    });

    it('should match a phone number by equality when the search is a full number', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ search: '01712121213', page: 1, perPage: 10 });

      const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          {
            customer: {
              phone: {
                in: [
                  '+8801712121213',
                  '8801712121213',
                  '01712121213',
                  '1712121213',
                ],
              },
            },
          },
          {
            guestPhone: {
              in: [
                '+8801712121213',
                '8801712121213',
                '01712121213',
                '1712121213',
              ],
            },
          },
        ]),
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

    it('excludes RETURN-kind orders by default (Returns live in their own menu)', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});

      const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.kind).toEqual({ not: 'RETURN' });
    });

    it('supports kind=EXCHANGE and includes the original-order link', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ kind: 'EXCHANGE' } as any);

      const args = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.kind).toBe('EXCHANGE');
      expect(args.include.exchangeOfOrder).toEqual(
        expect.objectContaining({ select: expect.anything() }),
      );
    });
  });

  describe('findOne', () => {
    it('should return an order by id when a matching token is provided', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        customerFirstName: 'John',
        customerLastName: 'Doe',
        customerPhone: '+1234567890',
        customerEmail: 'john@example.com',
      });

      const result = await service.findOne('order-id-1', {
        token: 'mock-view-token',
      });

      expect(prisma.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-id-1' } }),
      );
      // D-A: customer is built from the snapshot (stale profile ignored).
      // F26: a token view is the non-admin path — internal relations
      // (payments, dispatchLogs, assignee, returns, exchange) are deleted
      // before the transform and the timeline is the public allowlist
      // (status/timestamp/note only — no actor source to attribute).
      const { payments: _payments, ...publicOrder } = mockOrder;
      expect(result).toEqual({
        ...publicOrder,
        timeline: [{ ...mockOrder.timeline[0] }],
        customerFirstName: 'John',
        customerLastName: 'Doe',
        customerPhone: '+1234567890',
        customerEmail: 'john@example.com',
        customer: {
          id: 'customer-id-1',
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+1234567890',
        },
      });
    });

    it('attaches a derived source to every timeline entry (staff / courier / system)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        timeline: [
          { status: 'Pending', timestamp: new Date().toISOString(), note: 'Order created' },
          { type: 'courier', courier: 'pathao', status: 'DISPATCHED', timestamp: new Date().toISOString() },
          { type: 'note', performedBy: 'staff@shop.com', note: 'called customer', timestamp: new Date().toISOString() },
          { type: 'note', performedBy: 'System', note: 'auto', timestamp: new Date().toISOString() },
        ],
      });

      // F26: source attribution is a STAFF feature — the non-admin
      // token path redacts the timeline. Read it as staff (token + admin
      // still authorizes; the valid token skips the edit-lock gate).
      const result = await service.findOne('order-id-1', {
        token: 'mock-view-token',
        role: 'admin',
      });

      expect(result.timeline.map((t: any) => t.source)).toEqual([
        'system',
        'courier',
        'staff',
        'system',
      ]);
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

    describe('exchangeOfOrder (exchange parent snapshot)', () => {
      const exchangeChildOrder = () => ({
        ...mockOrder,
        kind: 'EXCHANGE',
        exchangeOfOrderId: 'orig-1',
        exchangeOfOrder: {
          id: 'orig-1',
          displayId: 'ORD-250101-0001',
          kind: 'ORDER',
          subtotal: 2000,
          shippingCharge: 100,
          discount: 50,
          discountType: 'flat',
          total: 2050,
          status: { id: 'st-1', name: 'Shipped', color: '#2ecc71' },
          items: [
            {
              productId: 'prod-1',
              variantId: 'variant-1',
              quantity: 2,
              price: 1000,
              product: {
                id: 'prod-1',
                name: 'Original Tee M',
                sku: 'TEE-M',
                images: ['a.jpg'],
              },
              variant: { id: 'variant-1', sku: 'TEE-M', image: 'a.jpg', images: ['a.jpg'] },
            },
          ],
        },
      });

      it('staff viewer sees the exchangeOfOrder snapshot with line items', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(
          exchangeChildOrder(),
        );

        const result = await service.findOne('order-id-1', {
          userId: 'user-a',
          role: 'admin',
        });

        // The include itself is pinned: the staff shape must request the
        // snapshot (the resolved fixture alone would pass even without it).
        const args = (prisma.order.findUnique as jest.Mock).mock.calls.at(-1)[0];
        expect(args.include.exchangeOfOrder).toEqual(
          expect.objectContaining({
            select: expect.objectContaining({ items: expect.anything() }),
          }),
        );

        expect(result.exchangeOfOrder.displayId).toBe('ORD-250101-0001');
        expect(result.exchangeOfOrder.items[0].product.name).toBe(
          'Original Tee M',
        );
        expect(result.exchangeOfOrder.items[0].quantity).toBe(2);
      });

      it('strips exchangeOfOrder from the customer/public token shape', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(
          exchangeChildOrder(),
        );

        const result = await service.findOne('order-id-1', {
          token: 'mock-view-token',
        });

        expect(result).not.toHaveProperty('exchangeOfOrder');
        expect(JSON.stringify(result)).not.toContain('Original Tee M');
      });
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
    // Coupon + automatic-discount agreement (Combine-OFF stacking fix):
    // the order must record exactly what the settled checkout display
    // shows. A suppressed (Combine-OFF) rule contributes zero, so the
    // coupon % falls on the RAW subtotal; a combining rule keeps its
    // auto amount, so the coupon % falls on the post-automatic base.
    // Live numbers: 2 x 34.99 = 69.98; suppressed -> coupon 6.998,
    // total 62.982 (+ shipping); combining (auto 10.50) -> coupon
    // 5.948, total 53.532 (+ shipping).
    const couponRow = {
      id: 'coupon-1',
      isActive: true,
      type: 'percentage',
      value: 10,
      minOrderValue: null,
      percentageCap: null,
      maxUses: null,
      usedCount: 0,
      maxUsesPerCustomer: null,
      expiresAt: null,
      startsAt: null,
    };
    const setupCouponOrder = async (autoEval: any) => {
      const discountsMock = module.get(DiscountsService) as any;
      (discountsMock.evaluateForCart as jest.Mock).mockResolvedValue(
        autoEval,
      );
      // Order creation resolves the line price server-side from the
      // variant (variant.price wins over the DTO price), so pin the
      // variant price to 34.99 to reproduce the live 2 x 34.99 = 69.98
      // cart; stock fields stay as the default mock provides them.
      (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'variant-1',
          price: 34.99,
          salePrice: null,
          isActive: true,
          productId: 'prod-1',
          managedStockQuantity: 10,
          reservedStock: 0,
        },
      ]);
      (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(
        async (sql: string) =>
          String(sql).includes('"Coupon"') ? [couponRow] : [],
      );
      (prisma as any).couponUsage = { create: jest.fn() };
      (prisma as any).discountApplication = { create: jest.fn() };
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-pending',
        name: 'Pending',
        nextStatuses: [],
      });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        items: [],
      });
      await service.create({
        items: [{ variantId: 'variant-1', quantity: 2, price: 34.99 }],
        shippingAddress: { address: '123 Test St' },
        couponCode: 'TESTAUDIT10',
      } as any);
      const data = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      const couponUsage =
        ((prisma as any).couponUsage.create as jest.Mock).mock.calls[0]?.[0]
          ?.data;
      return { data, couponUsage };
    };

    it('coupon replaces a suppressed (Combine-OFF) auto discount and is computed on the raw subtotal', async () => {
      const { data, couponUsage } = await setupCouponOrder({
        autoDiscount: 0,
        lines: [],
        byDiscount: [],
        subtotal: 69.98,
        skipped: [
          {
            discountId: 'd-v2',
            discountTitle: 'TEST-VERIFY V2 Discount',
            reason: 'coupon-present',
          },
        ],
      });
      expect(data.subtotal).toBeCloseTo(69.98, 2);
      expect(data.autoDiscount).toBe(0);
      expect(data.discount).toBe(10);
      expect(data.discountType).toBe('percentage');
      // 10% of the RAW subtotal (auto suppressed -> base is raw).
      expect(couponUsage.discount).toBeCloseTo(6.998, 2);
      expect(data.total).toBeCloseTo(
        data.subtotal + data.shippingCharge - 6.998,
        2,
      );
    });

    it('coupon stacks on the post-automatic base when the rule combines', async () => {
      const { data, couponUsage } = await setupCouponOrder({
        autoDiscount: 10.5,
        lines: [],
        byDiscount: [{ discountId: 'd-v2', amount: 10.5 }],
        subtotal: 69.98,
        skipped: [],
      });
      expect(data.subtotal).toBeCloseTo(69.98, 2);
      expect(data.autoDiscount).toBe(10.5);
      expect(data.discount).toBe(10);
      expect(data.discountType).toBe('percentage');
      // 10% of the POST-automatic base (69.98 - 10.50 = 59.48).
      expect(couponUsage.discount).toBeCloseTo(5.948, 2);
      expect(data.total).toBeCloseTo(
        data.subtotal + data.shippingCharge - 10.5 - 5.948,
        2,
      );
    });

    it('accepts a variant-only line item by resolving its parent product', async () => {
      // Regression: productIds was built solely from item.productId, so a line
      // carrying only a variantId never loaded its parent and the order was
      // rejected with "Parent product for variant X not found".
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-pending',
        name: 'Pending',
        nextStatuses: [],
      });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        items: [],
      });
      // Make the parent lookup deterministic: only prod-1 comes back.
      (prisma.product.findMany as jest.Mock).mockImplementation(async (args: any) => {
        const ids = args?.where?.id?.in;
        if (Array.isArray(ids)) {
          return [
            {
              id: 'prod-1', basePrice: 1000, salePrice: null, isActive: true,
              availabilityMode: 'MANAGED_STOCK', name: 'Prod 1', type: 'variable',
              managedStockQuantity: 10, reservedStock: 0,
            },
          ].filter((p) => ids.includes(p.id));
        }
        return [];
      });

      const res = await service.create({
        items: [{ variantId: 'variant-1', quantity: 1, price: 1000 }],
        shippingAddress: { address: '123 Test St' },
      } as any);

      expect(res).toBeDefined();
      // The parent product must actually have been fetched for the variant.
      const variantOnlyCall = (prisma.product.findMany as jest.Mock).mock.calls.find(
        (c: any) => Array.isArray(c[0]?.where?.id?.in) && c[0].where.id.in.includes('prod-1'),
      );
      expect(variantOnlyCall).toBeDefined();
    });

    it('customization: resolves the selection server-side, folds add-ons into the subtotal, freezes the snapshot (Q14/Q15)', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) =>
          cb({
            ...prisma,
            orderCounter: {
              upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-pending',
        name: 'Pending',
        nextStatuses: [],
      });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        ...mockOrder,
        items: [],
      });
      (prisma.product.findMany as jest.Mock).mockImplementation(async (args: any) => {
        // The ALWAYS_OUT_OF_STOCK pre-guard queries with an availabilityMode
        // filter — the wallet is orderable, so that query finds nothing.
        if (args?.where?.availabilityMode) return [];
        return [
        {
          id: 'prod-wallet', basePrice: 700, salePrice: null, isActive: true,
          availabilityMode: 'MANAGED_STOCK', name: 'Wallet', type: 'simple',
          managedStockQuantity: 10, reservedStock: 0,
          customizations: [
            {
              key: 'engraving', label: 'Engraving', type: 'single', required: false,
              options: [
                { key: 'gold', label: 'Gold Foil', priceDelta: 120, costDelta: 40, pricingKind: 'per_unit' },
              ],
            },
            {
              key: 'extras', label: 'Extras', type: 'multi', required: false,
              options: [
                { key: 'gift_box', label: 'Gift Box', priceDelta: 80, costDelta: 30, pricingKind: 'per_line' },
              ],
            },
          ],
        },
        ];
      });

      await service.create({
        items: [
          {
            productId: 'prod-wallet',
            quantity: 1,
            price: 700,
            customization: {
              groups: [
                { key: 'engraving', optionKeys: ['gold'] },
                { key: 'extras', optionKeys: ['gift_box'] },
              ],
            },
          },
        ],
        shippingAddress: { address: '123 Test St' },
      } as any);

      const createArgs = (prisma.order.create as jest.Mock).mock.calls[0][0];
      // Base 700 + gold 120 + box 80 folded into the subtotal (Q14).
      expect(Number(createArgs.data.subtotal)).toBe(900);
      const line = createArgs.data.items.create[0];
      expect(Number(line.addonAmount)).toBe(200);
      expect(Number(line.addonCostAmount)).toBe(70);
      expect(line.customization.groups).toHaveLength(2);
      expect(line.customization.groups[0].options[0].label).toBe('Gold Foil');
    });

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

    it('records the creator in the order timeline (staff email, or Customer for guests)', async () => {
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

      // Staff create → staff email recorded
      await service.create(createOrderDto, '10.0.0.9', {
        userId: 'staff-1',
        email: 'staff@shop.com',
        role: 'admin',
      });
      let data = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(data.timeline[0].performedBy).toBe('staff@shop.com');
      expect(data.timeline[0].status).toBe(mockInitialStatus.name);

      // Guest storefront order → 'Customer'
      (prisma.order.create as jest.Mock).mockClear();
      await service.create(createOrderDto, undefined, undefined);
      data = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(data.timeline[0].performedBy).toBe('Customer');
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

    describe('secondary phone linking', () => {
      const staff = { userId: 'admin-1', role: 'admin' };

      it('stores the secondary phone and links it on staff create', async () => {
        runTx();
        const dto = { ...makeGuestDto(), secondaryPhone: '01800000002' };

        await service.create(dto, '10.0.0.1', staff);

        expect(prisma.order.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ secondaryPhone: '+8801800000002' }),
          }),
        );
        expect(customers.linkPhones).toHaveBeenCalledWith(
          'customer-id-1',
          ['+8801800000002'],
          'secondary',
        );
      });

      it('refuses a secondary number owned by another customer (409, no merge)', async () => {
        runTx();
        (customers.linkPhones as jest.Mock).mockRejectedValueOnce(
          new ConflictException('This phone number is already linked to another customer.'),
        );

        await expect(
          service.create({ ...makeGuestDto(), secondaryPhone: '01800000003' }, '10.0.0.1', staff),
        ).rejects.toThrow(ConflictException);
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it('guest drops a conflicting secondary instead of merging strangers', async () => {
        runTx();
        (customers.linkPhones as jest.Mock).mockRejectedValueOnce(
          new ConflictException('This phone number is already linked to another customer.'),
        );

        await service.create(
          { ...makeGuestDto(), secondaryPhone: '01800000003' },
          undefined,
        );

        expect(prisma.order.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ secondaryPhone: null }),
          }),
        );
      });

      it('hard-blocks guests on a blocked secondary number', async () => {
        runTx();
        (blockedEntries.findBlockedPhone as jest.Mock).mockImplementation(
          async (phone: string) =>
            phone === '+8801800000004' ? { id: 'phone-block-2' } : null,
        );

        await expect(
          service.create({ ...makeGuestDto(), secondaryPhone: '01800000004' }, undefined),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.order.create).not.toHaveBeenCalled();
      });

      it('warns (not blocks) staff on a blocked secondary number', async () => {
        runTx();
        (blockedEntries.findBlockedPhone as jest.Mock).mockImplementation(
          async (phone: string) =>
            phone === '+8801800000004' ? { id: 'phone-block-2' } : null,
        );

        const result = await service.create(
          { ...makeGuestDto(), secondaryPhone: '01800000004' },
          '10.0.0.1',
          staff,
        );

        expect(prisma.order.create).toHaveBeenCalled();
        expect((result as any).warnings).toContain(
          'This phone number is blocked for storefront ordering.',
        );
      });
    });

    describe('staff identity isolation (customer snapshot)', () => {
      const staffUser = {
        userId: 'staff-1',
        role: 'admin',
        firstName: 'StaffFirst',
        lastName: 'StaffLast',
        email: 'staff@shop.com',
        phoneNumber: '01999999999',
      };
      const linkedCustomerProfile = {
        status: 'active',
        phoneNumber: '01711111111',
        firstName: 'Rahim',
        lastName: 'Customer',
        email: 'rahim@example.com',
      };

      it('never writes the staff last name when the customer name is a single word', async () => {
        runTx();
        (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(
          linkedCustomerProfile,
        );

        await service.create(
          {
            ...makeGuestDto(),
            customerId: 'customer-id-1',
            guestName: 'Rahim',
            guestEmail: undefined,
          },
          '10.0.0.3',
          staffUser,
        );

        const data = (prisma.order.create as jest.Mock).mock.calls[0][0]
          .data;
        expect(data.customerId).toBe('customer-id-1');
        expect(data.customerFirstName).toBe('Rahim');
        // Linked customer profile wins — staff identity must not leak.
        expect(data.customerLastName).toBe('Customer');
        expect(data.customerLastName).not.toBe('StaffLast');
        expect(data.customerEmail).toBe('rahim@example.com');
        expect(data.customerEmail).not.toBe('staff@shop.com');
      });

      it('falls back to null (not staff data) when neither DTO nor customer profile has the field', async () => {
        runTx();
        (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
          status: 'active',
          phoneNumber: null,
          firstName: null,
          lastName: null,
          email: null,
        });

        await service.create(
          {
            ...makeGuestDto(),
            customerId: 'customer-id-1',
            guestName: undefined,
            guestPhone: undefined,
            guestEmail: undefined,
          },
          '10.0.0.4',
          staffUser,
        );

        const data = (prisma.order.create as jest.Mock).mock.calls[0][0]
          .data;
        expect(data.customerFirstName).toBeNull();
        expect(data.customerLastName).toBeNull();
        expect(data.customerEmail).toBeNull();
        expect(data.customerPhone).toBeNull();
      });

      it('still uses the actor identity for a storefront customer placing their own order', async () => {
        runTx();
        (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(
          linkedCustomerProfile,
        );
        const customerUser = {
          userId: 'customer-id-1',
          role: 'customer',
          firstName: 'Rahim',
          lastName: 'Customer',
          email: 'rahim@example.com',
          phoneNumber: '01711111111',
        };

        await service.create(
          {
            ...makeGuestDto(),
            customerId: undefined,
            guestName: undefined,
            guestPhone: undefined,
            guestEmail: undefined,
            items: [{ productId: 'prod-1', quantity: 1, price: 500 }],
          },
          undefined,
          customerUser,
        );

        const data = (prisma.order.create as jest.Mock).mock.calls[0][0]
          .data;
        // Authenticated customer is locked to their own identity.
        expect(data.customerId).toBe('customer-id-1');
        expect(data.customerFirstName).toBe('Rahim');
        expect(data.customerLastName).toBe('Customer');
        expect(data.customerEmail).toBe('rahim@example.com');
      });
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
      ).toBe('Override default-note');
    });

    it('respects staff manual shipping charge override on order creation', async () => {
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
      (prisma.systemSetting.findUnique as jest.Mock).mockImplementation(
        async ({ where: { key } }) => {
          if (key === 'delivery_charge') return { value: '60' };
          return null;
        },
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      // Staff specifies shippingCharge = 120 (differing from default 60)
      await service.create(
        { ...createOrderDto, shippingCharge: 120 },
        undefined,
        { userId: 'staff-1', role: 'admin' },
      );

      const createdData = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.shippingCharge).toBe(120);
      expect(createdData.shippingChargeOverridden).toBe(true);
    });

    describe('derived shipping charge (auto_district max rule)', () => {
      const ZONES = [
        { id: 'z1', type: 'custom_amount', amount: 150, districts: ['Dhaka'], isActive: true },
      ];
      const MAP = { Sylhet: 100 };

      const runDeriveTx = (zones: any[], settings: Record<string, string | null>) => {
        (prisma.$transaction as jest.Mock).mockImplementation(
          async (cb: (tx: any) => Promise<any>) =>
            cb({
              ...prisma,
              orderCounter: {
                upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
              },
              shippingZoneGroup: {
                findMany: jest.fn().mockResolvedValue(zones),
              },
            }),
        );
        (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
          mockInitialStatus,
        );
        (prisma.systemSetting.findUnique as jest.Mock).mockImplementation(
          async ({ where: { key } }: any) => {
            const v = settings[key];
            return v == null ? null : { value: v };
          },
        );
        (prisma.order.create as jest.Mock).mockResolvedValue({ ...mockOrder });
        (prisma.productVariant.update as jest.Mock).mockResolvedValue({
          id: 'variant-1',
          stock: 8,
        });
      };

      const guestDeriveDto = (over: any = {}) => {
        const { shippingCharge, ...rest } = createOrderDto as any;
        return {
          ...rest,
          customerId: undefined,
          guestPhone: '01712345678',
          guestName: 'Guest Buyer',
          ...over,
        };
      };

      const createdShipping = () =>
        (prisma.order.create as jest.Mock).mock.calls[0][0].data.shippingCharge;

      const SETTINGS = {
        delivery_charge: '60',
        free_delivery_min: null,
        district_charges: JSON.stringify(MAP),
      };

      it('charges the MAXIMUM configured amount when no district is given', async () => {
        runDeriveTx(ZONES, SETTINGS as any);
        const { district, ...noDistrict } = guestDeriveDto() as any;
        delete (noDistrict.shippingAddress as any)?.district;
        await service.create(noDistrict);
        expect(createdShipping()).toBe(150);
      });

      it('charges the MAXIMUM for a district with no rule', async () => {
        runDeriveTx(ZONES, SETTINGS as any);
        await service.create(guestDeriveDto({ district: 'Barisal' }));
        expect(createdShipping()).toBe(150);
      });

      it('uses the district_charges map when no zone matches', async () => {
        runDeriveTx(ZONES, SETTINGS as any);
        await service.create(guestDeriveDto({ district: 'Sylhet' }));
        expect(createdShipping()).toBe(100);
      });

      it('prefers the zone over the district_charges map', async () => {
        runDeriveTx(ZONES, {
          ...SETTINGS,
          district_charges: JSON.stringify({ Dhaka: 80, Sylhet: 100 }),
        } as any);
        await service.create(guestDeriveDto({ district: 'Dhaka' }));
        expect(createdShipping()).toBe(150);
      });

      it('falls back to the default when nothing is configured', async () => {
        runDeriveTx([], { delivery_charge: '60', free_delivery_min: null } as any);
        const { district, ...noDistrict } = guestDeriveDto() as any;
        await service.create(noDistrict);
        expect(createdShipping()).toBe(60);
      });

      it('rejects an invalid district_charges JSON for an unmatched district', async () => {
        runDeriveTx(ZONES, {
          delivery_charge: '60',
          free_delivery_min: null,
          district_charges: '{oops',
        } as any);
        await expect(
          service.create(guestDeriveDto({ district: 'Barisal' })),
        ).rejects.toThrow(BadRequestException);
      });

      it('ignores an invalid district_charges JSON when no district is given', async () => {
        runDeriveTx(ZONES, {
          delivery_charge: '60',
          free_delivery_min: null,
          district_charges: '{oops',
        } as any);
        const { district, ...noDistrict } = guestDeriveDto() as any;
        await service.create(noDistrict);
        expect(createdShipping()).toBe(150);
      });
    });

    it('applies and saves manual discount when creating an order', async () => {
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
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create(
        { ...createOrderDto, discount: 50, discountType: 'flat' },
        undefined,
        { userId: 'staff-1', role: 'admin' },
      );

      const createdData = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.discount).toBe(50);
      expect(createdData.discountType).toBe('flat');
    });

    it('ignores guest-supplied manual discount and shipping charge (security 2026-10-25)', async () => {
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
      (prisma.systemSetting.findUnique as jest.Mock).mockImplementation(
        async ({ where: { key } }) => {
          if (key === 'delivery_charge') return { value: '60' };
          return null;
        },
      );
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      // No user context = guest checkout.
      await service.create({
        ...createOrderDto,
        discount: 100,
        discountType: 'percentage',
        shippingCharge: 0,
      });

      const createdData = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.discount).toBe(0);
      expect(createdData.shippingCharge).toBe(60);
    });

    it('records advance paid payment and sets PARTIAL_PAID for staff partial payment create', async () => {
      const createdPayments: any[] = [];
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
            payment: {
              create: jest.fn().mockImplementation((args) => {
                createdPayments.push(args.data);
                return Promise.resolve({ id: 'p-' + createdPayments.length, ...args.data });
              }),
            },
          }),
      );
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({});

      await service.create(
        {
          ...createOrderDto,
          paymentOptionType: 'PARTIAL_PAYMENT',
          partialAmount: 200,
          gatewayCode: 'bkash',
        },
        undefined,
        { userId: 'staff-1', role: 'admin' },
      );

      const createdData = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(createdData.paymentOptionType).toBe('PARTIAL_PAYMENT');
      expect(createdData.partialAmount).toBe(200);
      expect(createdData.paymentStatus).toBe('PARTIAL_PAID');

      // Verify advance payment is marked PAID
      expect(createdPayments[0]).toMatchObject({
        gatewayCode: 'bkash',
        amount: 200,
        status: 'PAID',
      });
      // D-C actuals-only ledger: the uncollected remainder is DERIVED
      // (total − ΣPAID), never a placeholder row — no second payment.
      expect(createdPayments).toHaveLength(1);
    });

    it('creates COD orders with NO placeholder payment row (due is derived)', async () => {
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

      // D-C: no cash/UNPAID placeholder — the courier collects against the
      // derived due, and settlement import writes the real PAID row later.
      expect(prisma.payment.create).not.toHaveBeenCalled();
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

    it('freezes ip, user-agent, resolved platform and signals into the order snapshot', async () => {
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

      await service.create(
        {
          ...createOrderDto,
          attribution: {
            utmSource: 'google',
            utmMedium: 'cpc',
            utmCampaign: 'brand_bd',
            gclid: 'Cj0KCQ',
          },
          trackingSessionId: 'ctx-1',
          device: { deviceType: 'mobile', timezone: 'Asia/Dhaka' },
        },
        '203.0.113.7',
        undefined,
        'Mozilla/5.0 (Linux; Android 14)',
      );

      const data = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(data.ipAddress).toBe('203.0.113.7');
      expect(data.userAgent).toBe('Mozilla/5.0 (Linux; Android 14)');
      expect(data.sourcePlatform).toBe('GOOGLE');
      expect(data.sourceType).toBe('AD');
      expect(data.source).toBe('ECOMMERCE');
      expect(data.attribution).toMatchObject({
        sessionToken: 'ctx-1',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (Linux; Android 14)',
        utm: { source: 'google', medium: 'cpc', campaign: 'brand_bd' },
        clickIds: { gclid: 'Cj0KCQ' },
        device: { deviceType: 'mobile', timezone: 'Asia/Dhaka' },
        resolved: { platform: 'GOOGLE', type: 'AD' },
      });
    });

    it('marks a staff-created order as MANUAL and never as a website order', async () => {
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

      await service.create(createOrderDto, '', {
        userId: 'staff-1',
        role: 'admin',
      });

      const data = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(data.source).toBe('MANUAL');
      // A counter entry carries no landing signals at all — the snapshot column
      // stays empty rather than storing an empty object.
      expect(data.attribution).toBeUndefined();
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
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      // OWNERSHIP: placing an order must NOT rewrite the canonical customer
      // profile. The order-time values live on the order snapshot columns; an
      // existing CustomerProfile is left completely untouched.
      expect(prisma.customerProfile.upsert).not.toHaveBeenCalled();
      expect(prisma.customerProfile.update).not.toHaveBeenCalled();
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

    it('rolls back the order transaction when Purchase capture DB write fails', async () => {
      // Simulate a DB failure during capture (e.g., tracking table constraint
      // violation). The order MUST NOT commit — the transaction must roll back
      // so that a committed order always has a durable Purchase intent.
      const txError = new Error('tracking table unavailable');
      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      const capture = trackingCapture.capture as jest.Mock;
      capture.mockRejectedValueOnce(txError);

      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
        mockInitialStatus,
      );
      (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({
        date: '250115',
        seq: 1,
      });
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

      await expect(
        service.create(
          {
            ...createOrderDto,
            trackingSessionId: 'ctx-123',
          },
          '127.0.0.1',
        ),
      ).rejects.toThrow('tracking table unavailable');
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

    it('allows Pending → Recall (call-center pre-confirmation)', async () => {
      const recallStatus = {
        id: 'status-recall',
        name: 'Recall',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        recallStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...mockOrder,
        statusId: 'status-recall',
        status: recallStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-recall', note: 'Called — no answer' },
        userId,
      );

      expect(result.statusId).toBe('status-recall');
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('allows Recall → No Response (retry also unanswered)', async () => {
      const recallOrder = {
        ...mockOrder,
        status: { id: 'status-recall', name: 'Recall' },
      };
      const noResponseStatus = {
        id: 'status-no-response',
        name: 'No Response',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(recallOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        noResponseStatus,
      );
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...recallOrder,
        statusId: 'status-no-response',
        status: noResponseStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});

      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-no-response', note: 'Second call — no answer' },
        userId,
      );

      expect(result.statusId).toBe('status-no-response');
    });

    it('rejects Confirmed → Recall (pre-confirmation pair is one-way)', async () => {
      const confirmedOrder = {
        ...mockOrder,
        status: { id: 'status-confirmed', name: 'Confirmed' },
      };
      const recallStatus = {
        id: 'status-recall',
        name: 'Recall',
        isInitial: false,
        nextStatuses: [],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(confirmedOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
        recallStatus,
      );

      await expect(
        service.updateStatus('order-id-1', { statusId: 'status-recall' }, userId),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
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

      it('rejects confirm when a MANAGED_STOCK product has no physical stock record (B4 claim)', async () => {
        (module.get<StockService>(StockService) as any).hasExistingPhysicalReservation =
          jest.fn().mockResolvedValue(false);
        (module.get<StockRouterService>(StockRouterService).resolve as jest.Mock)
          .mockImplementation((_mode: string, op: string) =>
            op === 'allocate'
              ? { ms: 'skip', pi: 'allocate' }
              : { ms: 'reserve', pi: 'skip' },
          );
        stubConfirmCommon(buildConfirmOrder({})); // warehouseId null, no PhysicalInventory

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-confirmed' },
            userId,
          ),
        ).rejects.toThrow(
          '"Test Product" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই।',
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

      it('rejects the generic Partial → Delivered path — RTN resolution is required', async () => {
        // Business rule change (RTN feature): the generic status machine no
        // longer allows staff to close a Partial order as Delivered. The
        // ONLY legitimate Partial → Delivered path is the RTN return-order
        // creation workflow (RtnService.createFromPartialOrder), which
        // performs it transactionally. This regression test locks the
        // removal (migration 20260930010000_rtn_return_orders + ORDER_TRANSITIONS).
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder);
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          deliveredStatus,
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-delivered', note: 'Remainder delivered' },
            userId,
          ),
        ).rejects.toThrow(/Cannot transition from "Partial" to "Delivered"/);

        expect(prisma.order.update).not.toHaveBeenCalled();
      });
    });

    describe('Delivered COD verification (delivery-tx regression)', () => {
      const shippingOrder = {
        ...mockOrder,
        statusId: 'status-shipping',
        status: { id: 'status-shipping', name: 'Shipping' },
      };
      const deliveredStatus = {
        id: 'status-delivered',
        name: 'Delivered',
        isInitial: false,
        nextStatuses: [],
      };
      const staffUserId = 'staff-user-id';
      const staffEmail = 'staff@example.com';
      const codPayment = {
        id: 'pay-cod-1',
        orderId: 'order-id-1',
        gatewayCode: 'cash',
        status: 'UNPAID',
      };

      function mockDeliveredTx() {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(shippingOrder);
        (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(
          deliveredStatus,
        );
        (prisma.order.update as jest.Mock).mockResolvedValue({
          ...shippingOrder,
          statusId: 'status-delivered',
          status: deliveredStatus,
          payments: [],
        });
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue(codPayment);
        (prisma.payment.update as jest.Mock).mockResolvedValue({
          ...codPayment,
          status: 'PAID',
          verifiedBy: staffUserId,
        });
        (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
          id: staffUserId,
          email: staffEmail,
          status: 'active',
        });
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
      }

      it('verifies COD cash as PAID with the staff user id (not the email) on Shipping→Delivered', async () => {
        mockDeliveredTx();

        const result = await service.updateStatus(
          'order-id-1',
          { statusId: 'status-delivered' },
          staffUserId,
          staffEmail,
        );

        expect(result.status.name).toBe('Delivered');
        expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
          where: { email: staffEmail },
          select: { id: true },
        });
        expect(prisma.payment.update).toHaveBeenCalledWith({
          where: { id: 'pay-cod-1' },
          data: {
            status: 'PAID',
            verifiedBy: staffUserId,
            verifiedAt: expect.any(Date),
          },
        });
      });

      it('propagates a delivery-tx failure instead of returning an unpersisted Delivered body', async () => {
        mockDeliveredTx();
        (prisma.payment.update as jest.Mock).mockRejectedValue(
          new Error('FK violation: Payment_verifiedBy_fkey'),
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-delivered' },
            staffUserId,
            staffEmail,
          ),
        ).rejects.toThrow('FK violation');
      });

      it('NEVER swallows a stock-deduction failure on Delivered (owner 2026-10-23)', async () => {
        mockDeliveredTx();
        const deduct = (service as any).orderStockDeduct.deductForOrder as jest.Mock;
        deduct.mockRejectedValueOnce(
          new Error('"X" এর Physical Reservation পাওয়া যায়নি'),
        );

        await expect(
          service.updateStatus(
            'order-id-1',
            { statusId: 'status-delivered' },
            staffUserId,
            staffEmail,
          ),
        ).rejects.toThrow('Physical Reservation');
        // Strict: a missing reservation/inventory must fail the delivery,
        // never degrade to a silent log line.
        expect(deduct).toHaveBeenCalledWith(
          expect.objectContaining({ strict: true }),
        );
      });

      it('resolves automated actors to a null verifier on Shipping→Delivered', async () => {
        mockDeliveredTx();

        const result = await service.updateStatus(
          'order-id-1',
          { statusId: 'status-delivered' },
          'system',
        );

        expect(result.status.name).toBe('Delivered');
        expect(prisma.payment.update).toHaveBeenCalledWith({
          where: { id: 'pay-cod-1' },
          data: {
            status: 'PAID',
            verifiedBy: null,
            verifiedAt: expect.any(Date),
          },
        });
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
      const purchaseCalls = capture.mock.calls.filter(
        ([input]: any[]) => input.eventType === 'Purchase',
      );
      expect(purchaseCalls).toHaveLength(1);
      const [input, txArg] = purchaseCalls[0];
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
      const purchaseCalls = capture.mock.calls.filter(
        ([input]: any[]) => input.eventType === 'Purchase',
      );
      expect(purchaseCalls).toHaveLength(1);
      const [input] = purchaseCalls[0];
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
      // (The Confirmed transition also emits OrderConfirmed — filtered out.)
      const purchaseCalls = capture.mock.calls.filter(
        ([input]: any[]) => input.eventType === 'Purchase',
      );
      expect(purchaseCalls).toHaveLength(1);
      expect(purchaseCalls[0][0].eventId).toBe('purchase_order-id-1');
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

      const allCalls = (trackingCapture.capture as jest.Mock).mock.calls;
      expect(
        allCalls.filter(([input]: any[]) => input.eventType === 'Purchase'),
      ).toHaveLength(1);
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

      // Confirmed ≠ configured Delivered → no validated Purchase (the
      // genuine Confirmed transition still emits its lifecycle event).
      expect(
        (trackingCapture.capture as jest.Mock).mock.calls.filter(
          ([input]: any[]) => input.eventType === 'Purchase',
        ),
      ).toHaveLength(0);
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

      // Confirmed ≠ configured Processing → no validated Purchase (the
      // genuine Confirmed transition still emits its lifecycle event).
      expect(
        (trackingCapture.capture as jest.Mock).mock.calls.filter(
          ([input]: any[]) => input.eventType === 'Purchase',
        ),
      ).toHaveLength(0);
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
      // Refund pairing gate: Purchase was captured and delivered (SENT).
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue({
        id: 'purchase-snap-1',
      });
      (prisma.trackingOutbox.findUnique as jest.Mock).mockResolvedValue({
        status: 'SENT',
      });

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      await service.updateStatus(
        'order-id-1',
        { statusId: 'status-cancelled', note: 'x' },
        userId,
      );

      const capture = trackingCapture.capture as jest.Mock;
      const refundCalls = capture.mock.calls.filter(
        ([input]: any[]) => input.eventType === 'Refund',
      );
      expect(refundCalls).toHaveLength(1);
      expect(refundCalls[0][0].eventId).toBe('refund_order-id-1');
      expect(refundCalls[0][0].eventType).toBe('Refund');
      expect(refundCalls[0][0].payload.value).toBe(-2050);
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

    it('allows a manual staff transition to Returned via find-or-create + guarded restore', async () => {
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
      // No linked return → the status change auto-creates ONE FULL return and
      // receives it through the guarded path (hardening 2 — no direct write).
      let createdReturn: any = null;
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([]);
      (prisma as any).return.create = jest.fn().mockImplementation(async ({ data }: any) => {
        createdReturn = { id: 'ret-auto', displayId: 'RTN-1', createdAt: new Date(), stockReconciled: false, ...data };
        return createdReturn;
      });
      (prisma as any).return.findUnique = jest.fn().mockImplementation(async () => createdReturn);
      (prisma as any).return.update = jest.fn().mockImplementation(async ({ data }: any) => {
        createdReturn = { ...createdReturn, ...data };
        return createdReturn;
      });
      (prisma as any).returnCounter = {
        upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
      };

      const cancelReturnStock = module.get<CancelReturnStockService>(
        CancelReturnStockService,
      );
      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-returned' },
        'staff-123',
      );

      expect(result.statusId).toBe('status-returned');
      expect((prisma as any).return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-id-1', type: 'FULL' }),
        }),
      );
      expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-id-1', returnId: 'ret-auto' }),
      );
      // The status change itself never writes stock directly.
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
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

    const walletDefinition = [
      {
        key: 'engraving', label: 'Engraving', type: 'single', required: false,
        options: [
          { key: 'gold', label: 'Gold Foil', priceDelta: 120, costDelta: 40, pricingKind: 'per_unit' },
          { key: 'plain', label: 'Plain Etch', priceDelta: 50, costDelta: 10, pricingKind: 'per_unit' },
        ],
      },
    ];
    const goldSnapshot = {
      groups: [
        {
          key: 'engraving', label: 'Engraving', type: 'single',
          options: [
            { key: 'gold', label: 'Gold Foil', priceDelta: 120, costDelta: 40, pricingKind: 'per_unit' },
          ],
        },
      ],
    };

    function packedCustomizedOrder() {
      return {
        ...mockOrder,
        status: { id: 'status-packed', name: 'Packed', nextStatuses: [] },
        items: [
          {
            id: 'item-1', productId: 'prod-wallet', variantId: null, comboId: null,
            quantity: 1, price: 700, customization: goldSnapshot,
            addonAmount: 120, addonCostAmount: 40,
            product: { id: 'prod-wallet', name: 'Wallet', availabilityMode: 'MANAGED_STOCK' },
          },
        ],
      };
    }

    it('Q19: changing customization on a Packed order is refused with ORDER_CUSTOMIZATION_LOCKED', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(packedCustomizedOrder());
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { id: 'prod-wallet', name: 'Wallet', customizations: walletDefinition },
      ]);
      await expect(
        service.updateOrder('order-id-1', {
          items: [
            {
              productId: 'prod-wallet', quantity: 1, price: 700,
              customization: { groups: [{ key: 'engraving', optionKeys: ['plain'] }] },
            },
          ],
        } as any),
      ).rejects.toMatchObject({ response: { code: 'ORDER_CUSTOMIZATION_LOCKED' } });
    });

    it('Q19: an unchanged customization round-trip on a Packed order is NOT blocked by the customization gate', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(packedCustomizedOrder());
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { id: 'prod-wallet', name: 'Wallet', customizations: walletDefinition },
      ]);
      (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('TX_REACHED'));
      await expect(
        service.updateOrder('order-id-1', {
          items: [
            {
              productId: 'prod-wallet', quantity: 2, price: 700,
              customization: { groups: [{ key: 'engraving', optionKeys: ['gold'] }] },
            },
          ],
        } as any),
      ).rejects.toThrow('TX_REACHED');
    });

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

    it('updates the payment row when the mode is switched to COD (S2 ON + audit)', async () => {
      const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
        { key: 'payments.editAllowed', value: 'true' },
      ]);
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

      await service.updateOrder(
        'order-id-1',
        {
          paymentOptionType: 'CASH_ON_DELIVERY',
          gatewayCode: 'cash',
        },
        { userId: 'staff-1' },
      );

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
      const audit = (orderUpdate.data.timeline as any[]).find(
        (e: any) => e && typeof e === 'object' && 'old' in e && 'new' in e,
      );
      expect(audit).toBeDefined();
      expect(audit.old).toMatchObject({ gatewayCode: 'bkash', amount: 2050 });
      expect(audit.new).toMatchObject({ gatewayCode: 'cash', amount: 2050 });
      expect(audit.by).toBe('staff-1');
    });

    it('creates NO payment row when the order had none (due is derived, D-C)', async () => {
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

      // D-C actuals-only ledger: switching the method with no money received
      // records nothing — no UNPAID/PENDING placeholder. The due stays
      // derived (total − ΣPAID). Real money enters via payment endpoints.
      expect(prisma.payment.create).not.toHaveBeenCalled();
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

    describe('partial-advance edits against collected money', () => {
      // Partial order, total 2050, 800 already PAID (bkash) + 1250 UNPAID remainder.
      const partialOrder = () => ({
        ...mockOrder,
        shippingCharge: 100,
        discount: 50,
        paymentOptionType: 'PARTIAL_PAYMENT',
        partialAmount: 800,
        paymentStatus: 'PARTIAL_PAID',
      });
      const setCollected = (n: number) => {
        (prisma.payment as any).aggregate = jest.fn(async () => ({
          _sum: { amount: n },
        }));
      };
      const remainderRow = (amount = 1250) => ({
        id: 'pay-remainder',
        gatewayCode: 'cash',
        amount,
        status: 'UNPAID',
      });

      it('no-op save leaves the remainder row untouched (no write, no 403)', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder());
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
        setCollected(800);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue(remainderRow());
        (prisma.order.update as jest.Mock).mockResolvedValue(partialOrder());

        await service.updateOrder('order-id-1', {
          paymentOptionType: 'PARTIAL_PAYMENT',
          gatewayCode: 'cash',
          partialAmount: 800,
        });

        // Append-only: identical amount + gateway → no UPDATE, no correction.
        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.payment.create).not.toHaveBeenCalled();
        const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
        expect(orderUpdate.data.partialAmount).toBe(800);
        expect(orderUpdate.data.paymentStatus).toBe('PARTIAL_PAID');
      });

      it('rejects lowering the advance below collected money with refund guidance', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder());
        setCollected(800);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue(remainderRow());

        await expect(
          service.updateOrder('order-id-1', {
            paymentOptionType: 'PARTIAL_PAYMENT',
            gatewayCode: 'bkash',
            partialAmount: 500,
          }),
        ).rejects.toThrow(/refund/i);
        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.order.update).not.toHaveBeenCalled();
      });

      it('recomputes the remainder when the advance is raised (S2 ON + audit)', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder());
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
          { key: 'payments.editAllowed', value: 'true' },
        ]);
        setCollected(800);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue(remainderRow());
        (prisma.order.update as jest.Mock).mockResolvedValue(partialOrder());

        await service.updateOrder(
          'order-id-1',
          {
            paymentOptionType: 'PARTIAL_PAYMENT',
            gatewayCode: 'cash',
            partialAmount: 900,
          },
          { userId: 'staff-1' },
        );

        const paymentUpdate = (prisma.payment.update as jest.Mock).mock.calls[0][0];
        expect(paymentUpdate.data.amount).toBe(1150);
        const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
        const audit = (orderUpdate.data.timeline as any[]).find(
          (e: any) => e && typeof e === 'object' && 'old' in e && 'new' in e,
        );
        expect(audit).toBeDefined();
        expect(audit.old).toMatchObject({ amount: 1250 });
        expect(audit.new).toMatchObject({ amount: 1150 });
        expect(audit.by).toBe('staff-1');
      });

      it('advance covering the full total INSERTs a reversal correction, never DELETEs', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder());
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
        setCollected(2050);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue(remainderRow());
        (prisma.payment as any).delete = jest.fn().mockResolvedValue({ id: 'pay-remainder' });
        (prisma.order.update as jest.Mock).mockResolvedValue(partialOrder());

        await service.updateOrder('order-id-1', {
          paymentOptionType: 'PARTIAL_PAYMENT',
          gatewayCode: 'cash',
          partialAmount: 2050,
        });

        expect(prisma.payment.delete).not.toHaveBeenCalled();
        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.payment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            orderId: 'order-id-1',
            gatewayCode: 'cash',
            amount: -1250,
            status: 'UNPAID',
            recordedAt: expect.any(Date),
          }),
        });
        const reversal = (prisma.payment.create as jest.Mock).mock.calls[0][0];
        expect(String(reversal.data.notes)).toMatch(/reversal/i);
        const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
        expect(orderUpdate.data.paymentStatus).toBe('PAID');
      });

      it('blocks leaving partial mode while money is collected', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder());
        setCollected(800);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue(remainderRow());

        await expect(
          service.updateOrder('order-id-1', {
            paymentOptionType: 'CASH_ON_DELIVERY',
            gatewayCode: 'cash',
          }),
        ).rejects.toThrow(/refund/i);
        expect(prisma.order.update).not.toHaveBeenCalled();
        delete (prisma.payment as any).aggregate;
      });
    });

    describe('payment ledger edit gate (Task 5)', () => {
      const editOff: never[] = [];
      const editOn = [{ key: 'payments.editAllowed', value: 'true' }];

      it('S2 OFF (default): amount/account change on existing row → 403, no UPDATE', async () => {
        const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue(editOff);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
          id: 'pay-1',
          gatewayCode: 'bkash',
          amount: 2050,
          status: 'PENDING',
        });

        await expect(
          service.updateOrder('order-id-1', {
            paymentOptionType: 'CASH_ON_DELIVERY',
            gatewayCode: 'cash',
          }),
        ).rejects.toThrow(/edit.*disabled.*correction/i);
        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.payment.create).not.toHaveBeenCalled();
      });

      it('S2 ON: direct edit allowed + timeline audit old→new+by', async () => {
        const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue(editOn);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
          id: 'pay-1',
          gatewayCode: 'bkash',
          amount: 2050,
          status: 'PENDING',
        });
        (prisma.order.update as jest.Mock).mockResolvedValue({
          ...existingOrder,
          paymentOptionType: 'CASH_ON_DELIVERY',
        });

        await service.updateOrder(
          'order-id-1',
          { paymentOptionType: 'CASH_ON_DELIVERY', gatewayCode: 'cash' },
          { userId: 'staff-1' },
        );

        expect(prisma.payment.update).toHaveBeenCalledWith({
          where: { id: 'pay-1' },
          data: expect.objectContaining({
            gatewayCode: 'cash',
            amount: 2050,
            status: 'UNPAID',
          }),
        });
        const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
        const audit = (orderUpdate.data.timeline as any[]).find(
          (e: any) => e && typeof e === 'object' && 'old' in e && 'new' in e,
        );
        expect(audit).toBeDefined();
        expect(audit.old).toMatchObject({ gatewayCode: 'bkash', amount: 2050 });
        expect(audit.new).toMatchObject({ gatewayCode: 'cash', amount: 2050 });
        expect(audit.by).toBe('staff-1');
      });

      it('no-op save leaves the row untouched (no write, no 403)', async () => {
        const existingOrder = { ...mockOrder, shippingCharge: 100, discount: 50 };
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(existingOrder);
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue(editOff);
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
          id: 'pay-1',
          gatewayCode: 'cash',
          amount: 2050,
          status: 'UNPAID',
        });
        (prisma.order.update as jest.Mock).mockResolvedValue(existingOrder);

        await service.updateOrder('order-id-1', {
          paymentOptionType: 'CASH_ON_DELIVERY',
          gatewayCode: 'cash',
        });

        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.payment.create).not.toHaveBeenCalled();
        expect(prisma.order.update).toHaveBeenCalled();
      });

      it('zero-balance advance INSERTs full-reversal correction, never DELETEs', async () => {
        const partialOrder = {
          ...mockOrder,
          shippingCharge: 100,
          discount: 50,
          paymentOptionType: 'PARTIAL_PAYMENT',
          partialAmount: 800,
          paymentStatus: 'PARTIAL_PAID',
        };
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(partialOrder);
        (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue(editOff);
        (prisma.payment as any).aggregate = jest.fn(async () => ({
          _sum: { amount: 2050 },
        }));
        (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
          id: 'pay-remainder',
          gatewayCode: 'cash',
          amount: 1250,
          status: 'UNPAID',
        });
        (prisma.payment as any).delete = jest.fn().mockResolvedValue({ id: 'pay-remainder' });
        (prisma.order.update as jest.Mock).mockResolvedValue(partialOrder);

        await service.updateOrder('order-id-1', {
          paymentOptionType: 'PARTIAL_PAYMENT',
          gatewayCode: 'cash',
          partialAmount: 2050,
        });

        expect(prisma.payment.delete).not.toHaveBeenCalled();
        expect(prisma.payment.update).not.toHaveBeenCalled();
        expect(prisma.payment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            orderId: 'order-id-1',
            amount: -1250,
            recordedAt: expect.any(Date),
          }),
        });
        const reversal = (prisma.payment.create as jest.Mock).mock.calls[0][0];
        expect(String(reversal.data.notes)).toMatch(/reversal/i);
        delete (prisma.payment as any).aggregate;
      });
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
          // `status` is required by the item-edit status gate.
          status: { select: { name: true } },
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
          // The uniqueness guard belongs to the PROFILE write, which is
          // opt-in. Without it the order snapshot is corrected freely and the
          // customer's canonical phone is untouched, so there is no conflict.
          updateCustomerProfile: true,
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    });

    it('does NOT touch the customer profile without an explicit opt-in', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane', email: 'free@x.com' },
      });

      // The order's OWN snapshot is corrected...
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(orderUpdate.data.customerFirstName).toBe('Jane');
      expect(orderUpdate.data.customerEmail).toBe('free@x.com');
      // ...but the customer-owned profile is not.
      expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    });

    it('updates the customer profile only when updateCustomerProfile is true', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane', email: 'free@x.com' },
        updateCustomerProfile: true,
      });

      // Two INDEPENDENT ownership operations, both asserted.
      const profileUpdate = (prisma.customerProfile.update as jest.Mock).mock.calls[0][0];
      expect(profileUpdate.data).toEqual({ name: 'Jane', email: 'free@x.com' });
      const orderUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(orderUpdate.data.customerFirstName).toBe('Jane');
    });

    it('writes only explicitly supplied fields to the profile', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane' },
        updateCustomerProfile: true,
      });

      // Omitted email is preserved, not blanked.
      const updateCall = (prisma.customerProfile.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).toEqual({ name: 'Jane' });
      expect(updateCall.data).not.toHaveProperty('email');
    });

    it('never writes UserProfile, so staff identity cannot be overwritten', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customerProfile as any).update = jest
        .fn()
        .mockResolvedValue({ id: 'customer-id-1' });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane', email: 'free@x.com' },
        updateCustomerProfile: true,
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
        updateCustomerProfile: true,
      });

      // Empty email never reaches the unique-key write (no P2002/409).
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
        updateCustomerProfile: true,
      });

      const updateCall = (prisma.customerProfile.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.email).toBe('free@x.com');
    });
  });

  // ── Item-edit status gate ──────────────────────────────────────────
  // Item edits re-reserve stock. Once goods have shipped or the lifecycle is
  // financially closed the reservation no longer describes reality, so every
  // endpoint that mutates items must refuse. Non-item edits stay open.
  describe('item-edit status gate', () => {
    const orderInStatus = (statusName: string, over: Record<string, any> = {}) => ({
      ...mockOrder,
      shippingCharge: 100,
      discount: 50,
      status: { name: statusName },
      ...over,
    });

    const itemsDto = {
      items: [{ productId: 'product-id-1', quantity: 2, price: 500 }],
    };

    const seedOrder = (statusName: string, over: Record<string, any> = {}) => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(
        orderInStatus(statusName, over),
      );
      (prisma.order.update as jest.Mock).mockResolvedValue(
        orderInStatus(statusName, over),
      );
    };

    describe('updateOrder', () => {
      it('rejects an item change on a Delivered order with ORDER_ITEMS_LOCKED', async () => {
        seedOrder('Delivered');

        await expect(
          service.updateOrder('order-id-1', itemsDto),
        ).rejects.toMatchObject({
          response: {
            statusCode: 409,
            code: 'ORDER_ITEMS_LOCKED',
            statusName: 'Delivered',
          },
        });
        expect(prisma.order.update).not.toHaveBeenCalled();
      });

      it.each(['Shipping', 'Partial', 'Return Pending', 'Returned', 'Damaged'])(
        'rejects an item change on a %s order',
        async (statusName) => {
          seedOrder(statusName);

          await expect(
            service.updateOrder('order-id-1', itemsDto),
          ).rejects.toMatchObject({
            response: { code: 'ORDER_ITEMS_LOCKED' },
          });
        },
      );

      it.each(['Pending', 'Payment Pending', 'Hold', 'Confirmed'])(
        'allows an item change on a %s order',
        async (statusName) => {
          seedOrder(statusName);

          await expect(
            service.updateOrder('order-id-1', itemsDto),
          ).resolves.toBeDefined();
        },
      );

      it.each(['Packed', 'Packing Hold'])(
        'allows an item change on a %s order (warning tier, not blocked)',
        async (statusName) => {
          seedOrder(statusName);

          await expect(
            service.updateOrder('order-id-1', itemsDto),
          ).resolves.toBeDefined();
        },
      );

      it('allows a Cancelled order to be edited — cancelling only releases the reservation', async () => {
        seedOrder('Cancelled');

        await expect(
          service.updateOrder('order-id-1', itemsDto),
        ).resolves.toBeDefined();
      });

      it('still allows a NON-item edit on a Delivered order', async () => {
        seedOrder('Delivered');

        await expect(
          service.updateOrder('order-id-1', { officeNotes: 'Called customer' }),
        ).resolves.toBeDefined();

        const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
        expect(updateCall.data.officeNotes).toBe('Called customer');
      });

      it('does not throw when the order has no status relation loaded', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue({
          ...mockOrder,
          status: undefined,
        });
        (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

        await expect(
          service.updateOrder('order-id-1', itemsDto),
        ).resolves.toBeDefined();
      });
    });

    describe('addItem', () => {
      it('rejects adding a line to a Delivered order', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(
          orderInStatus('Delivered'),
        );

        await expect(
          service.addItem('order-id-1', {
            productId: 'product-id-1',
            quantity: 1,
            price: 100,
          }),
        ).rejects.toMatchObject({
          response: { code: 'ORDER_ITEMS_LOCKED' },
        });
      });

      it('allows adding a line to a Confirmed order', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(
          orderInStatus('Confirmed'),
        );
        (prisma.orderItem.create as jest.Mock).mockResolvedValue({
          id: 'new-item',
          productId: 'product-id-1',
          quantity: 1,
          price: 100,
        });
        (prisma.order.update as jest.Mock).mockResolvedValue(
          orderInStatus('Confirmed'),
        );

        await expect(
          service.addItem('order-id-1', {
            productId: 'product-id-1',
            quantity: 1,
            price: 100,
          }),
        ).resolves.toBeDefined();
      });
    });

    describe('removeItem', () => {
      it('rejects removing a line from a Shipping order', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(
          orderInStatus('Shipping', {
            items: [{ id: 'item-1', productId: 'product-id-1', quantity: 1 }],
          }),
        );

        await expect(
          service.removeItem('order-id-1', 'item-1'),
        ).rejects.toMatchObject({
          response: { code: 'ORDER_ITEMS_LOCKED' },
        });
      });

      it('allows removing a line from a Confirmed order', async () => {
        (prisma.order.findUnique as jest.Mock).mockResolvedValue(
          orderInStatus('Confirmed', {
            items: [
              {
                id: 'item-1',
                productId: 'product-id-1',
                quantity: 1,
                managedStockDeducted: false,
              },
            ],
          }),
        );
        (prisma.orderItem.delete as jest.Mock).mockResolvedValue({});
        (prisma.order.update as jest.Mock).mockResolvedValue(
          orderInStatus('Confirmed'),
        );

        // removeItem resolves with no value; the proof it ran is the delete.
        await service.removeItem('order-id-1', 'item-1');
        expect(prisma.orderItem.delete).toHaveBeenCalledWith({
          where: { id: 'item-1' },
        });
      });
    });
  });

  // ── Guest orders: order-owned snapshot is editable ─────────────────
  // `updateOrder` gated the whole customer block on `order.customerId`, so a
  // guest checkout silently dropped every name/phone/email correction even
  // though those columns live on the Order row.
  describe('guest order customer correction', () => {
    const guestOrder = () => ({
      ...mockOrder,
      customerId: null,
      status: { name: 'Pending' },
      shippingCharge: 100,
      discount: 0,
    });

    it('writes the order-owned snapshot for a guest order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(guestOrder());
      (prisma.order.update as jest.Mock).mockResolvedValue(guestOrder());

      await service.updateOrder('order-id-1', {
        customerInfo: {
          firstName: 'Rahim',
          lastName: 'Uddin',
          phoneNumber: '01712345678',
          email: 'rahim@x.com',
        },
      });

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data.customerFirstName).toBe('Rahim');
      expect(data.customerLastName).toBe('Uddin');
      expect(data.customerPhone).toBe('+8801712345678');
      expect(data.customerEmail).toBe('rahim@x.com');
    });

    it('keeps the legacy guest* columns in sync so fallback readers agree', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(guestOrder());
      (prisma.order.update as jest.Mock).mockResolvedValue(guestOrder());

      await service.updateOrder('order-id-1', {
        customerInfo: {
          firstName: 'Rahim',
          lastName: 'Uddin',
          phoneNumber: '01712345678',
          email: 'rahim@x.com',
        },
      });

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data.guestName).toBe('Rahim Uddin');
      expect(data.guestPhone).toBe('+8801712345678');
    });

    // `Order` has no `guestEmail` column — writing one makes Prisma throw a
    // validation error and the whole update 500s. Caught live, pinned here.
    it('never writes a non-existent guestEmail column', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(guestOrder());
      (prisma.order.update as jest.Mock).mockResolvedValue(guestOrder());

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Rahim', email: 'rahim@x.com' },
      });

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty('guestEmail');
      // Email belongs to the order-owned snapshot column.
      expect(data.customerEmail).toBe('rahim@x.com');
    });

    it('never writes a canonical profile for a guest order, even when asked', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(guestOrder());
      (prisma.order.update as jest.Mock).mockResolvedValue(guestOrder());

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Rahim', phoneNumber: '01712345678' },
        updateCustomerProfile: true,
      });

      // Fabricating a CustomerProfile link would silently merge two identities.
      expect(prisma.customerProfile.update).not.toHaveBeenCalled();
    });

    it('leaves guest columns alone for a linked-customer order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        customerId: 'customer-id-1',
        status: { name: 'Pending' },
        shippingCharge: 100,
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', {
        customerInfo: { firstName: 'Jane' },
      });

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data.customerFirstName).toBe('Jane');
      expect(data).not.toHaveProperty('guestName');
      expect(data).not.toHaveProperty('guestPhone');
    });
  });

  // ── Explicit empty items array ────────────────────────────────────
  // The old guard was `dto.items && dto.items.length > 0`, which made `[]`
  // indistinguishable from "field omitted" — clearing every line silently did
  // nothing. An explicit empty array must be honoured.
  describe('explicit empty items array', () => {
    it('clears all lines and releases their stock', async () => {
      const stockService = module.get<StockService>(StockService);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: { name: 'Pending' },
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);
      (module.get<StockRouterService>(StockRouterService).resolve as jest.Mock)
        .mockReturnValue({ ms: 'release', pi: 'release' });

      await service.updateOrder('order-id-1', { items: [] });

      // The old line's stock must be released, not left reserved forever.
      expect(stockService.operate).toHaveBeenCalledWith(
        'release',
        expect.objectContaining({ quantity: 2 }),
      );
      // And the line itself must actually be deleted.
      expect(prisma.orderItem.deleteMany).toHaveBeenCalledWith({
        where: { orderId: 'order-id-1' },
      });
    });

    it('leaves items untouched when the field is omitted entirely', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: { name: 'Pending' },
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.updateOrder('order-id-1', { officeNotes: 'note only' });

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data.officeNotes).toBe('note only');
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

    it('bulk Returned moves already-received orders with zero direct stock writes', async () => {
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
      // Linked return already RESTOCKED → the status change is status-only.
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ret-1',
          displayId: 'RTN-1',
          orderId: 'order-1',
          type: 'FULL',
          status: 'RESTOCKED',
          items: [{ productId: 'prod-1', variantId: null, quantity: 1 }],
          stockReconciled: true,
        },
      ]);

      const cancelReturnStock = module.get<CancelReturnStockService>(
        CancelReturnStockService,
      );
      await service.bulkStatusChange(
        ['order-1'],
        'status-rt',
        'staff-123',
      );

      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
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
      const purchaseCalls = capture.mock.calls.filter(
        ([input]: any[]) => input.eventType === 'Purchase',
      );
      expect(purchaseCalls).toHaveLength(1);
      const [input] = purchaseCalls[0];
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

      // Confirmed ≠ configured Delivered → no validated Purchase (the
      // genuine Confirmed transition still emits its lifecycle event).
      expect(
        (trackingCapture.capture as jest.Mock).mock.calls.filter(
          ([input]: any[]) => input.eventType === 'Purchase',
        ),
      ).toHaveLength(0);
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
      expect(cancelReturnStock.releaseForCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-id-1',
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

    it('does NOT emit a Refund when the cancelled order never had a delivered Purchase (pairing gate)', async () => {
      // Customer cancels an order that never reached the configured purchase
      // trigger -> no Purchase snapshot -> NO Refund event may be created.
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
      });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) => {
          const txOrderUpdate = jest.fn().mockResolvedValue({
            ...mockOrder,
            status: { id: 'status-cancelled', name: 'Cancelled' },
          });
          const refundOrder = {
            id: 'order-id-1',
            total: 2050,
            salesChannel: 'WEBSITE',
            items: [{ id: 'item-1', productId: 'prod-1', quantity: 1, price: 2050 }],
            customer: { firstName: 'John', phoneNumber: '+1234567890' },
          };
          const tx = {
            ...prisma,
            order: {
              ...prisma.order,
              update: txOrderUpdate,
              findUnique: jest.fn().mockResolvedValue(refundOrder),
            },
          };
          await cb(tx);
          return { ...mockOrder, status: { id: 'status-cancelled', name: 'Cancelled' } };
        },
      );

      await service.cancelByCustomer('order-id-1', 'the-token');

      const trackingCapture =
        module.get<TrackingCaptureService>(TrackingCaptureService);
      // No Refund without a Purchase — but the genuine Cancelled transition
      // still emits its lifecycle event.
      const refundCalls = (
        trackingCapture.capture as jest.Mock
      ).mock.calls.filter(([input]: any[]) => input.eventType === 'Refund');
      expect(refundCalls).toHaveLength(0);
      expect(trackingCapture.capture).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'OrderCancelled' }),
        expect.anything(),
      );
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

  describe('Task 9 cancel/refund gate (orders side)', () => {
    function netPaidWithLegacy(net: number, legacy: number) {
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: net },
      });
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: legacy },
      });
    }

    it('updateStatus → Cancelled is blocked while money is still out', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        status: { id: 'status-pending', name: 'Pending' },
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      netPaidWithLegacy(2000, 0);

      await expect(
        service.updateStatus(
          'order-id-1',
          { statusId: 'status-cancelled' } as any,
          'staff-1',
        ),
      ).rejects.toThrow(/outstanding paid balance/);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('cancelByCustomer is blocked while money is still out', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
      });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      netPaidWithLegacy(1500, 0);

      await expect(
        service.cancelByCustomer('order-id-1', 'the-token'),
      ).rejects.toThrow(/outstanding paid balance/);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('legacy completed refund unblocks the gate (no double-count)', async () => {
      // Gross paid 2000, legacy completed refund 2000, no negative ledger
      // rows yet → outstanding 0 → the customer cancel proceeds.
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        viewToken: 'the-token',
      });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      netPaidWithLegacy(2000, 2000);
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: any) => Promise<any>) => {
          const txOrderUpdate = jest.fn().mockResolvedValue({
            ...mockOrder,
            status: { id: 'status-cancelled', name: 'Cancelled' },
          });
          const tx = { ...prisma, order: { ...prisma.order, update: txOrderUpdate } };
          await cb(tx);
          return { ...mockOrder, status: { id: 'status-cancelled', name: 'Cancelled' } };
        },
      );

      const result = await service.cancelByCustomer('order-id-1', 'the-token');

      expect((result as any).status.name).toBe('Cancelled');
    });

    it('bulk cancel collects the gate failure per order and still cancels the settled one', async () => {
      const settled = {
        id: 'order-settled',
        displayId: 'ORD-S',
        timeline: [],
        statusId: 'status-confirmed',
        assignedToId: null,
        status: { name: 'Confirmed' },
      };
      const owing = {
        id: 'order-owing',
        displayId: 'ORD-O',
        timeline: [],
        statusId: 'status-confirmed',
        assignedToId: null,
        status: { name: 'Confirmed' },
      };
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue({
        id: 'status-cancelled',
        name: 'Cancelled',
      });
      (prisma.order.findMany as jest.Mock).mockResolvedValue([settled, owing]);
      (prisma.payment.aggregate as jest.Mock).mockImplementation(
        async (args: any) => ({
          _sum: { amount: args?.where?.orderId === 'order-owing' ? 1200 : 0 },
        }),
      );
      (prisma.refund.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 0 },
      });

      const result = await service.bulkStatusChange(
        ['order-settled', 'order-owing'],
        'status-cancelled',
        'staff-123',
      );

      expect(result.updated).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failedDetails).toMatchObject([
        { id: 'order-owing', reason: expect.stringContaining('outstanding paid balance') },
      ]);
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

  describe('analytics cache invalidation (P2 §6)', () => {
    it('drops analytics:* after trash', async () => {
      const cache = module.get<CacheService>(CacheService);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        trashedAt: null,
        timeline: [],
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);

      await service.trash('order-id-1');

      expect(cache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
    });

    it('does not invalidate when the mutation fails', async () => {
      const cache = module.get<CacheService>(CacheService);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.trash('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(cache.invalidateByPrefix).not.toHaveBeenCalled();
    });

    it('drops analytics:* after transitionOrderStatus (statusId drives recognition)', async () => {
      const cache = module.get<CacheService>(CacheService);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        trashedAt: null,
        status: { id: 'status-confirmed', name: 'Confirmed' },
        items: [],
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue({
        id: 'status-packed',
        name: 'Packed',
      });
      (prisma.order.update as jest.Mock).mockResolvedValue({});

      const result = await service.transitionOrderStatus(
        'order-id-1',
        'Packed',
        'staff@example.com',
      );

      expect(result).toMatchObject({ from: 'Confirmed', to: 'Packed' });
      expect(cache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
    });

    it('does not invalidate when transitionOrderStatus rejects', async () => {
      const cache = module.get<CacheService>(CacheService);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.transitionOrderStatus('missing-id', 'Packed'),
      ).rejects.toThrow(NotFoundException);
      expect(cache.invalidateByPrefix).not.toHaveBeenCalled();
    });
  });

  describe('trash stock side effects (goods already left the warehouse)', () => {
    const cancelReturnStock = () =>
      module.get<CancelReturnStockService>(CancelReturnStockService);

    const mockTrash = (statusName: string) => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        trashedAt: null,
        status: { id: `status-${statusName}`, name: statusName },
        timeline: [],
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);
    };

    it.each([
      'Shipping',
      'Delivered',
      'Partial',
      'Return Pending',
      'Returned',
      'Damaged',
    ])(
      'does not restore stock when a %s order is trashed',
      async (statusName) => {
        mockTrash(statusName);

        await service.trash('order-id-1', 'staff@example.com');

        expect(
          cancelReturnStock().releaseForCancellation,
        ).not.toHaveBeenCalled();
      },
    );

    it('still releases the reservation for a pre-dispatch order', async () => {
      mockTrash('Confirmed');

      await service.trash('order-id-1', 'staff@example.com');

      expect(cancelReturnStock().releaseForCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-id-1' }),
      );
    });
  });

  describe('restore from trash re-reserves stock (stock audit #2)', () => {
    const mockRestore = (statusName: string) => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        trashedAt: new Date(),
        status: { id: `status-${statusName}`, name: statusName },
        timeline: [],
      });
      (prisma.order.update as jest.Mock).mockResolvedValue(mockOrder);
    };

    it('re-reserves via verifyStockForOrder for a pre-dispatch order', async () => {
      mockRestore('Confirmed');
      const verify = jest
        .spyOn(service as any, 'verifyStockForOrder')
        .mockResolvedValue(undefined);

      await service.restore('order-id-1');

      expect(verify).toHaveBeenCalledWith('order-id-1', expect.anything());
      verify.mockRestore();
    });

    it.each(['Shipping', 'Delivered', 'Returned', 'Damaged', 'Cancelled'])(
      'does NOT re-reserve for a %s order',
      async (statusName) => {
        mockRestore(statusName);
        const verify = jest
          .spyOn(service as any, 'verifyStockForOrder')
          .mockResolvedValue(undefined);

        await service.restore('order-id-1');

        expect(verify).not.toHaveBeenCalled();
        verify.mockRestore();
      },
    );

    it('fails the restore loudly when the stock is no longer available', async () => {
      mockRestore('Confirmed');
      const verify = jest
        .spyOn(service as any, 'verifyStockForOrder')
        .mockRejectedValue(new Error('Insufficient managed stock'));

      await expect(service.restore('order-id-1')).rejects.toThrow(
        'Insufficient managed stock',
      );
      verify.mockRestore();
    });
  });

  describe('handleReturnedSideEffects (hardening 2: find-or-create + guarded)', () => {
    const wireReturnModels = (rows: any[]) => {
      let createdReturn: any = null;
      const all = [...rows];
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue(all);
      (prisma as any).return.create = jest.fn().mockImplementation(async ({ data }: any) => {
        createdReturn = { id: 'ret-auto', displayId: 'RTN-1', createdAt: new Date(), stockReconciled: false, ...data };
        all.push(createdReturn);
        return createdReturn;
      });
      (prisma as any).return.findUnique = jest.fn().mockImplementation(async ({ where }: any) =>
        all.find((r) => r.id === where?.id) ?? null,
      );
      (prisma as any).return.update = jest.fn().mockImplementation(async ({ where, data }: any) => {
        const row = all.find((r) => r.id === where?.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where?.id, ...data };
      });
      (prisma as any).returnCounter = {
        upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...mockOrder,
        items: [
          { id: 'item-1', productId: 'prod-1', variantId: null, quantity: 2, comboId: null },
        ],
      });
    };

    it('auto-creates a FULL return and restores once through the guarded path', async () => {
      wireReturnModels([]);
      const cancelReturnStock = module.get<CancelReturnStockService>(CancelReturnStockService);

      await (service as any).handleReturnedSideEffects(prisma, 'order-id-1', 'staff-123');

      expect((prisma as any).return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-id-1', type: 'FULL', status: 'REQUESTED' }),
        }),
      );
      expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-id-1', returnId: 'ret-auto' }),
      );
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });

    it('already-reconciled returns are no-ops (zero stock writes)', async () => {
      wireReturnModels([
        {
          id: 'ret-1',
          displayId: 'RTN-1',
          orderId: 'order-id-1',
          type: 'FULL',
          status: 'RESTOCKED',
          items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
          stockReconciled: true,
        },
      ]);
      const cancelReturnStock = module.get<CancelReturnStockService>(CancelReturnStockService);

      await (service as any).handleReturnedSideEffects(prisma, 'order-id-1');

      expect((prisma as any).return.create).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });

    it('blocks when an active return has not arrived yet', async () => {
      wireReturnModels([
        {
          id: 'ret-1',
          displayId: 'RTN-1',
          orderId: 'order-id-1',
          type: 'FULL',
          status: 'IN_TRANSIT',
          items: [],
          stockReconciled: false,
        },
      ]);

      await expect(
        (service as any).handleReturnedSideEffects(prisma, 'order-id-1'),
      ).rejects.toThrow(/RTN-1.*has not arrived/);
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
        email: 'john@example.com',
        phone: '+1234567890',
      },
      shippingAddress: {
        phone: '+1234567890',
        name: 'John Doe',
        city: 'Dhaka',
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
            city: 'Dhaka',
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

    describe('canonical customer identity field mapping', () => {
      const captureService = () =>
        module.get<TrackingCaptureService>(TrackingCaptureService);

      it('uses shipping address phone/name when both shipping and customer are populated', async () => {
        const order = {
          ...baseOrder,
          shippingAddress: { phone: '+8801999999999', name: 'Ship Name', city: 'Chittagong' },
          customer: { ...baseOrder.customer, phone: '+1234567890', name: 'Profile Name' },
        };
        await (service as any).buildAndSendPurchaseEvent(order, 'instant');

        const capture = captureService().capture as jest.Mock;
        const [input] = capture.mock.calls[0];
        // Shipping address is canonical — takes priority over customer profile
        expect(input.payload.customer.phone).toBe('+8801999999999');
        expect(input.payload.customer.firstName).toBe('Ship Name');
      });

      it('falls back to customer profile when shipping address is empty', async () => {
        const order = {
          ...baseOrder,
          shippingAddress: {},
          customer: { ...baseOrder.customer, phone: '+8801888888888', name: 'Profile Name' },
        };
        await (service as any).buildAndSendPurchaseEvent(order, 'instant');

        const capture = captureService().capture as jest.Mock;
        const [input] = capture.mock.calls[0];
        expect(input.payload.customer.phone).toBe('+8801888888888');
        expect(input.payload.customer.firstName).toBe('Profile Name');
      });

      it('falls back to guestPhone/guestName when both shipping and customer are empty', async () => {
        const order = {
          ...baseOrder,
          shippingAddress: {},
          customer: null,
          guestPhone: '+8801777777777',
          guestName: 'Guest User',
        };
        await (service as any).buildAndSendPurchaseEvent(order, 'instant');

        const capture = captureService().capture as jest.Mock;
        const [input] = capture.mock.calls[0];
        expect(input.payload.customer.phone).toBe('+8801777777777');
        expect(input.payload.customer.firstName).toBe('Guest User');
      });

      it('returns undefined for all identity fields when all are missing', async () => {
        const order = {
          ...baseOrder,
          shippingAddress: {},
          customer: null,
          guestPhone: null,
          guestName: null,
        };
        await (service as any).buildAndSendPurchaseEvent(order, 'instant');

        const capture = captureService().capture as jest.Mock;
        const [input] = capture.mock.calls[0];
        // Empty strings are normalized to undefined for Meta PII fields
        expect(input.payload.customer.phone).toBeUndefined();
        expect(input.payload.customer.firstName).toBeUndefined();
      });
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

    // Refund pairing gate fixtures: Purchase captured + delivered (SENT).
    const mockPurchaseSent = () => {
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue({
        id: 'purchase-snap-1',
      });
      (prisma.trackingOutbox.findUnique as jest.Mock).mockResolvedValue({
        status: 'SENT',
      });
    };

    beforeEach(() => {
      mockPurchaseSent();
    });

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

    it('skips refund when NO Purchase capture exists (order never triggered)', async () => {
      // The reported bug: an order that never reached the configured purchase
      // trigger gets cancelled -> a standalone Refund was sent to Meta/TikTok.
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue(null);

      await (service as any).fireRefundEvent(refundOrder);

      expect(captureService().capture).not.toHaveBeenCalled();
      expect(prisma.trackingOutbox.findUnique).not.toHaveBeenCalled();
    });

    it('captures refund when Purchase outbox is still PENDING (in-flight, will deliver)', async () => {
      // Quick-cancel edge: the Purchase is captured and the dispatcher is still
      // delivering it. Suppressing this refund would leave Meta/TikTok with an
      // unpaired Purchase (revenue over-count), so the refund MUST still fire.
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue({
        id: 'purchase-snap-1',
      });
      (prisma.trackingOutbox.findUnique as jest.Mock).mockResolvedValue({
        status: 'PENDING',
      });

      await (service as any).fireRefundEvent(refundOrder);

      expect(captureService().capture).toHaveBeenCalledTimes(1);
    });

    it('skips refund when Purchase captured but dead/failed at dispatch', async () => {
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue({
        id: 'purchase-snap-1',
      });
      (prisma.trackingOutbox.findUnique as jest.Mock).mockResolvedValue({
        status: 'DEAD',
      });

      await (service as any).fireRefundEvent(refundOrder);

      expect(captureService().capture).not.toHaveBeenCalled();
    });

    it('skips refund when Purchase outbox row is missing entirely', async () => {
      (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue({
        id: 'purchase-snap-1',
      });
      (prisma.trackingOutbox.findUnique as jest.Mock).mockResolvedValue(null);

      await (service as any).fireRefundEvent(refundOrder);

      expect(captureService().capture).not.toHaveBeenCalled();
    });

    it('still captures refund when the Purchase outbox is SENT (gate passes)', async () => {
      mockPurchaseSent();

      await (service as any).fireRefundEvent(refundOrder);

      expect(captureService().capture).toHaveBeenCalledTimes(1);
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
          customerId: 'cust-1',
          customerFirstName: 'John',
          customerLastName: 'Doe',
          customerPhone: '+8801711111111',
          customerEmail: 'john@example.com',
          guestName: 'Guest Buyer',
          guestPhone: '+8801712345678',
          shippingAddress: {
            district: 'Dhaka',
            thana: 'Mirpur',
            addressLine: 'House 12, Road 5',
          },
          customer: {
            id: 'cust-1',
            name: 'STALE PROFILE',
            email: 'stale@x.com',
            phone: 'STALE',
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
      // transformOrder maps the snapshot (profile ignored): full name split
      // into firstName/lastName, snapshot phone into phoneNumber.
      expect(order.customer.firstName).toBe('John');
      expect(order.customer.lastName).toBe('Doe');
      expect(order.customer.name).toBe('John Doe');
      expect(order.customer.phoneNumber).toBe('+8801711111111');
      // shippingAddress gains an address key derived from addressLine
      expect(order.shippingAddress.address).toBe('House 12, Road 5');
      // guest fields remain for template fallback
      expect(order.guestName).toBe('Guest Buyer');
      expect(order.guestPhone).toBe('+8801712345678');
    });

    it('builds customer from snapshot fields, ignoring the stale profile (D-A)', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'order-snap-1',
          displayId: 'ORD-250115-0002',
          createdAt: new Date('2025-01-15'),
          total: 1000,
          shippingCharge: 0,
          customerId: 'cust-1',
          customerFirstName: 'MR',
          customerLastName: 'Joy',
          customerPhone: '01712345678',
          customerEmail: 'mr.joy@example.com',
          guestName: null,
          guestPhone: null,
          shippingAddress: { district: 'Dhaka' },
          customer: {
            id: 'cust-1',
            name: 'STALE PROFILE',
            email: 'stale@x.com',
            phone: 'STALE',
          },
          status: { name: 'Pending' },
          items: [],
        },
      ]);

      const result = await service.bulkOrders(['order-snap-1']);

      const customer = (result[0] as any).customer;
      expect(customer.firstName).toBe('MR');
      expect(customer.lastName).toBe('Joy');
      expect(customer.phoneNumber).toBe('01712345678');
      expect(customer.name).toBe('MR Joy');
      expect(customer.email).toBe('mr.joy@example.com');
    });
  });

describe('order lifecycle custom events (OrderPlaced/OrderConfirmed/OrderCancelled/OrderDelivered/OrderReturned)', () => {
  const lcStatuses: Record<string, any> = {
    Pending: { id: 'status-pending', name: 'Pending', isInitial: true },
    Confirmed: { id: 'status-confirmed', name: 'Confirmed' },
    Cancelled: { id: 'status-cancelled', name: 'Cancelled' },
    Shipping: { id: 'status-shipping', name: 'Shipping' },
    Delivered: { id: 'status-delivered', name: 'Delivered' },
    'Return Pending': { id: 'status-rp', name: 'Return Pending' },
    Returned: { id: 'status-returned', name: 'Returned' },
    Hold: { id: 'status-hold', name: 'Hold' },
  };
  const lcOrder = {
    ...mockOrder,
    id: 'order-lc-1',
    displayId: 'ORD-LC-1',
    trackingSessionId: 'ctx-lc-1',
    shippingAddress: {
      phone: '+8801711111111',
      name: 'Lifecycle Buyer',
      city: 'Dhaka',
      state: 'Dhaka',
      zip: '1212',
      country: 'BD',
    },
    customer: {
      id: 'customer-id-1',
      name: 'Lifecycle Buyer',
      email: 'lc@example.com',
      phone: '+8801711111111',
    },
    items: [
      {
        id: 'item-lc-1',
        orderId: 'order-lc-1',
        productId: 'prod-1',
        variantId: 'variant-1',
        quantity: 2,
        price: 1000,
        product: {
          id: 'prod-1',
          name: 'Lifecycle Product',
          sku: 'LC-SKU',
          category: { name: 'Lifecycle Cat' },
        },
        variant: { id: 'variant-1', sku: 'LC-VAR' },
      },
    ],
    payments: [],
  };
  const lcCapture = () =>
    module.get<TrackingCaptureService>(TrackingCaptureService)
      .capture as jest.Mock;
  const callsOf = (eventType: string) =>
    lcCapture().mock.calls
      .map(([input]: any[]) => input)
      .filter((input: any) => input.eventType === eventType);

  const driveUpdateStatus = async (
    fromName: string,
    toName: string,
    settings: Array<{ key: string; value: string }> = [],
  ) => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...lcOrder,
      status: { ...lcStatuses[fromName] },
    });
    (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue({
      ...lcStatuses[toName],
    });
    (prisma.order.update as jest.Mock).mockResolvedValue({
      ...lcOrder,
      status: { ...lcStatuses[toName] },
    });
    (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue(settings);
    (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
    (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
      id: 'pay-lc',
      gatewayCode: 'cash',
      status: 'UNPAID',
    });
    // Hardening (2): a Returned status change resolves/auto-creates the linked
    // return through the guarded path — wire the return models (no-ops for
    // every other status).
    const listed: any[] = [];
    ((prisma as any).return.findMany as jest.Mock).mockImplementation(async () => listed);
    (prisma as any).return.create = jest.fn().mockImplementation(async ({ data }: any) => {
      const row = { id: 'ret-lc', displayId: 'RTN-LC-1', createdAt: new Date(), stockReconciled: false, ...data };
      listed.push(row);
      return row;
    });
    (prisma as any).return.findUnique = jest.fn().mockImplementation(async ({ where }: any) =>
      listed.find((r) => r.id === where?.id) ?? null,
    );
    (prisma as any).return.update = jest.fn().mockImplementation(async ({ where, data }: any) => {
      const row = listed.find((r) => r.id === where?.id);
      if (row) Object.assign(row, data);
      return row ?? { id: where?.id, ...data };
    });
    (prisma as any).returnCounter = {
      upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
    };
    await service.updateStatus(
      'order-lc-1',
      { statusId: lcStatuses[toName].id },
      'admin-1',
    );
  };

  const validatedConfirmedSettings = [
    { key: 'tracking_meta_purchase_mode', value: 'validated' },
    { key: 'tracking_meta_validated_status', value: 'Confirmed' },
    // Both providers validated: no instant Purchase anywhere, so receipt is
    // signaled by OrderPlaced (an unset mode defaults to instant, which would
    // fire a Purchase and suppress OrderPlaced — see the mixed-mode test).
    { key: 'tracking_tiktok_purchase_mode', value: 'validated' },
    { key: 'tracking_tiktok_validated_status', value: 'Confirmed' },
  ];

  it('Case B creation (validated mode): OrderPlaced fires, Purchase does not', async () => {
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
      ...lcOrder,
      status: lcStatuses.Pending,
    });
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...lcOrder,
      status: lcStatuses.Pending,
    });
    (prisma.productVariant.update as jest.Mock).mockResolvedValue({});
    (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue(
      validatedConfirmedSettings,
    );

    await service.create({
      customerId: 'customer-id-1',
      items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
      shippingCharge: 0,
      shippingAddress: { address: 'x' },
    } as any);

    expect(callsOf('OrderPlaced')).toHaveLength(1);
    expect(callsOf('OrderPlaced')[0].eventId).toBe('order_placed_order-lc-1');
    expect(callsOf('Purchase')).toHaveLength(0);
  });

  it('Case A creation (instant mode): Purchase fires, OrderPlaced does not', async () => {
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
      ...lcOrder,
      status: lcStatuses.Pending,
    });
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...lcOrder,
      status: lcStatuses.Pending,
    });
    (prisma.productVariant.update as jest.Mock).mockResolvedValue({});
    (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);

    await service.create({
      customerId: 'customer-id-1',
      items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
      shippingCharge: 0,
      shippingAddress: { address: 'x' },
    } as any);

    expect(callsOf('Purchase')).toHaveLength(1);
    expect(callsOf('OrderPlaced')).toHaveLength(0);
  });

  it('Case B Confirmed: OrderConfirmed + Purchase fire together (validated on Confirmed)', async () => {
    await driveUpdateStatus('Pending', 'Confirmed', validatedConfirmedSettings);
    const confirmed = callsOf('OrderConfirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].eventId).toBe('order_confirmed_order-lc-1');
    expect(confirmed[0].payload.lifecycleStage).toBe('confirmed');
    expect(confirmed[0].payload.lifecycleFromStatus).toBe('Pending');
    expect(confirmed[0].payload.lifecycleToStatus).toBe('Confirmed');
    expect(callsOf('Purchase')).toHaveLength(1);
  });

  it('Case C Confirmed (Delivered-configured): OrderConfirmed fires, Purchase waits', async () => {
    await driveUpdateStatus('Pending', 'Confirmed', [
      { key: 'tracking_meta_purchase_mode', value: 'validated' },
      { key: 'tracking_meta_validated_status', value: 'Delivered' },
    ]);
    expect(callsOf('OrderConfirmed')).toHaveLength(1);
    expect(callsOf('Purchase')).toHaveLength(0);
  });

  it('Case C Delivered: OrderDelivered + Purchase fire together', async () => {
    await driveUpdateStatus('Shipping', 'Delivered', [
      { key: 'tracking_meta_purchase_mode', value: 'validated' },
      { key: 'tracking_meta_validated_status', value: 'Delivered' },
    ]);
    const delivered = callsOf('OrderDelivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0].eventId).toBe('order_delivered_order-lc-1');
    expect(callsOf('Purchase')).toHaveLength(1);
  });

  it('mixed modes (meta validated, tiktok instant): Purchase fires, OrderPlaced does not', async () => {
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
      ...lcOrder,
      status: lcStatuses.Pending,
    });
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...lcOrder,
      status: lcStatuses.Pending,
    });
    (prisma.productVariant.update as jest.Mock).mockResolvedValue({});
    // Meta validated but TikTok unset (= instant default): the TikTok instant
    // Purchase counts the receipt, so OrderPlaced stays silent.
    (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([
      { key: 'tracking_meta_purchase_mode', value: 'validated' },
      { key: 'tracking_meta_validated_status', value: 'Confirmed' },
    ]);

    await service.create({
      customerId: 'customer-id-1',
      items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
      shippingCharge: 0,
      shippingAddress: { address: 'x' },
    } as any);

    expect(callsOf('Purchase')).toHaveLength(1);
    expect(callsOf('OrderPlaced')).toHaveLength(0);
  });

  it('Case D cancelByCustomer: OrderCancelled fires once', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...lcOrder,
      viewToken: 'tok-lc',
      status: { ...lcStatuses.Pending },
    });
    (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({
      ...lcStatuses.Cancelled,
    });
    (prisma.trackingSnapshot.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => Promise<any>) => {
        const txOrderUpdate = jest.fn().mockResolvedValue({
          ...lcOrder,
          status: { ...lcStatuses.Cancelled },
        });
        const tx = {
          ...prisma,
          order: {
            ...prisma.order,
            update: txOrderUpdate,
            findUnique: jest.fn().mockResolvedValue({
              ...lcOrder,
              status: { ...lcStatuses.Cancelled },
            }),
          },
        };
        const out = await cb(tx);
        return out ?? { ...lcOrder, status: { ...lcStatuses.Cancelled } };
      },
    );
    await service.cancelByCustomer('order-lc-1', 'tok-lc');
    const cancelled = callsOf('OrderCancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].eventId).toBe('order_cancelled_order-lc-1');
    expect(cancelled[0].payload.lifecycleFromStatus).toBe('Pending');
  });

  it('Case E Return Pending → Returned: OrderReturned fires once', async () => {
    await driveUpdateStatus('Return Pending', 'Returned', []);
    const returned = callsOf('OrderReturned');
    expect(returned).toHaveLength(1);
    expect(returned[0].eventId).toBe('order_returned_order-lc-1');
  });

  it('unmapped statuses (Hold, Packed, Shipping) emit no lifecycle event', async () => {
    await driveUpdateStatus('Pending', 'Hold', []);
    expect(lcCapture()).not.toHaveBeenCalled();
  });

  it('same-status rewrite emits nothing (defense in depth)', async () => {
    await (service as any).fireOrderStatusLifecycleEvent(
      lcOrder,
      'Confirmed',
      'Confirmed',
    );
    expect(lcCapture()).not.toHaveBeenCalled();
    await (service as any).fireOrderStatusLifecycleEvent(
      lcOrder,
      'Pending',
      'Hold',
    );
    expect(lcCapture()).not.toHaveBeenCalled();
  });

  it('repeated transitions reuse the identical deterministic eventId (retry-safe)', async () => {
    await (service as any).fireOrderStatusLifecycleEvent(
      lcOrder,
      'Pending',
      'Confirmed',
    );
    await (service as any).fireOrderStatusLifecycleEvent(
      lcOrder,
      'Pending',
      'Confirmed',
    );
    const confirmed = callsOf('OrderConfirmed');
    expect(confirmed).toHaveLength(2);
    // Same logical event → same id → snapshot UNIQUE collapses the retry
    // (proven at the capture layer); the id must never vary per attempt.
    expect(confirmed[0].eventId).toBe('order_confirmed_order-lc-1');
    expect(confirmed[1].eventId).toBe('order_confirmed_order-lc-1');
  });

  it('verifyPayment Confirmed transition emits OrderConfirmed', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...lcOrder,
      salesChannel: 'WEBSITE',
      paymentStatus: 'PAYMENT_VERIFYING',
      status: { id: 'status-pp', name: 'Payment Pending' },
    });
    (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue({
      ...lcStatuses.Confirmed,
    });
    (prisma.order.update as jest.Mock).mockResolvedValue({
      ...lcOrder,
      paymentStatus: 'PAID',
      status: { ...lcStatuses.Confirmed },
    });
    (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
    (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});
    await service.verifyPayment('order-lc-1', true, 'ok');
    const confirmed = callsOf('OrderConfirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].payload.lifecycleFromStatus).toBe('Payment Pending');
  });

  it('lifecycle payload carries full Purchase parity (order/product/customer/attribution)', async () => {
    await driveUpdateStatus('Pending', 'Confirmed', validatedConfirmedSettings);
    const purchase = callsOf('Purchase')[0];
    const confirmed = callsOf('OrderConfirmed')[0];
    expect(purchase).toBeDefined();
    // Business data identical wherever applicable.
    for (const key of [
      'value',
      'currency',
      'content_ids',
      'content_type',
      'content_name',
      'content_category',
      'contents',
      'num_items',
      'customerId',
      'orderId',
    ]) {
      expect(confirmed.payload[key]).toEqual(purchase.payload[key]);
    }
    expect(confirmed.payload.customer).toEqual(purchase.payload.customer);
    expect(confirmed.ctxId).toBe(purchase.ctxId);
    expect(confirmed.orderId).toBe(purchase.orderId);
    // Identity fields differ only by design.
    expect(confirmed.eventId).toBe('order_confirmed_order-lc-1');
    expect(confirmed.eventType).toBe('OrderConfirmed');
    expect(confirmed.payload.triggerMode).toBeUndefined();
    expect(purchase.payload.lifecycleStage).toBeUndefined();
  });

  it('bulk transitions emit per-order lifecycle events without skipping siblings', async () => {
    const pendingA = { ...lcOrder, id: 'order-a', status: { name: 'Pending' } };
    const pendingB = { ...lcOrder, id: 'order-b', status: { name: 'Pending' } };
    (prisma.order.findMany as jest.Mock).mockResolvedValue([pendingA, pendingB]);
    (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue({
      ...lcStatuses.Confirmed,
    });
    (prisma.order.findUnique as jest.Mock).mockImplementation(
      async (args: any) => ({ ...lcOrder, id: args.where.id }),
    );
    (prisma.systemSetting.findMany as jest.Mock).mockResolvedValue([]);
    await service.bulkStatusChange(
      ['order-a', 'order-b'],
      'status-confirmed',
      'admin-1',
    );
    const confirmed = callsOf('OrderConfirmed');
    expect(confirmed.map((c: any) => c.eventId).sort()).toEqual([
      'order_confirmed_order-a',
      'order_confirmed_order-b',
    ]);
  });
});

  describe('getRemainingFulfillment — short fulfillment is NOT courier Partial', () => {
    it('returns ordered − Σ(dispatched, non-cancelled) per line', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        trashedAt: null,
        items: [
          { id: 'i1', productId: 'p1', variantId: null, quantity: 4 },
          { id: 'i2', productId: 'p2', variantId: null, quantity: 2 },
        ],
        dispatches: [
          { status: 'DELIVERED', productMapping: [{ productVariantId: 'p1', quantity: 2 }] },
          { status: 'DELIVERED', productMapping: [{ productVariantId: 'p2', quantity: 1 }] },
          { status: 'CANCELLED', productMapping: [{ productVariantId: 'p1', quantity: 99 }] },
        ],
      });

      const result = await service.getRemainingFulfillment('order-1');

      expect(result).toEqual([
        { orderItemId: 'i1', productId: 'p1', variantId: null, ordered: 4, dispatched: 2, remaining: 2 },
        { orderItemId: 'i2', productId: 'p2', variantId: null, ordered: 2, dispatched: 1, remaining: 1 },
      ]);
    });

    it('throws NotFound for a missing order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getRemainingFulfillment('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('exchange-linked Returned gate (Task 4 Fix 8)', () => {
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

    function mockReturnedPath() {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(returnPendingOrder);
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(returnedStatus);
      (prisma.order.update as jest.Mock).mockResolvedValue({
        ...returnPendingOrder,
        statusId: 'status-returned',
        status: returnedStatus,
      });
      (prisma.orderItem as any).findMany = jest.fn().mockResolvedValue([]);
      (prisma.orderItem as any).update = jest.fn().mockResolvedValue({});
      // Hardening (2): the Returned status change resolves linked returns and
      // may auto-create ONE FULL return — wire the return models so the
      // guarded path runs (findUnique sees created + listed rows).
      const listed: any[] = [];
      ((prisma as any).return.findMany as jest.Mock).mockImplementation(async () => listed);
      const findRow = (id: string) => listed.find((r) => r.id === id) ?? null;
      (prisma as any).return.create = jest.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: 'ret-auto', displayId: 'RTN-1', createdAt: new Date(), stockReconciled: false, ...data };
        listed.push(row);
        return row;
      });
      (prisma as any).return.findUnique = jest.fn().mockImplementation(async ({ where }: any) =>
        findRow(where?.id),
      );
      (prisma as any).return.update = jest.fn().mockImplementation(async ({ where, data }: any) => {
        const row = findRow(where?.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where?.id, ...data };
      });
      (prisma as any).returnCounter = {
        upsert: jest.fn().mockResolvedValue({ date: '250115', seq: 1 }),
      };
    }

    function listReturns(rows: any[]) {
      ((prisma as any).return.findMany as jest.Mock).mockImplementation(async () => rows);
      (prisma as any).return.findUnique = jest.fn().mockImplementation(async ({ where }: any) =>
        rows.find((r) => r.id === where?.id) ?? null,
      );
      (prisma as any).return.update = jest.fn().mockImplementation(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where?.id);
        if (row) Object.assign(row, data);
        return row ?? { id: where?.id, ...data };
      });
    }

    it('blocks a manual Returned while the exchange order is not delivered', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ]);
      ((prisma as any).dispatch.findMany as jest.Mock).mockResolvedValue([
        { orderId: 'ex-1', status: 'SHIPPING' },
      ]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([]);

      await expect(
        service.updateStatus('order-id-1', { statusId: 'status-returned' }, 'staff-123'),
      ).rejects.toThrow(/EX-260930-0001.*delivered/i);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('blocks a manual Returned when delivered but the EXCHANGE return has not arrived', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ]);
      ((prisma as any).dispatch.findMany as jest.Mock).mockResolvedValue([
        { orderId: 'ex-1', status: 'DELIVERED' },
      ]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([
        { id: 'ret-1', displayId: 'RTN-260930-0001', status: 'REQUESTED' },
      ]);

      await expect(
        service.updateStatus('order-id-1', { statusId: 'status-returned' }, 'staff-123'),
      ).rejects.toThrow(/RTN-260930-0001.*arrived/i);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('allows a manual Returned once the exchange is delivered AND the return arrived', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ]);
      ((prisma as any).dispatch.findMany as jest.Mock).mockResolvedValue([
        { orderId: 'ex-1', status: 'DELIVERED' },
      ]);
      // RECEIVED (not yet reconciled) → the status change receives it through
      // the guarded path — never the blanket direct write.
      listReturns([
        {
          id: 'ret-1',
          displayId: 'RTN-260930-0001',
          orderId: 'order-id-1',
          type: 'EXCHANGE',
          status: 'RECEIVED',
          stockReconciled: false,
          items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
        },
      ]);
      const cancelReturnStock = module.get<CancelReturnStockService>(CancelReturnStockService);

      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-returned' },
        'staff-123',
      );

      expect(result.statusId).toBe('status-returned');
      expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-id-1', returnId: 'ret-1' }),
      );
      expect(cancelReturnStock.restoreForOrder).not.toHaveBeenCalled();
    });

    it('lets an unlinked order straight through (no exchange, no EXCHANGE return)', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-returned' },
        'staff-123',
      );
      expect(result.statusId).toBe('status-returned');
    });

    it('still blocks automated actors first (never auto from an exchange event alone)', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ]);
      ((prisma as any).dispatch.findMany as jest.Mock).mockResolvedValue([
        { orderId: 'ex-1', status: 'DELIVERED' },
      ]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([
        { id: 'ret-1', displayId: 'RTN-260930-0001', status: 'RESTOCKED' },
      ]);

      // Even with BOTH signals ready, an automated actor (webhook/system)
      // can never confirm Returned — staff only.
      await expect(
        service.updateStatus('order-id-1', { statusId: 'status-returned' }, 'system'),
      ).rejects.toThrow(/automated process/i);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('fail-closed: throws when exchange children exist but the dispatch surface is missing', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([]);
      (prisma as any).dispatch.findMany = undefined;

      await expect(
        service.updateStatus('order-id-1', { statusId: 'status-returned' }, 'staff-123'),
      ).rejects.toThrow(/delivery state is unknown|not been delivered/i);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('fail-closed: throws when exchange children exist but the dispatch query throws', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'ex-1', displayId: 'EX-260930-0001' },
      ]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).dispatch.findMany as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.updateStatus('order-id-1', { statusId: 'status-returned' }, 'staff-123'),
      ).rejects.toThrow(/delivery state is unknown|not been delivered/i);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('keeps current behavior when zero exchanges and the dispatch surface is missing', async () => {
      mockReturnedPath();
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
      ((prisma as any).return.findMany as jest.Mock).mockResolvedValue([]);
      (prisma as any).dispatch.findMany = undefined;

      const result = await service.updateStatus(
        'order-id-1',
        { statusId: 'status-returned' },
        'staff-123',
      );
      expect(result.statusId).toBe('status-returned');
    });
  });
});
