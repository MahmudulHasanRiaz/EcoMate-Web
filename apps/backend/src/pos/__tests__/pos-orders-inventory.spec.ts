import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PosOrdersService } from '../pos-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { ConfigService } from '@nestjs/config';
import { MediaResolverService } from '../../media/media-resolver.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';

describe('PosOrdersService — Inventory-Aware Extensions', () => {
  let service: PosOrdersService;
  let prisma: PrismaService;
  let stock: StockService;
  let stockRouter: StockRouterService;
  let module: TestingModule;

  const mockSession = {
    id: 'session-1',
    cashierId: 'cashier-1',
    status: 'open',
    showroomId: 'showroom-1',
    showroom: { id: 'showroom-1', name: 'Gulshan' },
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
    managedStockQuantity: 10,
    reservedStock: 0,
    type: 'simple',
    images: [],
    sku: 'TST-001',
    variants: [],
  };

  const mockVariantProduct = {
    ...mockProduct,
    id: 'prod-2',
    type: 'variable',
    variants: [
      {
        id: 'variant-1',
        sku: 'TST-001-RED',
        managedStockQuantity: 5,
        reservedStock: 0,
        isActive: true,
        price: 1200,
        salePrice: null,
        stock: 5,
        attributeValues: [],
      },
      {
        id: 'variant-2',
        sku: 'TST-001-BLUE',
        managedStockQuantity: 3,
        reservedStock: 0,
        isActive: true,
        price: 1200,
        salePrice: null,
        stock: 3,
        attributeValues: [],
      },
    ],
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        PosOrdersService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            posSession: { findUnique: jest.fn() },
            product: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
            productVariant: { findMany: jest.fn(), findUnique: jest.fn() },
            combo: { findMany: jest.fn() },
            order: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
            orderStatus: { findFirst: jest.fn() },
            orderCounter: { upsert: jest.fn() },
            orderItem: { create: jest.fn() },
            payment: { create: jest.fn() },
            physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
            stockTransfer: { create: jest.fn() },
            category: { findMany: jest.fn() },
            $queryRawUnsafe: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: StockService,
          useValue: {
            checkPhysicalAvailability: jest.fn(),
            getAvailableStock: jest.fn(),
            addPhysical: jest.fn().mockResolvedValue(undefined),
            reserve: jest.fn().mockResolvedValue(undefined),
            deduct: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn(),
            resolve: jest.fn().mockReturnValue({ ms: 'skip', pi: 'skip' }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
        {
          provide: MediaResolverService,
          useValue: { resolve: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: TrackingCaptureService,
          useValue: { capture: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: TrackingSettingsService,
          useValue: {
            buildConfigSnapshot: jest.fn().mockResolvedValue({
              enabledProviders: ['meta'],
              normalizerVersion: 1,
              currency: 'BDT',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PosOrdersService>(PosOrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    stock = module.get<StockService>(StockService);
    stockRouter = module.get<StockRouterService>(StockRouterService);

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => Promise<any>) => cb(prisma),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── validateStock() ─────────────────────────────────────────

  describe('validateStock', () => {
    it('returns allAvailable=true when IM OFF and managed stock has enough', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(false);
      (stock.getAvailableStock as jest.Mock).mockResolvedValue({ stock: 10, reserved: 0, available: 10 });

      const result = await service.validateStock(
        { items: [{ productId: 'prod-1', quantity: 3 }] },
        'showroom-1',
      );

      expect(result.allAvailable).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].available).toBe(true);
    });

    it('returns allAvailable=false when IM OFF and managed stock is insufficient', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(false);
      (stock.getAvailableStock as jest.Mock).mockResolvedValue({ stock: 2, reserved: 0, available: 2 });

      const result = await service.validateStock(
        { items: [{ productId: 'prod-1', quantity: 5 }] },
        'showroom-1',
      );

      expect(result.allAvailable).toBe(false);
      expect(result.items[0].available).toBe(false);
    });

    it('returns allAvailable=true when IM ON and physical stock has enough', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      (stock.checkPhysicalAvailability as jest.Mock).mockResolvedValue({
        currentStock: 15,
        reserved: 2,
        availableStock: 13,
      });

      const result = await service.validateStock(
        { items: [{ productId: 'prod-1', quantity: 5 }] },
        'showroom-1',
      );

      expect(result.allAvailable).toBe(true);
      expect(result.items[0].available).toBe(true);
    });

    it('includes alternatives when stock is insufficient in current showroom', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      (stock.checkPhysicalAvailability as jest.Mock).mockResolvedValue({
        currentStock: 1,
        reserved: 0,
        availableStock: 1,
      });
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        {
          quantity: 12,
          reservedQuantity: 0,
          warehouse: { id: 'banani', name: 'Banani', type: 'showroom' },
        },
        {
          quantity: 5,
          reservedQuantity: 0,
          warehouse: { id: 'warehouse', name: 'Main WH', type: 'main' },
        },
      ]);

      const result = await service.validateStock(
        { items: [{ productId: 'prod-1', quantity: 3 }] },
        'showroom-1',
      );

      expect(result.allAvailable).toBe(false);
      expect(result.items[0].available).toBe(false);
      expect(result.items[0].alternatives).toHaveLength(2);
      expect(result.items[0].alternatives[0].warehouseName).toBe('Banani');
      expect(result.items[0].alternatives[0].available).toBe(12);
    });

    it('handles empty items array', async () => {
      const result = await service.validateStock({ items: [] }, 'showroom-1');
      expect(result.allAvailable).toBe(true);
      expect(result.items).toHaveLength(0);
    });
  });

  // ─── getProductAvailability() ─────────────────────────────────

  describe('getProductAvailability', () => {
    it('returns current showroom stock + network when IM ON', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      (stock.checkPhysicalAvailability as jest.Mock).mockResolvedValue({
        currentStock: 5,
        reserved: 1,
        availableStock: 4,
      });
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        {
          quantity: 10,
          reservedQuantity: 0,
          warehouse: { id: 'banani', name: 'Banani', type: 'showroom' },
        },
      ]);

      const result = await service.getProductAvailability('prod-1', 'showroom-1');

      expect(result.currentShowroom.available).toBe(4);
      expect(result.network).toHaveLength(1);
      expect(result.network[0].warehouseName).toBe('Banani');
    });

    it('returns global managed stock when IM OFF', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(false);
      (stock.getAvailableStock as jest.Mock).mockResolvedValue({ stock: 20, reserved: 3, available: 17 });

      const result = await service.getProductAvailability('prod-1', 'showroom-1');

      expect(result.currentShowroom.available).toBe(17);
    });
  });

  // ─── getSessionShowroom() ─────────────────────────────────────

  describe('getSessionShowroom', () => {
    it('returns showroomId for valid session', async () => {
      (prisma.posSession.findUnique as jest.Mock).mockResolvedValue({ showroomId: 'showroom-1' });

      const result = await service.getSessionShowroom('session-1');
      expect(result.showroomId).toBe('showroom-1');
    });

    it('throws for missing session', async () => {
      (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getSessionShowroom('invalid-session'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── findProducts() with showroomId ───────────────────────────

  describe('findProducts with showroomId', () => {
    it('adds _showroomStock and _showroomAvailable when showroomId provided (IM ON)', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([{ ...mockProduct }]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        { productId: 'prod-1', variantId: null, quantity: 8, reservedQuantity: 1 },
      ]);

      const result = await service.findProducts({ showroomId: 'showroom-1' });

      expect(result.data[0]._showroomStock).toBe(8);
      expect(result.data[0]._showroomAvailable).toBe(7);
    });

    it('uses managedStockQuantity when IM OFF', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(false);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([{ ...mockProduct }]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findProducts({ showroomId: 'showroom-1' });

      expect(result.data[0]._showroomStock).toBe(10);
      expect(result.data[0]._showroomAvailable).toBe(10);
    });

    it('preserves existing behavior when showroomId not provided', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findProducts({});

      expect(result.data[0]._showroomStock).toBeUndefined();
      expect(result.data[0]._showroomAvailable).toBeUndefined();
    });

    it('computes _showroomStock for variable product variants', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([{ ...mockVariantProduct }]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);
      // variant-level physical records
      (prisma.physicalInventory.findMany as jest.Mock).mockResolvedValue([
        { productId: 'prod-2', variantId: 'variant-1', quantity: 4, reservedQuantity: 1 },
        { productId: 'prod-2', variantId: 'variant-2', quantity: 2, reservedQuantity: 0 },
      ]);

      const result = await service.findProducts({ showroomId: 'showroom-1' });

      expect(result.data[0].variants[0]._showroomStock).toBe(4);
      expect(result.data[0].variants[0]._showroomAvailable).toBe(3);
      expect(result.data[0].variants[1]._showroomStock).toBe(2);
      expect(result.data[0].variants[1]._showroomAvailable).toBe(2);
    });
  });

  // ─── initiateTransfer() ───────────────────────────────────────

  describe('initiateTransfer', () => {
    it('creates stock transfer with REQUESTED status and correct destWarehouseId', async () => {
      (prisma.stockTransfer.create as jest.Mock).mockResolvedValue({ id: 'trf-1' });

      const result = await service.initiateTransfer(
        {
          items: [{ productId: 'prod-1', sourceWarehouseId: 'banani', quantity: 5 }],
          orderId: 'order-1',
        },
        'cashier-1',
        'showroom-1',
      );

      expect(prisma.stockTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceWarehouseId: 'banani',
            destWarehouseId: 'showroom-1',
            status: 'REQUESTED',
            orderId: 'order-1',
            requestedBy: 'cashier-1',
          }),
        }),
      );
      expect(result.transfers).toHaveLength(1);
      expect(result.count).toBe(1);
    });
  });

  // ─── create() with sourceWarehouseId (cross-warehouse) ────────

  describe('create with cross-warehouse items', () => {
    function setupMocks() {
      (prisma.posSession.findUnique as jest.Mock).mockResolvedValue(mockSession);
      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({
        id: 'prod-1',
        availabilityMode: 'INVENTORY_CONTROLLED',
        manageStock: true,
      });
      (stockRouter.resolve as jest.Mock).mockReturnValue({ ms: 'skip', pi: 'fulfill' });
      (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.combo.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderCounter.upsert as jest.Mock).mockResolvedValue({ date: '250715', seq: 1 });
      (prisma.orderStatus.findFirst as jest.Mock).mockResolvedValue({ id: 'status-1', name: 'Delivered' });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        id: 'order-1', displayId: 'POS-250715-0001', total: 1000,
        subtotal: 1000, discount: 0, paymentStatus: 'PAID',
        items: [], payments: [], customer: null,
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: 'order-1', displayId: 'POS-250715-0001', total: 1000,
        items: [], payments: [], customer: null,
      });
    }

    it('skips stock deduction for cross-warehouse items (source != current showroom)', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      setupMocks();

      await service.create(
        {
          items: [{
            productId: 'prod-1',
            quantity: 2,
            price: 1000,
            sourceWarehouseId: 'banani',
          }],
        },
        'session-1',
        'cashier-1',
      );

      // addPhysical should NOT be called for cross-warehouse items
      expect(stock.addPhysical).not.toHaveBeenCalled();
    });

    it('deducts stock normally for current-showroom items (source == current)', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      setupMocks();

      await service.create(
        {
          items: [{
            productId: 'prod-1',
            quantity: 2,
            price: 1000,
            sourceWarehouseId: 'showroom-1',
          }],
        },
        'session-1',
        'cashier-1',
      );

      // addPhysical SHOULD be called for current-showroom items
      expect(stock.addPhysical).toHaveBeenCalled();
    });

    it('deducts stock normally when sourceWarehouseId is null (default)', async () => {
      (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(true);
      setupMocks();

      await service.create(
        {
          items: [{ productId: 'prod-1', quantity: 1, price: 1000 }],
        },
        'session-1',
        'cashier-1',
      );

      expect(stock.addPhysical).toHaveBeenCalled();
    });
  });
});