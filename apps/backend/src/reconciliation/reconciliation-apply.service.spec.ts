import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReconciliationApplyService } from './reconciliation-apply.service';

/**
 * Apply tests (2026-10-30 directive §2.8): only still-R1/R2 rows are
 * written, via the receive path's own primitives; R4 is never applied;
 * the flag-on env refuses; a concurrent RUNNING run is a 409; the acting
 * user is recorded from the caller (auth token), never from a body.
 */

const R1_ROW = {
  id: 'R1|r1|p1|v1|managed',
  category: 'R1',
  orderId: 'o1',
  orderDisplayId: 'ORD-1',
  returnId: 'r1',
  returnDisplayId: 'RTN-1',
  productId: 'p1',
  productName: 'Hoodie',
  variantId: 'v1',
  layer: 'managed',
  orderedQty: 2,
  receivedGoodQty: 2,
  damagedQty: 0,
  alreadyRestoredManaged: 0,
  alreadyRestoredPhysical: 0,
  missingManagedQty: 2,
  missingPhysicalQty: 0,
  evidence: 'test',
} as any;

const R4_ROW = { ...R1_ROW, id: 'R4|r9|p1||managed', category: 'R4', returnId: 'r9' } as any;

const emptyReport = {
  generatedAt: '2026-10-30T00:00:00.000Z',
  imEnabled: true,
  rows: [],
  counts: { R1: 0, R2: 0, R3: 0, R4: 0, R5: {} },
  checks: [],
} as any;

function makeService(opts: any = {}) {
  const tx: any = {
    return: {
      findUnique: jest.fn(async () => ({
        id: 'r1',
        orderId: 'o1',
        status: 'RESTOCKED',
        items: opts.txItems ?? [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
      })),
    },
    product: {
      findUnique: jest.fn(async () => ({
        availabilityMode: 'MANAGED_STOCK',
        warehouseId: null,
      })),
    },
    managedStockLedger: {
      findMany: jest.fn(async () => opts.txManagedLedger ?? []),
    },
    physicalInventoryLedger: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({})),
    },
    physicalReservation: { findMany: jest.fn(async () => []) },
    physicalInventory: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'pi-1', quantity: 0, warehouseId: 'w1' })),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma: any = {
    reconciliationRun: {
      updateMany: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => opts.runningRun ?? null),
      create: jest.fn(async () => ({ id: 'run-1' })),
      update: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const reportWithRows = { ...emptyReport, rows: opts.rows ?? [R1_ROW] };
  // Use the REAL evidence-sum helpers against the tx client: instantiate
  // the finder with the same mock prisma (its helpers only touch the
  // client they are handed).
  const { ReconciliationFinderService } = jest.requireActual(
    './reconciliation-finder.service',
  );
  const realFinder = new ReconciliationFinderService(
    prisma,
    { isInventoryManagementEnabled: jest.fn(async () => true) } as any,
    { scanDriftedOrders: jest.fn(async () => []), verifyStockIntegrity: jest.fn() } as any,
  );
  const finder: any = {
    buildReport: jest
      .fn()
      .mockResolvedValueOnce(reportWithRows)
      .mockResolvedValue(opts.postReport ?? emptyReport),
    managedRestoredByReturn: realFinder.managedRestoredByReturn.bind(realFinder),
    physicalRestoredByReturn: realFinder.physicalRestoredByReturn.bind(realFinder),
  };

  const stockService: any = { operate: jest.fn(async () => []) };
  const initialPhysicalStock: any = {
    resolveWarehouse: jest.fn(async () => null),
  };
  const service = new ReconciliationApplyService(
    prisma,
    finder,
    stockService,
    initialPhysicalStock,
  );
  return { service, prisma, finder, stockService, tx };
}

describe('ReconciliationApplyService', () => {
  const prevEnv = process.env['STOCK_RECONCILE_ON_BOOT'];
  afterEach(() => {
    if (prevEnv === undefined) delete process.env['STOCK_RECONCILE_ON_BOOT'];
    else process.env['STOCK_RECONCILE_ON_BOOT'] = prevEnv;
  });

  it('applies a still-R1 row via the receive-path managed add and records the actor', async () => {
    const { service, prisma, stockService } = makeService();
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1',
      rowIds: [R1_ROW.id],
    });
    expect(result.applied).toEqual([R1_ROW.id]);
    expect(result.skipped).toEqual([]);
    expect(stockService.operate).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({
        productId: 'p1',
        variantId: 'v1',
        quantity: 2,
        reference: 'return-r1',
        ledgerType: 'RETURN',
        referenceType: 'RETURN',
        performedBy: 'boss@example.com',
      }),
    );
    // The audit record carries the token-side actor + backup id.
    expect(prisma.reconciliationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        performedBy: 'boss@example.com',
        backupId: 'dump-1',
        status: 'RUNNING',
      }),
    });
    expect(result.idempotency.ok).toBe(true);
  });

  it('NEVER applies an R4 row (human disposition only)', async () => {
    const { service, prisma, stockService } = makeService({ rows: [R4_ROW] });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1',
      rowIds: [R4_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('never applied');
    expect(stockService.operate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips a row id that no longer qualifies in the fresh report', async () => {
    const { service, stockService } = makeService({ rows: [] });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1',
      rowIds: [R1_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('No longer qualifies');
    expect(stockService.operate).not.toHaveBeenCalled();
  });

  it('skips (does not double-write) when the ledger already covers the return in-tx', async () => {
    const { service, stockService } = makeService({
      txManagedLedger: [
        { referenceId: 'return-r1', productId: 'p1', variantId: 'v1', quantity: 2 },
      ],
    });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1',
      rowIds: [R1_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('Already restored');
    expect(stockService.operate).not.toHaveBeenCalled();
  });

  it('refuses while STOCK_RECONCILE_ON_BOOT=true is in env', async () => {
    process.env['STOCK_RECONCILE_ON_BOOT'] = 'true';
    const { service, prisma } = makeService();
    await expect(
      service.apply({ performedBy: 'boss@example.com', backupId: 'd', rowIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reconciliationRun.create).not.toHaveBeenCalled();
  });

  it('refuses a concurrent Apply with 409 while another run is RUNNING', async () => {
    const { service } = makeService({ runningRun: { id: 'run-other' } });
    await expect(
      service.apply({ performedBy: 'boss@example.com', backupId: 'd', rowIds: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
