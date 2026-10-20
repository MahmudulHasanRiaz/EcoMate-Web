import { Test, TestingModule } from '@nestjs/testing';
import { CancelReturnStockService } from '../cancel-return-stock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock.service';
import { StockRouterService } from '../stock-router.service';
import { CostingLotService } from '../costing-lot.service';
import { CacheService } from '../../cache/cache.service';

/**
 * Task 6 (Fix 13): item-level stock restore for Returns.
 *
 * restoreForOrder is blanket full-order — for a PARTIAL return it would
 * restock the kept/delivered part too. restoreForReturnItems restores ONLY the
 * Return.items quantities (productId + variantId + qty):
 * - exact-qty adds per matched product (managed `add` + physical `add`);
 * - unmatched products are NEVER touched (kept part must NOT restock);
 * - matched claims are disarmed (managed flags cleared, physical reservation
 *   marked handled) so a later blanket restoreForOrder (manual 'Returned')
 *   can never restore the same units twice;
 * - the ACTIVE cycle terminates only on full coverage (more may still arrive).
 */
describe('CancelReturnStockService.restoreForReturnItems (Task 6)', () => {
  let service: CancelReturnStockService;
  let tx: any;
  let stockService: any;
  let stockRouter: any;

  const managedProduct = {
    id: 'pa',
    availabilityMode: 'MANAGED_STOCK',
    manageStock: true,
    syncManagedStock: true,
    warehouseId: 'wh-1',
    managedStockQuantity: 5,
    reservedStock: 1,
    name: 'A',
  };
  const keptProduct = {
    id: 'pb',
    availabilityMode: 'MANAGED_STOCK',
    manageStock: true,
    syncManagedStock: true,
    warehouseId: 'wh-1',
    name: 'B',
  };

  function orderItem(id: string, product: any, quantity: number) {
    return {
      id,
      orderId: 'order-1',
      productId: product.id,
      variantId: null,
      comboId: null,
      quantity,
      managedStockDeducted: true,
      managedStockReserved: true,
      product,
    };
  }

  beforeEach(async () => {
    tx = {
      orderStockCycle: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          items: [orderItem('item-a', managedProduct, 5), orderItem('item-b', keptProduct, 3)],
        }),
      },
      orderItem: { update: jest.fn().mockResolvedValue({}) },
      orderItemComboComponent: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      physicalReservation: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.orderItemId_cycleId?.orderItemId === 'item-a') {
            return Promise.resolve({
              id: 'res-a',
              status: 'CONSUMED',
              productId: 'pa',
              variantId: null,
              warehouseId: 'wh-1',
              allocations: [{ id: 'alloc-a', physicalInventoryId: 'pi-1', quantity: 5 }],
            });
          }
          return Promise.resolve({
            id: 'res-b',
            status: 'CONSUMED',
            productId: 'pb',
            variantId: null,
            warehouseId: 'wh-1',
            allocations: [{ id: 'alloc-b', physicalInventoryId: 'pi-1', quantity: 3 }],
          });
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      comboComponentPhysicalReservation: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      physicalInventory: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ quantity: 10, reservedQuantity: 2 }]),
        findUnique: jest.fn().mockResolvedValue({ quantity: 10, reservedQuantity: 5 }),
      },
      product: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.id === 'pp'
              ? {
                  id: 'pp',
                  availabilityMode: 'INVENTORY_CONTROLLED',
                  manageStock: false,
                  warehouseId: 'wh-2',
                  managedStockQuantity: 0,
                  reservedStock: 0,
                }
              : managedProduct,
          ),
        ),
      },
      physicalInventoryLedger: { create: jest.fn().mockResolvedValue({}) },
      costingLotConsumption: { findFirst: jest.fn().mockResolvedValue(null) },
      costingLotRestoration: { create: jest.fn().mockResolvedValue({}) },
      costingLot: { update: jest.fn().mockResolvedValue({}) },
    };

    stockService = {
      operate: jest.fn().mockResolvedValue(undefined),
      operatePhysical: jest.fn().mockResolvedValue(undefined),
      reservePhysical: jest.fn().mockResolvedValue(undefined),
    };
    stockRouter = {
      isInventoryManagementEnabled: jest.fn().mockResolvedValue(true),
      resolve: jest.fn().mockReturnValue({ pi: 'track' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancelReturnStockService,
        { provide: PrismaService, useValue: {} },
        { provide: StockService, useValue: stockService },
        { provide: StockRouterService, useValue: stockRouter },
        { provide: CostingLotService, useValue: {} },
        { provide: CacheService, useValue: { invalidateByPrefix: jest.fn() } },
      ],
    }).compile();

    service = module.get<CancelReturnStockService>(CancelReturnStockService);
  });

  it('restores ONLY the Return.items quantity — the kept product never restocks', async () => {
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-1',
      tx,
    });

    expect(res.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 2 }]);
    // Managed engine: exact qty for pa…
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({ productId: 'pa', quantity: 2 }),
    );
    // …and NEVER pb (kept/delivered part must NOT restock).
    for (const [op, args] of stockService.operate.mock.calls as any[]) {
      expect(args?.productId).not.toBe('pb');
    }
    // Physical engine: reservation-aware direct restore (mirrors the blanket
    // restoreForOrder path — CONSUMED reservations restore on-hand via the
    // tx, never via operatePhysical). Exact qty for pa only…
    expect(tx.physicalInventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pi-1' }),
        data: expect.objectContaining({ quantity: expect.objectContaining({ increment: 2 }) }),
      }),
    );
    // …and NEVER pb (its reservation stays CONSUMED for the blanket path to
    // skip only if actually restored — here untouched).
    const piUpdates = (tx.physicalInventory.update.mock.calls as any[]);
    expect(piUpdates.length).toBeGreaterThan(0);
    for (const [args] of tx.physicalInventoryLedger.create.mock.calls as any[]) {
      expect(args?.data?.productId).not.toBe('pb');
    }
  });

  it('disarms matched claims so a later blanket restore cannot double-restore', async () => {
    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-1',
      tx,
    });

    // Managed flags cleared on the matched line only.
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-a' },
        data: expect.objectContaining({ managedStockDeducted: false, managedStockReserved: false }),
      }),
    );
    const clearedIds = (tx.orderItem.update.mock.calls as any[]).map((c) => c[0]?.where?.id);
    expect(clearedIds).not.toContain('item-b');
    // Physical reservation for the matched line marked handled…
    expect(tx.physicalReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'res-a' } }),
    );
    // …the kept line untouched.
    const resIds = (tx.physicalReservation.update.mock.calls as any[]).map(
      (c) => c[0]?.where?.id,
    );
    expect(resIds).not.toContain('res-b');
  });

  it('keeps the ACTIVE cycle on partial coverage; terminates on full coverage', async () => {
    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-1',
      tx,
    });
    expect(tx.orderStockCycle.update).not.toHaveBeenCalled();

    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [
        { productId: 'pa', quantity: 5 },
        { productId: 'pb', quantity: 3 },
      ],
      returnId: 'ret-2',
      tx,
    });
    expect(tx.orderStockCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cycle-1' }, data: { status: 'TERMINATED' } }),
    );
  });

  it('restores good units only and never restocks damaged units', async () => {
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 5, damagedQuantity: 2 }],
      returnId: 'ret-damaged',
      tx,
    });

    expect(res.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 3 }]);
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({ productId: 'pa', quantity: 3 }),
    );
    for (const [op, args] of stockService.operate.mock.calls as any[]) {
      expect(args?.quantity).not.toBe(5);
    }
    // The damaged units still count as covered: the claim is disarmed. The
    // cycle stays ACTIVE because product pb has not been returned.
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-a' } }),
    );
    expect(tx.orderStockCycle.update).not.toHaveBeenCalled();
  });

  it('restores nothing when the whole line is damaged', async () => {
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2, damagedQuantity: 2 }],
      returnId: 'ret-all-damaged',
      tx,
    });
    expect(res.restored).toEqual([]);
    expect(stockService.operate).not.toHaveBeenCalled();
    expect(tx.physicalInventory.update).not.toHaveBeenCalled();
  });

  it('caps restoration at the ordered quantity and skips non-positive lines', async () => {
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [
        { productId: 'pa', quantity: 99 },
        { productId: 'pb', quantity: 0 },
      ],
      returnId: 'ret-1',
      tx,
    });
    expect(res.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 5 }]);
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({ productId: 'pa', quantity: 5 }),
    );
  });

  describe('damageWriteOff', () => {
    it('writes managed stock off through the authoritative scrap engine', async () => {
      const res = await service.damageWriteOff({
        productId: 'pa',
        quantity: 2,
        reference: 'damage-RTN-1',
        performedBy: 'staff@x.com',
        tx,
      });
      expect(res).toEqual({ managed: true, warehouseId: null });
      expect(stockService.operate).toHaveBeenCalledWith(
        'scrap',
        expect.objectContaining({
          productId: 'pa',
          quantity: 2,
          ledgerType: 'ADJUSTMENT',
          referenceType: 'ADJUSTMENT',
          performedBy: 'staff@x.com',
        }),
      );
      expect(stockService.operatePhysical).not.toHaveBeenCalled();
    });

    it('fails closed when managed sellable stock is insufficient', async () => {
      await expect(
        service.damageWriteOff({
          productId: 'pa',
          quantity: 10,
          reference: 'damage-RTN-1',
          tx,
        }),
      ).rejects.toThrow(/Only 4 unit\(s\) available/i);
      expect(stockService.operate).not.toHaveBeenCalled();
    });

    it('writes physical stock off at the return warehouse through operatePhysical', async () => {
      const res = await service.damageWriteOff({
        productId: 'pp',
        quantity: 2,
        warehouseId: 'wh-2',
        reference: 'damage-RTN-2',
        tx,
      });
      expect(res).toEqual({ managed: false, warehouseId: 'wh-2' });
      expect(stockService.operatePhysical).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({
          productId: 'pp',
          warehouseId: 'wh-2',
          quantity: -2,
          ledgerType: 'ADJUSTMENT',
          referenceType: 'ADJUSTMENT',
        }),
      );
    });
  });
});
