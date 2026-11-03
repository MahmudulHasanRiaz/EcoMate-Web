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

  it('a partial receive restores its units but keeps the claim ARMED (no early disarm)', async () => {
    // Audit item 4: disarming on a partial receive (flags cleared +
    // reservation RESTORED) is what made the SECOND partial return
    // restore nothing. The claim must stay armed until cumulative
    // settlement reaches the line quantity.
    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-1',
      tx,
    });

    // Managed flags NOT cleared — the remaining 3 units stay restorable.
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    // Physical reservation NOT marked handled.
    expect(tx.physicalReservation.update).not.toHaveBeenCalled();
  });

  it('full coverage disarms the claim so a later blanket restore cannot double-restore', async () => {
    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 5 }],
      returnId: 'ret-full',
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

  it('two partial receives against one line together restore the full line (cumulative)', async () => {
    // First partial: 2 of 5 arrive.
    tx.return = { findMany: jest.fn().mockResolvedValue([]) };
    const first = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-1',
      tx,
    });
    expect(first.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 2 }]);
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.physicalReservation.update).not.toHaveBeenCalled();

    jest.clearAllMocks();

    // Second partial: the remaining 3 arrive in a NEW return. The first
    // return is now stockReconciled — its items are the settlement
    // evidence, so the claim starts with remaining = 3, and the physical
    // walk skips the 2 units already put back.
    tx.return = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ret-1',
          items: [{ productId: 'pa', variantId: null, quantity: 2, damagedQuantity: 0 }],
        },
      ]),
    };
    const second = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 3 }],
      returnId: 'ret-2',
      tx,
    });
    expect(second.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 3 }]);
    // Managed: exactly the remaining 3 are added (not 5, not 0).
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({ productId: 'pa', quantity: 3 }),
    );
    // Physical: the allocation walk skips the 2 restored units and adds 3.
    expect(tx.physicalInventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pi-1' }),
        data: expect.objectContaining({ quantity: expect.objectContaining({ increment: 3 }) }),
      }),
    );
    // NOW the claim is fully settled: flags cleared + reservation RESTORED.
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-a' },
        data: expect.objectContaining({ managedStockDeducted: false, managedStockReserved: false }),
      }),
    );
    expect(tx.physicalReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'res-a' }, data: { status: 'RESTORED' } }),
    );
  });

  it('a damaged-only partial settles only the damaged share — the good remainder stays armed', async () => {
    tx.return = { findMany: jest.fn().mockResolvedValue([]) };
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2, damagedQuantity: 2 }],
      returnId: 'ret-dmg-1',
      tx,
    });
    expect(res.restored).toEqual([]);
    // Nothing restocks (damaged never sells again)…
    for (const [op] of stockService.operate.mock.calls as any[]) {
      expect(op).not.toBe('add');
    }
    // …but the claim is NOT disarmed: flags stay set, reservation stays.
    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.physicalReservation.update).not.toHaveBeenCalled();

    jest.clearAllMocks();

    // The good remainder (3 units) arrives later and restores normally.
    tx.return = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ret-dmg-1',
          items: [{ productId: 'pa', variantId: null, quantity: 2, damagedQuantity: 2 }],
        },
      ]),
    };
    const second = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 3 }],
      returnId: 'ret-dmg-2',
      tx,
    });
    expect(second.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 3 }]);
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({ productId: 'pa', quantity: 3 }),
    );
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-a' } }),
    );
    expect(tx.physicalReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'res-a' }, data: { status: 'RESTORED' } }),
    );
  });

  it('a later blanket restoreForOrder restores only the unsettled remainder', async () => {
    tx.return = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ret-1',
          items: [{ productId: 'pa', variantId: null, quantity: 2, damagedQuantity: 0 }],
        },
      ]),
    };
    tx.costingLotConsumption.findMany = jest.fn().mockResolvedValue([]);

    await service.restoreForOrder({
      orderId: 'order-1',
      referencePrefix: 'return',
      tx,
    });

    // pa: 2 of 5 already restored by the item-level return → blanket adds 3.
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({ productId: 'pa', quantity: 3 }),
    );
    for (const [op, args] of stockService.operate.mock.calls as any[]) {
      if (op === 'add' && args?.productId === 'pa') {
        expect(args.quantity).toBe(3);
      }
    }
    // Physical walk skips the 2 restored units and increments exactly 3.
    const increments = (tx.physicalInventory.update.mock.calls as any[])
      .map((c) => c[0]?.data?.quantity?.increment)
      .filter((n) => typeof n === 'number');
    expect(increments).toContain(3);
    expect(increments).not.toContain(5);
  });

  it('reports unrestored units when the physical reservation is missing (never silently RESTOCKED)', async () => {
    tx.physicalReservation.findUnique.mockResolvedValue(null);
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-nores',
      tx,
    });
    expect(res.restored).toEqual([]);
    expect(res.unrestored).toEqual([
      { productId: 'pa', variantId: null, quantity: 2 },
    ]);
  });

  it('reports the shortfall when allocations cover fewer units than were deducted', async () => {
    tx.physicalReservation.findUnique.mockImplementation(({ where }: any) => {
      if (where?.orderItemId_cycleId?.orderItemId === 'item-a') {
        return Promise.resolve({
          id: 'res-a',
          status: 'CONSUMED',
          productId: 'pa',
          variantId: null,
          warehouseId: 'wh-1',
          allocations: [{ id: 'alloc-a', physicalInventoryId: 'pi-1', quantity: 1 }],
        });
      }
      return Promise.resolve(null);
    });
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-short',
      tx,
    });
    expect(res.restored).toEqual([{ productId: 'pa', variantId: null, quantity: 1 }]);
    expect(res.unrestored).toEqual([
      { productId: 'pa', variantId: null, quantity: 1 },
    ]);
  });

  it('ACTIVE reservation release is budget-capped across allocations (no per-allocation qty reuse)', async () => {
    // Audit item 5 (ACTIVE branch): allocations [3, 3], release qty 4 →
    // decrements must be 3 then 1 (the old code released 3 then 3).
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      items: [orderItem('item-a', managedProduct, 4)],
    });
    tx.physicalReservation.findUnique.mockResolvedValue({
      id: 'res-active',
      status: 'ACTIVE',
      productId: 'pa',
      variantId: null,
      warehouseId: 'wh-1',
      allocations: [
        { id: 'alloc-1', physicalInventoryId: 'pi-1', quantity: 3 },
        { id: 'alloc-2', physicalInventoryId: 'pi-2', quantity: 3 },
      ],
    });

    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 4 }],
      returnId: 'ret-active',
      tx,
    });

    const decrements = (tx.physicalInventory.updateMany.mock.calls as any[]).map(
      (c) => ({
        id: c[0]?.where?.id,
        take: c[0]?.where?.reservedQuantity?.gte,
      }),
    );
    expect(decrements).toEqual([
      { id: 'pi-1', take: 3 },
      { id: 'pi-2', take: 1 },
    ]);
  });

  it('RESTORATION ledger rows carry the REAL stock before/after (not fabricated 0 → take)', async () => {
    // The mock PI row reads quantity 10 AFTER the +2 increment.
    await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 2 }],
      returnId: 'ret-snap',
      tx,
    });
    const restorationRows = (tx.physicalInventoryLedger.create.mock.calls as any[])
      .map((c) => c[0]?.data)
      .filter((d) => d?.type === 'RESTORATION');
    expect(restorationRows.length).toBeGreaterThan(0);
    for (const row of restorationRows) {
      expect(row.stockBefore).toBe(8);
      expect(row.stockAfter).toBe(10);
    }
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

  it('restores nothing when the whole line is damaged (hold freed, never restocked)', async () => {
    // The line (item-a) holds 5 units; ALL 5 arrive damaged. (WS2
    // cumulative settlement: disarm requires the settled total — good +
    // damaged across all returns — to reach the LINE quantity, so this
    // test must return the whole line; a 2-of-5 damaged return would
    // correctly leave the claim armed for the remaining 3.)
    const res = await service.restoreForReturnItems({
      orderId: 'order-1',
      items: [{ productId: 'pa', quantity: 5, damagedQuantity: 5 }],
      returnId: 'ret-all-damaged',
      tx,
    });
    expect(res.restored).toEqual([]);
    // No on-hand movement of any kind: the only engine call allowed is the
    // capped RELEASE of the damaged units' hold (they will never restock,
    // so their reservation share must not leak).
    for (const [op, args] of stockService.operate.mock.calls as any[]) {
      expect(op).toBe('release');
      expect(args?.quantity).toBe(5);
    }
    expect(tx.physicalInventory.update).not.toHaveBeenCalled();
    // The line IS fully settled (5 of 5 damaged), so the claim disarms.
    expect(tx.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-a' } }),
    );
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

  describe('Q6 — restore layer follows the product mode AT RETURN TIME (owner 2026-10-23)', () => {
    // The product was MANAGED_STOCK when the order was placed (managed flags
    // set, stock deducted + Return-Pending hold placed) but has since moved
    // to INVENTORY_CONTROLLED. The return must restore PHYSICAL only — the
    // managed/virtual quantity is never added back — while the managed
    // claim is still settled (hold freed, flags cleared).
    const movedProduct = {
      id: 'pc',
      availabilityMode: 'INVENTORY_CONTROLLED',
      manageStock: false,
      syncManagedStock: false,
      warehouseId: 'wh-1',
      name: 'C',
    };

    function movedOrder() {
      return {
        id: 'order-1',
        items: [
          {
            id: 'item-c',
            orderId: 'order-1',
            productId: 'pc',
            variantId: null,
            comboId: null,
            quantity: 4,
            managedStockDeducted: true,
            managedStockReserved: true,
            product: movedProduct,
          },
        ],
      };
    }

    it('item-level return: physical restored, managed add NEVER happens, claim settled', async () => {
      tx.order.findUnique.mockResolvedValue(movedOrder());
      // WS2 restores physical INTO the reservation's allocations; the
      // shared default mock (res-b, 3 units) belongs to another product —
      // this line's reservation covers the full 4 units.
      tx.physicalReservation.findUnique.mockResolvedValue({
        id: 'res-c',
        status: 'CONSUMED',
        productId: 'pc',
        variantId: null,
        warehouseId: 'wh-1',
        allocations: [{ id: 'alloc-c', physicalInventoryId: 'pi-1', quantity: 4 }],
      });

      const res = await service.restoreForReturnItems({
        orderId: 'order-1',
        items: [{ productId: 'pc', quantity: 4 }],
        returnId: 'ret-q6',
        tx,
      });

      expect(res.restored).toEqual([{ productId: 'pc', variantId: null, quantity: 4 }]);
      // No managed on-hand restore for a product that left MANAGED_STOCK.
      for (const [op, args] of stockService.operate.mock.calls as any[]) {
        expect([op, args?.productId]).not.toEqual(['add', 'pc']);
      }
      // The Return-Pending hold this order placed is freed (release only).
      expect(stockService.operate).toHaveBeenCalledWith(
        'release',
        expect.objectContaining({ productId: 'pc', quantity: 4 }),
      );
      // Flags cleared so no later path can resurrect virtual stock.
      expect(tx.orderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-c' },
          data: expect.objectContaining({
            managedStockDeducted: false,
            managedStockReserved: false,
          }),
        }),
      );
      // Physical layer DID restore (reservation handled + on-hand moved).
      expect(tx.physicalReservation.update).toHaveBeenCalled();
    });

    it('blanket restoreForOrder: same rule — no managed add, flags cleared', async () => {
      tx.order.findUnique.mockResolvedValue(movedOrder());
      tx.costingLotConsumption.findMany = jest.fn().mockResolvedValue([]);

      await service.restoreForOrder({
        orderId: 'order-1',
        referencePrefix: 'return',
        tx,
      });

      for (const [op, args] of stockService.operate.mock.calls as any[]) {
        expect([op, args?.productId]).not.toEqual(['add', 'pc']);
      }
      expect(tx.orderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-c' },
          data: expect.objectContaining({
            managedStockDeducted: false,
            managedStockReserved: false,
          }),
        }),
      );
    });
  });

  describe('R-1 — physical restore follows the reservation, not Product.warehouseId (2026-10-24)', () => {
    // Staging RTN-261024-0002: an INVENTORY_CONTROLLED product with physical
    // stock + a CONSUMED reservation at Dhaka Eco but NO default warehouse
    // on the product row. Receive claimed "1 restored" yet nothing moved —
    // Section B was gated on product.warehouseId. The reservation's
    // allocations are the authority for where units come back to.
    it('IC product with warehouseId=null still restores on-hand + writes the RESTORATION ledger', async () => {
      const noWarehouseProduct = {
        id: 'pd',
        availabilityMode: 'INVENTORY_CONTROLLED',
        manageStock: false,
        syncManagedStock: false,
        warehouseId: null,
        name: 'D',
      };
      tx.order.findUnique.mockResolvedValue({
        id: 'order-1',
        items: [
          {
            id: 'item-d',
            orderId: 'order-1',
            productId: 'pd',
            variantId: null,
            comboId: null,
            quantity: 2,
            managedStockDeducted: false,
            managedStockReserved: false,
            product: noWarehouseProduct,
          },
        ],
      });
      tx.physicalReservation.findUnique.mockResolvedValue({
        id: 'res-d',
        status: 'CONSUMED',
        productId: 'pd',
        variantId: null,
        warehouseId: 'wh-9',
        allocations: [{ id: 'alloc-d', physicalInventoryId: 'pi-9', quantity: 2 }],
      });

      const res = await service.restoreForReturnItems({
        orderId: 'order-1',
        items: [{ productId: 'pd', quantity: 2 }],
        returnId: 'ret-r1',
        tx,
      });

      expect(res.restored).toEqual([
        { productId: 'pd', variantId: null, quantity: 2 },
      ]);
      expect(tx.physicalInventory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pi-9' },
          data: { quantity: { increment: 2 } },
        }),
      );
      expect(tx.physicalInventoryLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RESTORATION',
            warehouseId: 'wh-9',
            quantity: 2,
          }),
        }),
      );
      expect(tx.physicalReservation.update).toHaveBeenCalled();
    });
  });
});
