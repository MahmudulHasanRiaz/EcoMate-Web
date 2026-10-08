import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PurchasesService } from '../purchases.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';

/**
 * Purchase lifecycle specs: validation, GRN disposition accounting,
 * short-close, cancel, and post-GRN locks.
 *
 * tx doubles stub only the delegates each test needs (mirrors the style of
 * orders.service.spec.ts).
 */
describe('PurchasesService lifecycle', () => {
  let service: PurchasesService;
  let prisma: Record<string, any>;

  const stockService = {
    operate: jest.fn().mockResolvedValue([]),
    addPhysical: jest.fn().mockResolvedValue([]),
  };
  const stockRouter = {
    isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
    // IM off + MANAGED_STOCK: managed leg only.
    resolve: jest.fn().mockReturnValue({ ms: 'add', pi: 'skip', msConditionalOnSync: false }),
  };

  const mockTx = (over: Record<string, any> = {}) => {
    const tx: Record<string, any> = {
      supplier: { findUnique: jest.fn(), update: jest.fn() },
      product: { findUnique: jest.fn() },
      productVariant: { findUnique: jest.fn() },
      purchaseCounter: { upsert: jest.fn() },
      purchase: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      purchaseItem: { findMany: jest.fn(), update: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
      goodsReceiptNote: { create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      goodsReceiptNoteItem: { findMany: jest.fn().mockResolvedValue([]) },
      costingLot: { create: jest.fn() },
      warehouse: { findUnique: jest.fn().mockImplementation(async ({ where }: any) => ({ id: where.id })) },
      supplierUpdate: jest.fn(),
      purchaseEvent: { create: jest.fn() },
      ...over,
    };
    // supplier.update lives on tx.supplier in service code
    return tx;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      $transaction: jest.fn(),
      supplier: { findUnique: jest.fn(), update: jest.fn() },
      purchase: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stockService },
        { provide: StockRouterService, useValue: stockRouter },
      ],
    }).compile();
    service = module.get<PurchasesService>(PurchasesService);
  });

  const runTx = (tx: Record<string, any>) => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
  };

  const poItem = (over: Record<string, any> = {}) => ({
    id: 'pi-1',
    purchaseId: 'po-1',
    productId: 'prod-1',
    variantId: null,
    quantity: 100,
    totalBill: 10000,
    receivedQty: 0,
    shortClosedQty: 0,
    shortCloseReason: null,
    ...over,
  });

  // ─── create validation ────────────────────────────────────────────
  describe('create', () => {
    const dto = (over: Record<string, any> = {}) => ({
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantity: 10, totalBill: 1000 }],
      ...over,
    });

    function baseTx() {
      return mockTx({
        supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1' }), update: jest.fn() },
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'prod-1', type: 'simple' }) },
        purchaseCounter: { upsert: jest.fn().mockResolvedValue({ date: '261008', seq: 7 }) },
        purchase: {
          create: jest.fn().mockResolvedValue({ id: 'po-1', referenceNo: 'PO-261008-0007' }),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      });
    }

    it('rejects an unknown product with 400, not a 500 FK crash', async () => {
      const tx = baseTx();
      tx.product.findUnique.mockResolvedValue(null);
      runTx(tx);
      await expect(service.create(dto() as any)).rejects.toThrow(BadRequestException);
      expect(tx.purchase.create).not.toHaveBeenCalled();
    });

    it('requires a variant for variable products', async () => {
      const tx = baseTx();
      tx.product.findUnique.mockResolvedValue({ id: 'prod-1', type: 'variable' });
      runTx(tx);
      await expect(service.create(dto() as any)).rejects.toThrow(/select a variant/);
    });

    it('rejects a variant that belongs to another product', async () => {
      const tx = baseTx();
      tx.productVariant.findUnique.mockResolvedValue({ id: 'v-9', productId: 'other' });
      runTx(tx);
      await expect(
        service.create(dto({ items: [{ productId: 'prod-1', variantId: 'v-9', quantity: 2, totalBill: 200 }] }) as any),
      ).rejects.toThrow(/does not belong/);
    });

    it('numbers POs from the atomic counter and records a created event', async () => {
      const tx = baseTx();
      runTx(tx);
      await service.create(dto() as any);
      expect(tx.purchaseCounter.upsert).toHaveBeenCalled();
      expect(tx.purchase.create).toHaveBeenCalled();
      expect(tx.purchaseEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'created' }) }),
      );
      const refNo = tx.purchase.create.mock.calls[0][0].data.referenceNo;
      expect(refNo).toMatch(/^PO-\d{6}-0007$/);
    });
  });

  // ─── GRN ──────────────────────────────────────────────────────────
  describe('createGrn', () => {
    const purchase = { id: 'po-1', supplierId: 'sup-1', status: 'ordered' };

    function grnTx(piOver: Record<string, any> = {}, priorLines: any[] = []) {
      const pi = poItem(piOver);
      // Stateful mini-DB: lines created by goodsReceiptNote.create become
      // visible to goodsReceiptNoteItem.findMany, so recomputeStatus (which
      // re-reads every line from the tx) sees the same truth as the service.
      const createdLines: any[] = [];
      return mockTx({
        purchaseCounter: { upsert: jest.fn().mockResolvedValue({ date: '261008', seq: 3 }) },
        purchaseItem: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            if (where.id) return where.id.in.includes('pi-a') ? [pi] : [pi];
            return [pi];
          }),
          update: jest.fn(),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
        goodsReceiptNoteItem: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            const all = [...priorLines, ...createdLines];
            const ids = where.purchaseItemId?.in;
            return ids ? all.filter((l) => ids.includes(l.purchaseItemId)) : all;
          }),
        },
        goodsReceiptNote: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            for (const l of data.items.create) createdLines.push(l);
            return {
              id: 'grn-1',
              grnNumber: 'GRN-261008-0001',
              ...data,
              items: data.items.create.map((l: any, i: number) => ({ id: `gl-${i}`, ...l })),
            };
          }),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        costingLot: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
        supplier: { findUnique: jest.fn(), update: jest.fn() },
        purchase: {
          create: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
        product: {
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([{ id: 'prod-1', availabilityMode: 'MANAGED_STOCK' }]),
        },
      });
    }

    const grnDto = (over: Record<string, any> = {}) => ({
      warehouseId: 'wh-1',
      items: [{ purchaseItemId: 'pi-1', receivedQty: 60, acceptedQty: 50, rejectedQty: 10 }],
      ...over,
    });

    beforeEach(() => {
      prisma.purchase.findUnique.mockResolvedValue({ ...purchase, items: [poItem()] });
    });

    it('posts the managed leg for MANAGED_STOCK (router decision), not physical-only', async () => {
      const tx = grnTx();
      runTx(tx);
      await service.createGrn('po-1', grnDto() as any, 'user-1');
      expect(stockService.operate).toHaveBeenCalledWith(
        'add',
        expect.objectContaining({
          productId: 'prod-1',
          quantity: 50,
          referenceType: 'PURCHASE',
          referenceId: 'po-1',
          ledgerType: 'PURCHASE_RECEIVE',
        }),
      );
      // IM off → physical skipped
      expect(stockService.addPhysical).not.toHaveBeenCalled();
    });

    it('numbers concurrent GRNs from the atomic counter (no findFirst race)', async () => {
      const tx = grnTx();
      runTx(tx);
      await service.createGrn('po-1', grnDto() as any, 'user-1');
      expect(tx.purchaseCounter.upsert).toHaveBeenCalled();
    });

    it('uses the PO line identity, rejecting a mismatched client productId', async () => {
      const tx = grnTx();
      runTx(tx);
      await expect(
        service.createGrn('po-1', grnDto({ items: [{ purchaseItemId: 'pi-1', productId: 'other', receivedQty: 10, acceptedQty: 10, rejectedQty: 0 }] }) as any),
      ).rejects.toThrow(/does not match/);
    });

    it('blocks received totals above remaining across GRNs (short-close aware)', async () => {
      const tx = grnTx({ shortClosedQty: 10 }, [{ purchaseItemId: 'pi-1', receivedQty: 60, acceptedQty: 60, rejectedQty: 0 }]);
      runTx(tx);
      // remaining = 100 - 60 - 10 = 30; asking 40 must fail.
      await expect(
        service.createGrn('po-1', grnDto({ items: [{ purchaseItemId: 'pi-1', receivedQty: 40, acceptedQty: 40, rejectedQty: 0 }] }) as any),
      ).rejects.toThrow(/exceeds remaining/);
    });

    it('closes an all-rejected line as damage-dispositioned (never as silent stock)', async () => {
      const tx = grnTx();
      runTx(tx);
      await service.createGrn(
        'po-1',
        grnDto({ items: [{ purchaseItemId: 'pi-1', receivedQty: 100, acceptedQty: 0, rejectedQty: 100 }] }) as any,
      );
      // Terminal (every unit has a damage disposition), but zero stock posted.
      expect(tx.purchase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'received' } }),
      );
      expect(tx.costingLot.create).not.toHaveBeenCalled();
      expect(stockService.operate).not.toHaveBeenCalled();
      expect(stockService.addPhysical).not.toHaveBeenCalled();
    });

    it('allocates company-borne damage onto the accepted units', async () => {
      const tx = grnTx();
      runTx(tx);
      // 100 units billed 10000; 90 good + 10 damage borne by company →
      // lot unit = 10000/90, lot covers only the 90 stocked units.
      await service.createGrn(
        'po-1',
        grnDto({
          items: [{ purchaseItemId: 'pi-1', receivedQty: 100, acceptedQty: 90, rejectedQty: 10, damageResponsibility: 'company' }],
        }) as any,
      );
      const lot = tx.costingLot.create.mock.calls[0][0].data;
      expect(Number(lot.unitCost)).toBeCloseTo(10000 / 90, 2);
      expect(lot.quantity).toBe(90);
      expect(lot.remainingQty).toBe(90);
    });

    it('reports companyDamageValue in the summary', async () => {
      // PO line qty 100 bill 10000; GRN 90 accepted + 10 rejected (company).
      const tx = grnTx();
      runTx(tx);
      await service.createGrn(
        'po-1',
        grnDto({
          items: [{ purchaseItemId: 'pi-1', receivedQty: 100, acceptedQty: 90, rejectedQty: 10, damageResponsibility: 'company' }],
        }) as any,
        'user-1',
      );
      // Per-line event damage: 10 rejected × unitBase 100 = 1000.
      const evtArg = tx.purchaseEvent.create.mock.calls[0][0].data;
      expect(evtArg.data.lines[0].damageValue).toBe(1000);
      // Summary via findOne over the persisted GRN lines.
      prisma.purchase.findUnique.mockResolvedValue({
        ...purchase,
        items: [poItem()],
        grns: [{
          grnNumber: 'GRN-261008-0001',
          items: [{ purchaseItemId: 'pi-1', receivedQty: 100, acceptedQty: 90, rejectedQty: 10, damageResponsibility: 'company', totalCost: 10000 }],
        }],
      });
      const found = await service.findOne('po-1');
      expect((found as any).summary.totals.companyDamageValue).toBe(1000);
    });

    it('keeps supplier-borne damage out of inventory value', async () => {
      const tx = grnTx();
      runTx(tx);
      await service.createGrn('po-1', grnDto() as any);
      const lot = tx.costingLot.create.mock.calls[0][0].data;
      expect(Number(lot.unitCost)).toBe(100);
      expect(lot.quantity).toBe(50);
    });

    it('stocks free replacements at zero cost and skips supplier balance', async () => {
      const tx = grnTx();
      runTx(tx);
      await service.createGrn(
        'po-1',
        grnDto({
          items: [{ purchaseItemId: 'pi-1', receivedQty: 10, acceptedQty: 10, rejectedQty: 0, freeOfCharge: true }],
        }) as any,
      );
      const lot = tx.costingLot.create.mock.calls[0][0].data;
      expect(Number(lot.unitCost)).toBe(0);
      expect(tx.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ balance: { increment: expect.anything() } }) }),
      );
      const inc = tx.supplier.update.mock.calls[0][0].data.balance.increment;
      expect(Number(inc)).toBe(0);
    });

    it('honours the per-line warehouse for stock and lots', async () => {
      const tx = grnTx();
      runTx(tx);
      await service.createGrn(
        'po-1',
        grnDto({
          warehouseId: 'wh-1',
          items: [{ purchaseItemId: 'pi-1', receivedQty: 10, acceptedQty: 10, rejectedQty: 0, lineWarehouseId: 'wh-2' }],
        }) as any,
      );
      expect(tx.costingLot.create.mock.calls[0][0].data.warehouseId).toBe('wh-2');
    });

    it('rejects an unknown warehouse', async () => {
      const tx = grnTx();
      tx.warehouse.findUnique.mockResolvedValue(null);
      runTx(tx);
      await expect(service.createGrn('po-1', grnDto() as any)).rejects.toThrow(/Warehouse/);
    });

    it('reaches received only after EVERY item is dispositioned, including items completed in earlier GRNs', async () => {
      // Two-item PO. GRN1 fully received item A (prior line); this GRN
      // receives item B. The prior-lines query is scoped to the touched
      // itemIds, so the status gate must read all items' full GRN history —
      // not just this GRN's lines.
      const piA = poItem({ id: 'pi-a' });
      const piB = poItem({ id: 'pi-b', productId: 'prod-2', quantity: 50, totalBill: 5000 });
      const tx = grnTx({}, [{ purchaseItemId: 'pi-a', receivedQty: 100, acceptedQty: 100, rejectedQty: 0 }]);
      tx.purchaseItem.findMany.mockImplementation(async ({ where }: any) => {
        if (where.id) return where.id.in.includes('pi-a') ? [piA] : [piB];
        return [piA, piB];
      });
      tx.product.findMany.mockResolvedValue([
        { id: 'prod-1', availabilityMode: 'MANAGED_STOCK' },
        { id: 'prod-2', availabilityMode: 'MANAGED_STOCK' },
      ]);
      runTx(tx);
      await service.createGrn(
        'po-1',
        grnDto({ items: [{ purchaseItemId: 'pi-b', receivedQty: 50, acceptedQty: 50, rejectedQty: 0 }] }) as any,
        'user-1',
      );
      const statusUpdate = tx.purchase.update.mock.calls.find(
        (c: any[]) => c[0]?.data?.status !== undefined,
      )?.[0]?.data?.status;
      expect(statusUpdate).toBe('received');
    });

    it('rejects a client variantId that does not belong to the received product', async () => {
      const tx = grnTx();
      tx.productVariant.findUnique.mockResolvedValue({ id: 'v-9', productId: 'other' });
      runTx(tx);
      await expect(
        service.createGrn(
          'po-1',
          grnDto({ items: [{ purchaseItemId: 'pi-1', variantId: 'v-9', receivedQty: 10, acceptedQty: 10, rejectedQty: 0 }] }) as any,
        ),
      ).rejects.toThrow(/does not belong/);
      // Nothing may hit stock or lots at the foreign variant.
      expect(tx.costingLot.create).not.toHaveBeenCalled();
      expect(stockService.operate).not.toHaveBeenCalled();
    });

    it('accepts a client variantId that belongs to the received product (legacy variant-less line)', async () => {
      const tx = grnTx();
      tx.productVariant.findUnique.mockResolvedValue({ id: 'v-1', productId: 'prod-1' });
      runTx(tx);
      await service.createGrn(
        'po-1',
        grnDto({ items: [{ purchaseItemId: 'pi-1', variantId: 'v-1', receivedQty: 10, acceptedQty: 10, rejectedQty: 0 }] }) as any,
      );
      expect(tx.costingLot.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ variantId: 'v-1' }) }),
      );
    });
  });

  // ─── short-close + cancel ─────────────────────────────────────────
  describe('shortClose and cancel', () => {
    function scTx(piOver: Record<string, any> = {}, priorLines: any[] = []) {
      const pi = poItem(piOver);
      return mockTx({
        purchaseItem: {
          findMany: jest.fn().mockImplementation(async () => [pi]),
          update: jest.fn().mockImplementation(async ({ data }: any) => {
            if (data.shortClosedQty?.increment) pi.shortClosedQty += data.shortClosedQty.increment;
            if (data.shortCloseReason) pi.shortCloseReason = data.shortCloseReason;
            if (data.receivedQty?.increment) pi.receivedQty += data.receivedQty.increment;
            return pi;
          }),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
        goodsReceiptNoteItem: { findMany: jest.fn().mockResolvedValue(priorLines) },
        purchase: {
          create: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
      });
    }

    it('short-closes remaining qty with a reason and recomputes status', async () => {
      prisma.purchase.findUnique.mockResolvedValue({ id: 'po-1', status: 'ordered', referenceNo: 'PO-1' });
      const tx = scTx({}, [{ purchaseItemId: 'pi-1', receivedQty: 60, acceptedQty: 60, rejectedQty: 0 }]);
      runTx(tx);
      (service as any).findOneTx = jest.fn().mockResolvedValue({ id: 'po-1' });
      await service.shortClose('po-1', { items: [{ purchaseItemId: 'pi-1', qty: 40, reason: 'supplier short' }] } as any, 'user-1');
      expect(tx.purchaseItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ shortClosedQty: { increment: 40 } }) }),
      );
      expect(tx.purchase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'received' } }),
      );
    });

    it('rejects short-close beyond remaining', async () => {
      prisma.purchase.findUnique.mockResolvedValue({ id: 'po-1', status: 'ordered', referenceNo: 'PO-1' });
      const tx = scTx({}, [{ purchaseItemId: 'pi-1', receivedQty: 90, acceptedQty: 90, rejectedQty: 0 }]);
      runTx(tx);
      await expect(
        service.shortClose('po-1', { items: [{ purchaseItemId: 'pi-1', qty: 20, reason: 'x' }] } as any),
      ).rejects.toThrow(/exceeds remaining/);
    });

    it('cancel short-closes the remainder and blocks later GRNs', async () => {
      prisma.purchase.findUnique.mockResolvedValue({
        id: 'po-1',
        status: 'partially_received',
        items: [poItem({ receivedQty: 60 })],
      });
      const tx = scTx({}, [{ purchaseItemId: 'pi-1', receivedQty: 60, acceptedQty: 60, rejectedQty: 0 }]);
      runTx(tx);
      (service as any).findOneTx = jest.fn().mockResolvedValue({ id: 'po-1' });
      await service.cancel('po-1', { reason: 'supplier bankrupt' } as any, 'user-1');
      expect(tx.purchaseItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ shortClosedQty: { increment: 40 } }) }),
      );
      expect(tx.purchase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelled' } }),
      );
    });

    it('refuses to cancel a fully received purchase', async () => {
      prisma.purchase.findUnique.mockResolvedValue({ id: 'po-1', status: 'received', items: [] });
      await expect(service.cancel('po-1', { reason: 'x' } as any)).rejects.toThrow(/fully received/);
    });
  });

  // ─── update locks ─────────────────────────────────────────────────
  describe('update locks', () => {
    it('blocks supplier/date/item changes after any GRN (notes stay open)', async () => {
      prisma.purchase.findUnique.mockResolvedValue({ id: 'po-1' });
      const tx = mockTx({
        goodsReceiptNote: { count: jest.fn().mockResolvedValue(1), create: jest.fn() },
        purchase: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'po-1' }) },
        purchaseItem: { findMany: jest.fn(), update: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
      });
      runTx(tx);
      await expect(service.update('po-1', { supplierId: 'other' } as any)).rejects.toThrow(/Only notes/);
      await expect(service.update('po-1', { notes: 'ok' } as any)).resolves.toBeDefined();
    });

    it('blocks every change on a cancelled purchase except notes', async () => {
      prisma.purchase.findUnique.mockResolvedValue({ id: 'po-1', status: 'cancelled' });
      const tx = mockTx({
        goodsReceiptNote: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
        purchase: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'po-1' }) },
      });
      runTx(tx);
      await expect(service.update('po-1', { notes: 'ok' } as any)).resolves.toBeDefined();
      await expect(service.update('po-1', { items: [] } as any)).rejects.toThrow(/cancelled/i);
    });
  });
});
