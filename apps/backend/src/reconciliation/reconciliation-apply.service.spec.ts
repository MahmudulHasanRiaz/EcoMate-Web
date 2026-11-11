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

const R6_ROW = {
  id: 'R6||p6||managed',
  category: 'R6',
  orderId: '',
  orderDisplayId: '',
  returnId: null,
  returnDisplayId: null,
  productId: 'p6',
  productName: 'Gadget',
  variantId: null,
  layer: 'managed',
  orderedQty: 0,
  receivedGoodQty: 0,
  damagedQty: 0,
  alreadyRestoredManaged: 0,
  alreadyRestoredPhysical: 0,
  missingManagedQty: 0,
  missingPhysicalQty: 0,
  strandedManagedQty: 5,
  evidence: 'test',
} as any;

const R6_VARIANT_ROW = {
  ...R6_ROW,
  id: 'R6||p6|v6|managed',
  variantId: 'v6',
  strandedManagedQty: -3,
} as any;

const R7_ROW = {
  ...R6_ROW,
  id: 'R7|p7||physical|w1',
  category: 'R7',
  productId: 'p7',
  productName: 'Mirror Mug',
  layer: 'physical',
  strandedManagedQty: undefined,
  physicalQty: 4,
  warehouseId: 'w1',
} as any;

const R8_TERMINAL_ROW = {
  ...R6_ROW,
  id: 'R8|oL1||managed',
  category: 'R8',
  r8Kind: 'terminal',
  orderId: 'oL1',
  orderDisplayId: 'ORD-L1',
  productId: '',
  productName: '(legacy return — no Return record)',
  strandedManagedQty: undefined,
  legacyAt: '2026-08-03T10:00:00.000Z',
  legacyActor: 'staff@shop.com',
} as any;

const R8_PENDING_ROW = {
  ...R8_TERMINAL_ROW,
  id: 'R8|oL2||managed',
  r8Kind: 'pending',
  orderId: 'oL2',
  orderDisplayId: 'ORD-L2',
  legacyAt: '2026-08-05T10:00:00.000Z',
} as any;

const R8_HUMAN_ROW = {
  ...R8_TERMINAL_ROW,
  id: 'R8|oL3||managed',
  r8Kind: 'human',
  orderId: 'oL3',
  orderDisplayId: 'ORD-L3',
} as any;

const LEGACY_TIMELINE = [
  { status: 'Return Pending', timestamp: '2026-08-01T10:00:00.000Z', performedBy: 'staff@shop.com' },
  { status: 'Returned', timestamp: '2026-08-03T10:00:00.000Z', performedBy: 'staff@shop.com' },
];

const emptyReport = {
  generatedAt: '2026-10-30T00:00:00.000Z',
  imEnabled: true,
  rows: [],
  counts: { R1: 0, R2: 0, R3: 0, R4: 0, R5: {}, R6: 0, R7: 0, R8: 0, R8H: 0 },
  checks: [],
} as any;

function makeService(opts: any = {}) {
  const tx: any = {
    // WS3: Apply takes a transaction-scoped advisory lock first, then the
    // stale sweep + RUNNING check + run create all run inside that tx.
    $executeRaw: jest.fn(async () => 0),
    reconciliationRun: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findFirst: jest.fn(async () => opts.runningRun ?? null),
      create: jest.fn(async () => ({ id: 'run-1' })),
      update: jest.fn(async () => ({})),
    },
    return: {
      findUnique: jest.fn(async () => ({
        id: 'r1',
        orderId: 'o1',
        status: 'RESTOCKED',
        items: opts.txItems ?? [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
      })),
      findFirst: jest.fn(async () => opts.txExistingReturn ?? null),
      create: jest.fn(async (args: any) => ({ id: 'ret-new-1', ...args.data })),
    },
    product: {
      findUnique: jest.fn(async () =>
        opts.txProduct ?? {
          availabilityMode: 'MANAGED_STOCK',
          warehouseId: null,
        },
      ),
      findMany: jest.fn(async () => opts.txProducts ?? []),
      update: jest.fn(async () => ({})),
    },
    productVariant: {
      findUnique: jest.fn(async () => opts.txVariant ?? null),
      update: jest.fn(async () => ({})),
    },
    // WS3: applyRow caps the restore at the ordered quantity via the order.
    order: {
      findUnique: jest.fn(async () =>
        opts.txOrder ?? {
          items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
        },
      ),
    },
    orderItem: {
      findMany: jest.fn(async () => opts.txOrderLines ?? []),
    },
    returnCounter: {
      upsert: jest.fn(async () => ({ date: '260803', seq: 1 })),
    },
    managedStockLedger: {
      findMany: jest.fn(async () => opts.txManagedLedger ?? []),
      create: jest.fn(async () => ({})),
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
    // WS3: applyRow also sums the blanket order-keyed evidence so a
    // blanket-restored return is never restored a second time.
    managedRestoredByOrder: realFinder.managedRestoredByOrder.bind(realFinder),
    physicalRestoredByOrder: realFinder.physicalRestoredByOrder.bind(realFinder),
    // R6/R8 (2026-11-11): the real classifier + residue probe, bound the
    // same way — apply must re-derive evidence exactly as the finder did.
    managedModeResidue: realFinder.managedModeResidue.bind(realFinder),
    classifyLegacyReturn: realFinder.classifyLegacyReturn.bind(realFinder),
    isInventoryManagementEnabled: jest.fn(async () => opts.imEnabled ?? false),
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
    const { service, prisma, stockService, tx } = makeService();
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
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
    // The audit record carries the token-side actor + backup id. (WS3: the
    // run row is created inside the lock-holding transaction, hence tx.)
    expect(tx.reconciliationRun.create).toHaveBeenCalledWith({
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
      backupId: 'dump-1', confirmed: true,
      rowIds: [R4_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('never applied');
    expect(stockService.operate).not.toHaveBeenCalled();
    // WS3 note: the run-record transaction (advisory lock + RUNNING row)
    // DOES open — it audits the attempt; the invariant that matters is
    // that no stock write happens for an R4 row.
  });

  it('skips a row id that no longer qualifies in the fresh report', async () => {
    const { service, stockService } = makeService({ rows: [] });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
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
      backupId: 'dump-1', confirmed: true,
      rowIds: [R1_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('Already restored');
    expect(stockService.operate).not.toHaveBeenCalled();
  });

  it('refuses while STOCK_RECONCILE_ON_BOOT=true is in env', async () => {
    process.env['STOCK_RECONCILE_ON_BOOT'] = 'true';
    const { service, prisma, tx } = makeService();
    await expect(
      service.apply({ performedBy: 'boss@example.com', backupId: 'd', confirmed: true, rowIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.reconciliationRun.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a concurrent Apply with 409 while another run is RUNNING', async () => {
    const { service } = makeService({ runningRun: { id: 'run-other' } });
    await expect(
      service.apply({ performedBy: 'boss@example.com', backupId: 'd', confirmed: true, rowIds: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('R6: heals a stranded positive managed qty on an IC simple product (zero + mode-change ledger)', async () => {
    const { service, tx } = makeService({
      rows: [R6_ROW],
      txProduct: {
        availabilityMode: 'INVENTORY_CONTROLLED',
        type: 'simple',
        managedStockQuantity: 5,
      },
    });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R6_ROW.id],
    });
    expect(result.applied).toEqual([R6_ROW.id]);
    expect(tx.managedStockLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'p6',
        variantId: null,
        quantity: 5,
        direction: 'OUT',
        type: 'ADJUSTMENT',
        stockBefore: 5,
        stockAfter: 0,
        note: 'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED — snapshot: 5 units',
        performedById: 'boss@example.com',
      }),
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p6' },
      data: { managedStockQuantity: 0 },
    });
    expect(result.idempotency.ok).toBe(true);
    expect(result.idempotency.remainingR6).toBe(0);
  });

  it('R6: clears a NEGATIVE stranded variant qty (IN movement of the magnitude, never a sign flip)', async () => {
    const { service, tx } = makeService({
      rows: [R6_VARIANT_ROW],
      txProduct: {
        availabilityMode: 'INVENTORY_CONTROLLED',
        type: 'variable',
        managedStockQuantity: 0,
      },
      txVariant: { managedStockQuantity: -3 },
    });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R6_VARIANT_ROW.id],
    });
    expect(result.applied).toEqual([R6_VARIANT_ROW.id]);
    expect(tx.managedStockLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'p6',
        variantId: 'v6',
        quantity: 3,
        direction: 'IN',
        stockBefore: -3,
        stockAfter: 0,
        note: 'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED — variant snapshot: -3 units',
      }),
    });
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v6' },
      data: { managedStockQuantity: 0 },
    });
  });

  it('R6 idempotent re-run: already-healed unit is skipped in-tx and writes nothing', async () => {
    const { service, tx } = makeService({
      rows: [R6_ROW],
      txProduct: {
        availabilityMode: 'INVENTORY_CONTROLLED',
        type: 'simple',
        managedStockQuantity: 0, // healed between report and apply
      },
      txManagedLedger: [], // no residue either
    });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R6_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('Already healed');
    expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('R7: explicitly refused even when listed under apply (report-only)', async () => {
    const { service, tx, stockService } = makeService({ rows: [R7_ROW] });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R7_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('REPORT-ONLY');
    expect(stockService.operate).not.toHaveBeenCalled();
    expect(tx.physicalInventory.update).not.toHaveBeenCalled();
    expect(tx.return.create).not.toHaveBeenCalled();
  });

  it('R8 terminal: backfills a RESTOCKED Return with per-return evidence keys and NO stock movement', async () => {
    const { service, tx, stockService } = makeService({
      rows: [R8_TERMINAL_ROW],
      txOrder: {
        id: 'oL1',
        displayId: 'ORD-L1',
        status: { name: 'Returned' },
        timeline: LEGACY_TIMELINE,
        items: [{ id: 'li1', productId: 'p1', variantId: null, quantity: 2, comboId: null }],
      },
      txProducts: [{ id: 'p1', availabilityMode: 'MANAGED_STOCK', manageStock: true }],
      txProduct: { managedStockQuantity: 7 },
      txOrderLines: [
        { productId: 'p1', variantId: null, sourceWarehouseId: null, product: { warehouseId: null } },
      ],
    });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R8_TERMINAL_ROW.id],
    });
    expect(result.applied).toEqual([R8_TERMINAL_ROW.id]);
    // RTN number carries the HISTORICAL transition date (2026-08-03).
    expect(tx.returnCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date: '260803' } }),
    );
    expect(tx.return.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'oL1',
        displayId: 'RTN-260803-0001',
        type: 'FULL',
        status: 'RESTOCKED',
        stockReconciled: true,
        source: 'STAFF',
        createdBy: 'staff@shop.com',
      }),
    });
    const createData = (tx.return.create as jest.Mock).mock.calls[0][0].data;
    expect(createData.receivedAt).toEqual(new Date('2026-08-03T10:00:00.000Z'));
    expect(createData.stockReconciledAt).toEqual(new Date('2026-08-03T10:00:00.000Z'));
    expect(createData.createdAt).toEqual(new Date('2026-08-01T10:00:00.000Z'));
    // Coverage: the receive path's PER-RETURN keying, stockBefore == stockAfter.
    expect(tx.managedStockLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'p1',
        quantity: 2,
        direction: 'IN',
        type: 'RETURN',
        referenceType: 'RETURN',
        referenceId: 'return-ret-new-1',
        stockBefore: 7,
        stockAfter: 7,
        performedById: 'reconcile-backfill:boss@example.com',
      }),
    });
    // NO stock movement anywhere: no quantity writes, no stock operate.
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.physicalInventory.update).not.toHaveBeenCalled();
    expect(stockService.operate).not.toHaveBeenCalled();
    expect(result.idempotency.ok).toBe(true);
    expect(result.idempotency.remainingR8).toBe(0);
  });

  it('R8 pending: backfills a REQUESTED Return only — never received, no ledger writes', async () => {
    const { service, tx } = makeService({
      rows: [R8_PENDING_ROW],
      txOrder: {
        id: 'oL2',
        displayId: 'ORD-L2',
        status: { name: 'Return Pending' },
        timeline: [LEGACY_TIMELINE[0]],
        items: [{ id: 'li1', productId: 'p1', variantId: null, quantity: 1, comboId: null }],
      },
    });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R8_PENDING_ROW.id],
    });
    expect(result.applied).toEqual([R8_PENDING_ROW.id]);
    expect(tx.return.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'oL2',
        type: 'FULL',
        status: 'REQUESTED',
        stockReconciled: false,
      }),
    });
    const createData = (tx.return.create as jest.Mock).mock.calls[0][0].data;
    expect(createData.receivedAt).toBeUndefined();
    expect(createData.receivedById).toBeUndefined();
    expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
  });

  it('R8-H: ambiguous legacy evidence is refused at apply and left untouched', async () => {
    const { service, tx } = makeService({ rows: [R8_HUMAN_ROW] });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R8_HUMAN_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('R8-H');
    expect(tx.return.create).not.toHaveBeenCalled();
  });

  it('R8 idempotent re-run: once the Return exists the row no longer qualifies', async () => {
    const { service, tx } = makeService({ rows: [] });
    const result = await service.apply({
      performedBy: 'boss@example.com',
      backupId: 'dump-1', confirmed: true,
      rowIds: [R8_TERMINAL_ROW.id],
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('No longer qualifies');
    expect(tx.return.create).not.toHaveBeenCalled();
  });
});
