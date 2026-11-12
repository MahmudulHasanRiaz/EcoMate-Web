import { Q8SettleService, Q8_SETTLEMENT_NOTE_PREFIX } from './q8-settle.service';
import { InventoryController } from '../inventory/inventory.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { RolesGuard } from '../auth/roles.guard';

/**
 * Q8 settlement tests (2026-11-12, verify205 round): the staging Gadget
 * unit — TEST-AUDIT Gadget, now INVENTORY_CONTROLLED, on-hand 0 /
 * reserved 2, with 2 live holds (ORD-261024-0003 Pending, ORD-261022-0008
 * Return Pending) + 2 already-deducted flagged lines (ORD-261024-0002,
 * ORD-261023-0003). Dry-run previews exactly and writes nothing; the real
 * run releases the 2 live units, clears all 4 flags, writes 4 RELEASE
 * entries and no counter move for the deducted lines; a second run is a
 * no-op; the route is superadmin-only.
 */

const GADGET = {
  id: 'p-gadget',
  name: 'TEST-AUDIT Gadget',
  type: 'simple',
  managedStockQuantity: 0,
  reservedStock: 2,
  variants: [],
};

const CLEAN_IC = {
  id: 'p-clean',
  name: 'Clean IC Widget',
  type: 'simple',
  managedStockQuantity: 0,
  reservedStock: 0,
  variants: [],
};

const liveLine = (id: string, orderId: string, displayId: string) => ({
  id,
  productId: 'p-gadget',
  variantId: null,
  quantity: 1,
  managedStockDeducted: false,
  managedStockReserved: true,
  order: { id: orderId, displayId },
});

const deductedLine = (id: string, orderId: string, displayId: string) => ({
  id,
  productId: 'p-gadget',
  variantId: null,
  quantity: 1,
  managedStockDeducted: true,
  managedStockReserved: true,
  order: { id: orderId, displayId },
});

function makeService(opts: any = {}) {
  const state = {
    products: opts.products ?? [GADGET, CLEAN_IC],
    orderItems:
      opts.orderItems ??
      [
        liveLine('li-1', 'o-1', 'ORD-261024-0003'),
        liveLine('li-2', 'o-2', 'ORD-261022-0008'),
        deductedLine('li-3', 'o-3', 'ORD-261024-0002'),
        deductedLine('li-4', 'o-4', 'ORD-261023-0003'),
      ],
    components: opts.components ?? [],
  };
  const findItems = async (args: any) =>
    state.orderItems.filter(
      (i: any) =>
        (!args?.where?.productId || i.productId === args.where.productId) &&
        (i.variantId ?? null) === (args?.where?.variantId ?? null) &&
        i.managedStockReserved === true,
    );
  const findComponents = async (args: any) =>
    state.components.filter(
      (c: any) =>
        (!args?.where?.productId || c.productId === args.where.productId) &&
        (c.variantId ?? null) === (args?.where?.variantId ?? null) &&
        c.managedStockReserved === true,
    );
  const findProducts = async () => state.products;
  const tx: any = {
    product: {
      findMany: jest.fn(findProducts),
      update: jest.fn(async () => ({})),
    },
    productVariant: { update: jest.fn(async () => ({})) },
    orderItem: {
      findMany: jest.fn(findItems),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    orderItemComboComponent: {
      findMany: jest.fn(findComponents),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    managedStockLedger: {
      create: jest.fn(async (args: any) => ({ id: 'led-1', ...args.data })),
    },
  };
  const prisma: any = {
    product: {
      findMany: jest.fn(findProducts),
      update: jest.fn(async () => ({})),
    },
    productVariant: { update: jest.fn(async () => ({})) },
    orderItem: {
      findMany: jest.fn(findItems),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    orderItemComboComponent: {
      findMany: jest.fn(findComponents),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    managedStockLedger: {
      create: jest.fn(async (args: any) => ({ id: 'led-1', ...args.data })),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const reconciliation: any = {
    verifyStockIntegrity: jest.fn(async () => ({
      checked: 1,
      pass: 1,
      fail: opts.verificationFail ?? 0,
      products: [],
      negativeAvailable: [],
    })),
  };
  const service = new Q8SettleService(prisma, reconciliation);
  return { service, prisma, tx, reconciliation, state };
}

describe('Q8SettleService', () => {
  it('dry-run previews the Gadget settlement exactly and writes nothing', async () => {
    const { service, prisma, tx, reconciliation } = makeService({
      verificationFail: 1,
    });
    const out = await service.settle({
      dryRun: true,
      performedBy: 'boss@example.com',
    });

    expect(Object.keys(out).sort()).toEqual([
      'detail',
      'dryRun',
      'remainingFails',
      'settled',
    ]);
    expect(Object.keys(out.settled).sort()).toEqual([
      'flagsCleared',
      'ledgerEntries',
      'releasedUnits',
    ]);
    expect(out.dryRun).toBe(true);
    expect(out.settled.releasedUnits).toBe(2);
    expect(out.settled.flagsCleared).toBe(4);
    expect(out.settled.ledgerEntries).toHaveLength(4);
    expect(out.settled.ledgerEntries[0]).toContain('ORD-261024-0003');
    expect(out.settled.ledgerEntries[1]).toContain('ORD-261022-0008');
    expect(out.settled.ledgerEntries[2]).toContain('already-deducted');
    expect(out.settled.ledgerEntries[3]).toContain('already-deducted');
    expect(out.remainingFails).toBe(1);
    expect(out.detail).toContain('Dry run');
    expect(out.detail).toContain('TEST-AUDIT Gadget');

    // Nothing written: no transaction, no counter move, no flag clear, no
    // ledger row — the preview is read-only.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.orderItemComboComponent.updateMany).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
    expect(reconciliation.verifyStockIntegrity).toHaveBeenCalledWith([
      'p:p-gadget|',
    ]);
  });

  it('every ledger entry carries the Q8 settlement marker (the R6 finder ignores exactly this prefix)', async () => {
    // Locks the writer side of the contract: the finder skips entries
    // whose note starts with Q8_SETTLEMENT_NOTE_PREFIX, so every note
    // this service writes — live release, already-deducted release and
    // residual sweep — must start with it, in both dry-run and real run.
    // The literal pins the prefix text itself (em dash included), so a
    // silent rewording cannot desync writer and finder.
    const dry = await makeService({ verificationFail: 1 }).service.settle({
      dryRun: true,
      performedBy: 'boss@example.com',
    });
    expect(dry.settled.ledgerEntries).toHaveLength(4);
    for (const note of dry.settled.ledgerEntries) {
      expect(note.startsWith('Q8 settlement — ')).toBe(true);
      expect(note.startsWith(Q8_SETTLEMENT_NOTE_PREFIX)).toBe(true);
    }

    const { service, tx } = makeService({ verificationFail: 0 });
    await service.settle({ dryRun: false, performedBy: 'boss@example.com' });
    expect(tx.managedStockLedger.create).toHaveBeenCalledTimes(4);
    for (const call of tx.managedStockLedger.create.mock.calls) {
      const note = call[0].data.note as string;
      expect(note.startsWith('Q8 settlement — ')).toBe(true);
      expect(note.startsWith(Q8_SETTLEMENT_NOTE_PREFIX)).toBe(true);
    }
  });

  it('uses the finder R6 orphan predicate (INVENTORY_CONTROLLED only)', async () => {
    const { service, prisma } = makeService();
    await service.settle({ dryRun: true });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { availabilityMode: 'INVENTORY_CONTROLLED' },
      }),
    );
  });

  it('real run releases the 2 live units, clears all 4 flags, writes 4 RELEASE entries', async () => {
    const { service, tx, reconciliation } = makeService({
      verificationFail: 0,
    });
    const out = await service.settle({
      dryRun: false,
      performedBy: 'boss@example.com',
    });

    expect(out.dryRun).toBe(false);
    expect(out.settled).toEqual({
      releasedUnits: 2,
      flagsCleared: 4,
      ledgerEntries: expect.arrayContaining([
        expect.stringContaining('ORD-261024-0003'),
        expect.stringContaining('ORD-261022-0008'),
      ]),
    });
    expect(out.settled.ledgerEntries).toHaveLength(4);
    expect(out.remainingFails).toBe(0);
    expect(out.detail).toContain('Settled 1 orphaned unit(s)');

    // Flags cleared BEFORE any counter move, in a single updateMany over
    // every flagged line (live + already-deducted).
    expect(tx.orderItem.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['li-1', 'li-2', 'li-3', 'li-4'] } },
      data: { managedStockReserved: false },
    });
    expect(tx.orderItemComboComponent.updateMany).not.toHaveBeenCalled();

    // Exactly 2 counter moves — one per LIVE hold. The already-deducted
    // lines move no counter (a second decrement would corrupt it).
    expect(tx.product.update).toHaveBeenCalledTimes(2);
    expect(tx.product.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'p-gadget' },
      data: { reservedStock: { decrement: 1 } },
    });
    expect(tx.product.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'p-gadget' },
      data: { reservedStock: { decrement: 1 } },
    });
    expect(tx.productVariant.update).not.toHaveBeenCalled();

    // 4 RELEASE entries: live releases carry the counter walk 2→1→0, the
    // deducted lines carry quantity-0 entries at the settled counter (0).
    expect(tx.managedStockLedger.create).toHaveBeenCalledTimes(4);
    expect(tx.managedStockLedger.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'p-gadget',
          quantity: 1,
          direction: 'IN',
          type: 'RELEASE',
          stockBefore: 0,
          stockAfter: 0,
          reservedBefore: 2,
          reservedAfter: 1,
          referenceType: 'ORDER',
          referenceId: 'o-1',
          performedById: 'boss@example.com',
        }),
      }),
    );
    expect(tx.managedStockLedger.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 1,
          type: 'RELEASE',
          reservedBefore: 1,
          reservedAfter: 0,
          referenceId: 'o-2',
        }),
      }),
    );
    expect(tx.managedStockLedger.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 0,
          type: 'RELEASE',
          reservedBefore: 0,
          reservedAfter: 0,
          referenceId: 'o-3',
        }),
      }),
    );
    expect(tx.managedStockLedger.create).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 0,
          type: 'RELEASE',
          reservedBefore: 0,
          reservedAfter: 0,
          referenceId: 'o-4',
        }),
      }),
    );

    // Explicit performedAt stamps are strictly increasing in write order,
    // so the Q8 verifier's last-snapshot read sees the final state.
    const stamps = tx.managedStockLedger.create.mock.calls.map(
      (c: any) => c[0].data.performedAt.getTime(),
    );
    expect(stamps).toEqual([...stamps].sort((a: number, b: number) => a - b));
    expect(new Set(stamps).size).toBe(4);

    expect(reconciliation.verifyStockIntegrity).toHaveBeenCalledWith([
      'p:p-gadget|',
    ]);
  });

  it('second run is a no-op (idempotent)', async () => {
    const { service, tx, state } = makeService({ verificationFail: 0 });
    await service.settle({ dryRun: false, performedBy: 'boss@example.com' });

    // Simulate the settled state a re-read would now see.
    state.products = [
      { ...GADGET, reservedStock: 0 },
      CLEAN_IC,
    ];
    state.orderItems = [];
    jest.clearAllMocks();

    const out = await service.settle({
      dryRun: false,
      performedBy: 'boss@example.com',
    });
    expect(out.settled).toEqual({
      releasedUnits: 0,
      flagsCleared: 0,
      ledgerEntries: [],
    });
    expect(out.remainingFails).toBe(0);
    expect(out.detail).toContain('nothing written');
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.managedStockLedger.create).not.toHaveBeenCalled();
  });

  it('non-orphaned units are untouched (clean IC product, no flags, no reserved stock)', async () => {
    const { service, tx } = makeService({ verificationFail: 0 });
    await service.settle({ dryRun: false, performedBy: 'boss@example.com' });
    // Every product.update targets the Gadget only; the clean unit gets no
    // ledger entry and no counter write.
    for (const call of tx.product.update.mock.calls) {
      expect(call[0].where.id).toBe('p-gadget');
    }
    for (const call of tx.managedStockLedger.create.mock.calls) {
      expect(call[0].data.productId).toBe('p-gadget');
    }
  });

  it('residual sweep zeroes counter remainder with no backing line', async () => {
    const { service, tx } = makeService({
      verificationFail: 0,
      products: [
        { ...GADGET, reservedStock: 3 },
        CLEAN_IC,
      ],
      // One live hold of 1, no deducted lines: 2 units have no backing line.
      orderItems: [liveLine('li-1', 'o-1', 'ORD-261024-0003')],
    });
    const out = await service.settle({
      dryRun: false,
      performedBy: 'boss@example.com',
    });
    expect(out.settled.releasedUnits).toBe(3);
    expect(out.settled.flagsCleared).toBe(1);
    expect(out.settled.ledgerEntries).toHaveLength(2);
    expect(tx.managedStockLedger.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 2,
          direction: 'IN',
          type: 'ADJUSTMENT',
          reservedBefore: 2,
          reservedAfter: 0,
        }),
      }),
    );
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p-gadget' },
      data: { reservedStock: 0 },
    });
  });

  it('variable product settles the variant counter, not the product row', async () => {
    const variantProduct = {
      id: 'p-var',
      name: 'Variable Gadget',
      type: 'variable',
      managedStockQuantity: 0,
      reservedStock: 0,
      variants: [
        { id: 'v-1', managedStockQuantity: 0, reservedStock: 1 },
      ],
    };
    const { service, tx } = makeService({
      verificationFail: 0,
      products: [variantProduct],
      orderItems: [
        {
          id: 'li-v1',
          productId: 'p-var',
          variantId: 'v-1',
          quantity: 1,
          managedStockDeducted: false,
          managedStockReserved: true,
          order: { id: 'o-v', displayId: 'ORD-261024-0009' },
        },
      ],
    });
    const out = await service.settle({
      dryRun: false,
      performedBy: 'boss@example.com',
    });
    expect(out.settled).toEqual({
      releasedUnits: 1,
      flagsCleared: 1,
      ledgerEntries: expect.arrayContaining([
        expect.stringContaining('ORD-261024-0009'),
      ]),
    });
    expect(tx.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { reservedStock: { decrement: 1 } },
    });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.managedStockLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: 'v-1', type: 'RELEASE' }),
      }),
    );
  });
});

describe('InventoryController q8-settle endpoint', () => {
  const fakeCtx = (role: string | undefined) =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    }) as any;

  it('route is superadmin-only (same permission key as the other reconciliation routes)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, InventoryController.prototype.q8Settle),
    ).toEqual(['superadmin']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        InventoryController.prototype.q8Settle,
      ),
    ).toEqual(['run_stock_reconciliation']);
  });

  it('RolesGuard denies a non-superadmin (Nest maps the denial to 403) and admits superadmin', () => {
    const guard = new RolesGuard({
      getAllAndOverride: jest.fn(() => ['superadmin']),
    } as any);
    expect(guard.canActivate(fakeCtx('admin'))).toBe(false);
    expect(guard.canActivate(fakeCtx('employee'))).toBe(false);
    expect(guard.canActivate(fakeCtx(undefined))).toBe(false);
    expect(guard.canActivate(fakeCtx('superadmin'))).toBe(true);
  });

  it('controller passes dryRun + the actor from the auth token, never from the body', async () => {
    const q8Settle: any = {
      settle: jest.fn(async () => ({
        dryRun: true,
        settled: { releasedUnits: 0, flagsCleared: 0, ledgerEntries: [] },
        remainingFails: 0,
        detail: 'ok',
      })),
    };
    const controller = new InventoryController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      q8Settle,
    );
    const out = await controller.q8Settle(
      { dryRun: true, performedBy: 'attacker@evil.example' } as any,
      { email: 'boss@example.com' } as any,
    );
    expect(q8Settle.settle).toHaveBeenCalledWith({
      dryRun: true,
      performedBy: 'boss@example.com',
    });
    expect(out.detail).toBe('ok');
  });
});
