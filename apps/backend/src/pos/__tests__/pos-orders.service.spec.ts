import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PosOrdersService } from '../pos-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { ConfigService } from '@nestjs/config';

describe('PosOrdersService', () => {
  let service: PosOrdersService;
  let prisma: PrismaService;
  let module: TestingModule;

  const mockSession = {
    id: 'session-1',
    cashierId: 'cashier-1',
    status: 'open',
    showroomId: 'showroom-1',
    showroom: { id: 'showroom-1', name: 'Showroom' },
    openingBalance: 0,
    closingBalance: null,
    expectedBalance: null,
    notes: null,
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProduct = {
    id: 'prod-1',
    isActive: true,
    name: 'Test Product',
    basePrice: 1000,
    salePrice: null,
  };

  const mockVariant = {
    id: 'variant-1',
    isActive: true,
    price: 1500,
    salePrice: null,
    productId: 'prod-1',
    product: { id: 'prod-1', isActive: true, name: 'Test Product' },
  };

  const mockOrder = {
    id: 'order-1',
    displayId: 'POS-250715-0001',
    total: 2000,
    subtotal: 2000,
    discount: 0,
    paymentStatus: 'PAID',
    items: [],
    payments: [],
    customer: null,
  };

  const mockStatus = {
    id: 'status-delivered',
    name: 'Delivered',
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        PosOrdersService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
            posSession: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
            },
            product: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            productVariant: {
              findMany: jest.fn(),
            },
            combo: {
              findMany: jest.fn(),
            },
            order: {
              findFirst: jest.fn(),
              create: jest.fn(),
              findMany: jest.fn(),
            },
            orderStatus: {
              findFirst: jest.fn(),
            },
            orderCounter: {
              upsert: jest.fn(),
            },
            orderItem: {
              create: jest.fn(),
            },
            payment: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: StockService,
          useValue: {
            addPhysical: jest.fn().mockResolvedValue(undefined),
            reserve: jest.fn().mockResolvedValue(undefined),
            deduct: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
            resolve: jest.fn().mockReturnValue({ ms: 'skip', pi: 'skip' }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000'),
          },
        },
      ],
    }).compile();

    service = module.get<PosOrdersService>(PosOrdersService);
    prisma = module.get<PrismaService>(PrismaService);

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => Promise<any>) => cb(prisma),
    );

    // Default mock for orderCounter.upsert (required by generateDisplayId)
    (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({
      date: '250715',
      seq: 1,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    describe('session validation', () => {
      it('should reject non-existent session', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(
          service.create(
            { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
            'session-1',
            'cashier-1',
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(
            { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
            'session-1',
            'cashier-1',
          ),
        ).rejects.toThrow(/not found/i);
      });

      it('should reject closed session', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue({
          ...mockSession,
          status: 'closed',
        });

        await expect(
          service.create(
            { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
            'session-1',
            'cashier-1',
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(
            { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
            'session-1',
            'cashier-1',
          ),
        ).rejects.toThrow(/not active/i);
      });

      it('should reject foreign session (different cashier)', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue({
          ...mockSession,
          cashierId: 'other-cashier',
        });

        await expect(
          service.create(
            { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
            'session-1',
            'cashier-1',
          ),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(
            { items: [{ productId: 'prod-1', quantity: 1, price: 1000 }] },
            'session-1',
            'cashier-1',
          ),
        ).rejects.toThrow(/does not belong to this cashier/i);
      });
    });

    describe('price and item validation', () => {
      it('should reject forged item price (client sends different price than DB)', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 500 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/price mismatch/i);
      });

      it('should reject non-existent variant', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([]);

        const dto = {
          items: [
            { variantId: 'nonexistent-variant', quantity: 1, price: 1000 },
          ],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/not found/i);
      });

      it('should reject inactive variant', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          { ...mockVariant, isActive: false },
        ]);

        const dto = {
          items: [{ variantId: 'variant-1', quantity: 1, price: 1500 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/inactive/i);
      });

      it('should reject inactive product', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([
          { ...mockProduct, isActive: false },
        ]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/inactive/i);
      });

      it('should reject non-existent product', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([]);

        const dto = {
          items: [{ productId: 'nonexistent-prod', quantity: 1, price: 1000 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/not found/i);
      });

      it('should reject negative quantity', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: -1, price: 1000 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/invalid quantity/i);
      });

      it('should reject zero quantity', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 0, price: 1000 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/invalid quantity/i);
      });

      it('should reject item with no productId, variantId, or comboId', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );

        const dto = {
          items: [{ quantity: 1, price: 1000 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/must have at least one/i);
      });

      it('should reject variant/product mismatch when item.productId differs from variant.productId', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          { ...mockVariant, productId: 'different-product' },
        ]);
        (prisma.product.findMany as jest.Mock).mockResolvedValue([
          mockProduct,
          { id: 'different-product', isActive: true, basePrice: 2000, salePrice: null, name: 'Other' },
        ]);

        const dto = {
          items: [{ productId: 'prod-1', variantId: 'variant-1', quantity: 1, price: 1500 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/does not belong to product/i);
      });
    });

    describe('discount validation', () => {
      it('should reject percentage discount > 100', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
          discount: 150,
          discountType: 'percentage' as const,
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot exceed 100/i);
      });

      it('should reject negative percentage discount', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
          discount: -10,
          discountType: 'percentage' as const,
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot be negative/i);
      });

      it('should reject negative flat discount', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
          discount: -50,
          discountType: 'flat' as const,
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot be negative/i);
      });

      it('should reject flat discount exceeding subtotal', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
          discount: 2000,
          discountType: 'flat' as const,
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot exceed subtotal/i);
      });

      it('should reject negative item-level percentage discount', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(mockSession);
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000, discount: -10, discountType: 'percentage' }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot be negative/i);
      });

      it('should reject item-level percentage discount > 100', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(mockSession);
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000, discount: 150, discountType: 'percentage' }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot exceed 100/i);
      });

      it('should reject item-level flat discount exceeding line total', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(mockSession);
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000, discount: 1500, discountType: 'flat' }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/cannot exceed line total/i);
      });

      it('should reject non-finite item discount', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(mockSession);
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000, discount: Infinity, discountType: 'flat' }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/must be a finite/i);
      });
    });

    describe('payment validation', () => {
      it('should reject payment splits exceeding computed total', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
        (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({
          date: '250715',
          seq: 1,
        });
        (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
          mockStatus,
        );
        (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
        (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
          payments: [
            { method: 'CASH', amount: 800 },
            { method: 'CARD', amount: 500 },
          ],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/exceeds order total/i);
      });

      it('should accept payment splits summing to exactly the total', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
        (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({
          date: '250715',
          seq: 1,
        });
        (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
          mockStatus,
        );
        (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
        (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
          payments: [
            { method: 'CASH', amount: 600 },
            { method: 'CARD', amount: 400 },
          ],
        };

        const result = await service.create(dto, 'session-1', 'cashier-1');
        expect(result).toBeDefined();
      });

      it('should reject payment splits summing to less than total (exact required for PAID)', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
        (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({
          date: '250715',
          seq: 1,
        });
        (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
          mockStatus,
        );
        (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
        (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 2, price: 1000 }],
          payments: [{ method: 'CASH', amount: 1500 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('successful creation', () => {
      function setupSuccessMocks() {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.combo.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({
          date: '250715',
          seq: 1,
        });
        (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue(
          mockStatus,
        );
        (prisma.order.create as jest.Mock).mockResolvedValue(mockOrder);
        (prisma.order.findFirst as jest.Mock).mockResolvedValue(mockOrder);
      }

      it('should use server-computed total (DB authoritative)', async () => {
        setupSuccessMocks();

        const dto = {
          items: [{ productId: 'prod-1', quantity: 2, price: 1000 }],
        };

        await service.create(dto, 'session-1', 'cashier-1');

        expect(prisma.order.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              subtotal: 2000,
              total: 2000,
            }),
          }),
        );
      });

      it('should preserve legitimate percentage discount', async () => {
        setupSuccessMocks();

        const dto = {
          items: [{ productId: 'prod-1', quantity: 2, price: 1000 }],
          discount: 10,
          discountType: 'percentage' as const,
          payments: [{ method: 'CASH', amount: 1800 }],
        };

        const result = await service.create(dto, 'session-1', 'cashier-1');

        expect(prisma.order.create).toHaveBeenCalled();
        expect(result).toBeDefined();
      });

      it('should preserve legitimate flat discount', async () => {
        setupSuccessMocks();

        const dto = {
          items: [{ productId: 'prod-1', quantity: 2, price: 1000 }],
          discount: 500,
          discountType: 'flat' as const,
          payments: [{ method: 'CASH', amount: 1500 }],
        };

        const result = await service.create(dto, 'session-1', 'cashier-1');

        expect(prisma.order.create).toHaveBeenCalled();
        expect(result).toBeDefined();
      });

      it('should succeed with multiple valid payment splits', async () => {
        setupSuccessMocks();

        const dto = {
          items: [{ productId: 'prod-1', quantity: 2, price: 1000 }],
          payments: [
            { method: 'CASH', amount: 1000 },
            { method: 'CARD', amount: 500 },
            { method: 'MOBILE', amount: 500 },
          ],
        };

        const result = await service.create(dto, 'session-1', 'cashier-1');

        expect(prisma.order.create).toHaveBeenCalled();
        expect(prisma.payment.create).toHaveBeenCalledTimes(3);
        expect(result).toBeDefined();
      });

      it('should default to CASH payment when no payments provided', async () => {
        setupSuccessMocks();

        const dto = {
          items: [{ productId: 'prod-1', quantity: 2, price: 1000 }],
        };

        const result = await service.create(dto, 'session-1', 'cashier-1');

        expect(prisma.payment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              gatewayCode: 'CASH',
              amount: 2000,
            }),
          }),
        );
        expect(result).toBeDefined();
      });

      it('should handle sale price (use salePrice when set)', async () => {
        setupSuccessMocks();
        // Override product mock with salePrice
        (prisma.product.findMany as jest.Mock).mockResolvedValue([
          { ...mockProduct, salePrice: 800, basePrice: 1000 },
        ]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 800 }],
        };

        const result = await service.create(dto, 'session-1', 'cashier-1');
        expect(result).toBeDefined();
      });

      it('should reject client price matching basePrice when salePrice is set', async () => {
        (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(
          mockSession,
        );
        (prisma.product.findMany as jest.Mock).mockResolvedValue([
          { ...mockProduct, salePrice: 800, basePrice: 1000 },
        ]);

        const dto = {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
        };

        await expect(
          service.create(dto, 'session-1', 'cashier-1'),
        ).rejects.toThrow(/price mismatch/i);
      });
    });
  });
});
