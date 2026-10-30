import { ReconciliationFinderService } from './reconciliation-finder.service';

/**
 * Finder tests (2026-10-30 directive §3/§5): record-based classification —
 * a missed restock is proven by a received Return row PLUS the absence of
 * the matching ledger add (managed RETURN / physical RESTORATION, both
 * keyed `return-<returnId>` exactly as the receive path writes them).
 */

function makeService(scenario: any = {}) {
  const prisma: any = {
    return: {
      findMany: jest.fn(async () => scenario.returns ?? []),
      count: jest.fn(async (args: any) => {
        if (args?.where?.type === 'PARTIAL') return scenario.partialWithoutRecord ?? 0;
        return scenario.pendingReturns ?? 0;
      }),
    },
    managedStockLedger: {
      findMany: jest.fn(async (args: any) => {
        // Q8 distinct-units call has `distinct` set; evidence call does not.
        if (args?.distinct) return scenario.ledgerUnits ?? [];
        return scenario.managedLedger ?? [];
      }),
    },
    physicalInventoryLedger: {
      findMany: jest.fn(async () => scenario.physicalLedger ?? []),
    },
    order: {
      findMany: jest.fn(async (args: any) => {
        const statusIn = args?.where?.status?.name?.in as string[] | undefined;
        if (statusIn && statusIn.includes('Cancelled') && statusIn.length === 2) {
          return scenario.r3Orders ?? [];
        }
        if (args?.where?.id?.in && args?.select?.items) {
          return scenario.ordersForReturns ?? [];
        }
        if (args?.where?.id?.in) return scenario.terminalOrders ?? [];
        return [];
      }),
      count: jest.fn(async () => scenario.damagedOrders ?? 0),
    },
    product: {
      findMany: jest.fn(async (args: any) => {
        if (args?.where?.id?.in) return scenario.products ?? [];
        if (args?.select?.variants) return scenario.q4Products ?? [];
        return scenario.q3Products ?? [];
      }),
      count: jest.fn(async (args: any) => {
        if (args?.where?.availabilityMode?.in) return scenario.alwaysMode ?? 0;
        return scenario.icProducts ?? 0;
      }),
    },
    orderItemComboComponent: {
      findMany: jest.fn(async () => scenario.r3Components ?? []),
    },
    dispatch: {
      findMany: jest.fn(async () => scenario.dispatches ?? []),
    },
    productVariant: {
      findMany: jest.fn(async () => scenario.q3Variants ?? []),
    },
    physicalInventory: {
      findMany: jest.fn(async (args: any) => {
        if (args?.select?.productId && args?.distinct) return scenario.physUnits ?? [];
        if (args?.select?.productId) return scenario.q4Physical ?? [];
        return scenario.q3Physical ?? [];
      }),
    },
    physicalReservation: {
      findMany: jest.fn(async () => scenario.activeRes ?? []),
    },
    comboComponentPhysicalReservation: {
      findMany: jest.fn(async () => scenario.activeComboRes ?? []),
    },
    orderItem: {
      findMany: jest.fn(async () => scenario.q7Lines ?? []),
    },
    costingLotConsumption: {
      findMany: jest.fn(async () => scenario.q7Consumptions ?? []),
    },
  };
  const stockRouter: any = {
    isInventoryManagementEnabled: jest.fn(async () => scenario.imEnabled ?? true),
  };
  const reconciliation: any = {
    scanDriftedOrders: jest.fn(async () => scenario.drifted ?? []),
    verifyStockIntegrity: jest.fn(async () => ({
      checked: 0,
      pass: 0,
      fail: 0,
      products: [],
      negativeAvailable: [],
    })),
  };
  const service = new ReconciliationFinderService(prisma, stockRouter, reconciliation);
  return { service, prisma };
}

const baseOrder = {
  id: 'o1',
  displayId: 'ORD-1',
  items: [{ productId: 'p1', variantId: 'v1', quantity: 3 }],
};

describe('ReconciliationFinderService', () => {
  it('R1: variant item with managed RETURN add missing (physical present)', async () => {
    const { service } = makeService({
      returns: [
        {
          id: 'r1',
          displayId: 'RTN-1',
          orderId: 'o1',
          type: 'FULL',
          status: 'RESTOCKED',
          stockReconciled: true,
          items: [{ productId: 'p1', variantId: 'v1', quantity: 3, damagedQuantity: 1 }],
        },
      ],
      ordersForReturns: [baseOrder],
      products: [{ id: 'p1', name: 'Hoodie', availabilityMode: 'MANAGED_STOCK' }],
      managedLedger: [],
      physicalLedger: [
        { reason: 'return-r1', productId: 'p1', variantId: 'v1', quantity: 2 },
      ],
    });
    const report = await service.buildReport();
    expect(report.counts.R1).toBe(1);
    const row = report.rows.find((r) => r.category === 'R1')!;
    expect(row.layer).toBe('managed');
    expect(row.receivedGoodQty).toBe(2);
    expect(row.damagedQty).toBe(1);
    expect(row.alreadyRestoredPhysical).toBe(2);
    expect(row.alreadyRestoredManaged).toBe(0);
    expect(row.missingManagedQty).toBe(2);
    expect(row.missingPhysicalQty).toBe(0);
    // Q1 counts the managed-missing row; Q2 is clean.
    expect(report.checks.find((c) => c.key === 'Q1')?.value).toBe(1);
    expect(report.checks.find((c) => c.key === 'Q2')?.value).toBe(0);
  });

  it('R2: simple product, managed restored but physical RESTORATION missing (IM on)', async () => {
    const { service } = makeService({
      returns: [
        {
          id: 'r2',
          displayId: 'RTN-2',
          orderId: 'o1',
          type: 'FULL',
          status: 'RECEIVED',
          stockReconciled: true,
          items: [{ productId: 'p1', variantId: null, quantity: 2 }],
        },
      ],
      ordersForReturns: [
        { id: 'o1', displayId: 'ORD-1', items: [{ productId: 'p1', variantId: null, quantity: 2 }] },
      ],
      products: [{ id: 'p1', name: 'Mug', availabilityMode: 'MANAGED_STOCK' }],
      managedLedger: [
        { referenceId: 'return-r2', productId: 'p1', variantId: null, quantity: 2 },
      ],
      physicalLedger: [],
    });
    const report = await service.buildReport();
    expect(report.counts.R2).toBe(1);
    const row = report.rows[0];
    expect(row.layer).toBe('physical');
    expect(row.missingPhysicalQty).toBe(2);
    expect(row.missingManagedQty).toBe(0);
  });

  it('healthy return (both layers restored) produces NO row', async () => {
    const { service } = makeService({
      returns: [
        {
          id: 'r3',
          displayId: 'RTN-3',
          orderId: 'o1',
          type: 'FULL',
          status: 'RESTOCKED',
          stockReconciled: true,
          items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
        },
      ],
      ordersForReturns: [baseOrder],
      products: [{ id: 'p1', name: 'Hoodie', availabilityMode: 'MANAGED_STOCK' }],
      managedLedger: [
        { referenceId: 'return-r3', productId: 'p1', variantId: 'v1', quantity: 2 },
      ],
      physicalLedger: [
        { reason: 'return-r3', productId: 'p1', variantId: 'v1', quantity: 2 },
      ],
    });
    const report = await service.buildReport();
    expect(report.rows).toHaveLength(0);
    expect(report.checks.find((c) => c.key === 'Q1')?.pass).toBe(true);
    expect(report.checks.find((c) => c.key === 'Q2')?.pass).toBe(true);
  });

  it('damaged-only return produces NO row (owner Q7 — damaged never restocks)', async () => {
    const { service } = makeService({
      returns: [
        {
          id: 'r4',
          displayId: 'RTN-4',
          orderId: 'o1',
          type: 'FULL',
          status: 'RESTOCKED',
          stockReconciled: true,
          items: [{ productId: 'p1', variantId: 'v1', quantity: 2, damagedQuantity: 2 }],
        },
      ],
      ordersForReturns: [baseOrder],
      products: [{ id: 'p1', name: 'Hoodie', availabilityMode: 'MANAGED_STOCK' }],
    });
    const report = await service.buildReport();
    expect(report.rows).toHaveLength(0);
  });

  it('R4: return item without a recorded quantity is human-disposition only', async () => {
    const { service } = makeService({
      returns: [
        {
          id: 'r5',
          displayId: 'RTN-5',
          orderId: 'o1',
          type: 'PARTIAL',
          status: 'RECEIVED',
          stockReconciled: false,
          items: [{ productId: 'p1', variantId: null }],
        },
      ],
      ordersForReturns: [
        { id: 'o1', displayId: 'ORD-1', items: [{ productId: 'p1', variantId: null, quantity: 4 }] },
      ],
      products: [{ id: 'p1', name: 'Mug', availabilityMode: 'MANAGED_STOCK' }],
    });
    const report = await service.buildReport();
    expect(report.counts.R4).toBe(1);
    expect(report.rows[0].missingManagedQty).toBe(0);
  });

  it('R3: flagged line on a Cancelled order is report-only with zero missing qty', async () => {
    const { service } = makeService({
      r3Orders: [
        {
          id: 'o9',
          displayId: 'ORD-9',
          status: { name: 'Cancelled' },
          items: [{ productId: 'p1', variantId: null, quantity: 1 }],
        },
      ],
    });
    const report = await service.buildReport();
    expect(report.counts.R3).toBe(1);
    expect(report.rows[0].category).toBe('R3');
    expect(report.rows[0].missingManagedQty).toBe(0);
  });

  it('R4: dispatch RETURNED with no Return record at all is listed for disposition', async () => {
    const { service, prisma } = makeService({
      dispatches: [{ orderId: 'o7' }],
    });
    prisma.return.findMany = jest
      .fn()
      .mockResolvedValueOnce([]) // received-returns scan
      .mockResolvedValueOnce([]); // returns covering dispatch orders — none
    prisma.order.findMany = jest.fn(async (args: any) => {
      if (args?.where?.id?.in && !args?.select?.items) {
        return [{ id: 'o7', displayId: 'ORD-7' }];
      }
      const statusIn = args?.where?.status?.name?.in as string[] | undefined;
      if (statusIn && statusIn.includes('Cancelled')) return [];
      return [];
    });
    const report = await service.buildReport();
    const r4 = report.rows.filter((r) => r.category === 'R4');
    expect(r4).toHaveLength(1);
    expect(r4[0].orderDisplayId).toBe('ORD-7');
    expect(r4[0].returnId).toBeNull();
  });

  it('R5 counts are reported without rows', async () => {
    const { service } = makeService({
      pendingReturns: 3,
      damagedOrders: 1,
      partialWithoutRecord: 2,
      alwaysMode: 5,
      icProducts: 4,
      imEnabled: false,
    });
    const report = await service.buildReport();
    expect(report.counts.R5).toEqual({
      returnPending: 3,
      damaged: 1,
      partialWithoutRecord: 2,
      alwaysMode: 5,
      imOffInventoryControlled: 4,
    });
    expect(report.imEnabled).toBe(false);
  });

  it('IM off: physical layer is never expected (managed-only scope)', async () => {
    const { service } = makeService({
      imEnabled: false,
      returns: [
        {
          id: 'r6',
          displayId: 'RTN-6',
          orderId: 'o1',
          type: 'FULL',
          status: 'RESTOCKED',
          stockReconciled: true,
          items: [{ productId: 'p1', variantId: null, quantity: 2 }],
        },
      ],
      ordersForReturns: [
        { id: 'o1', displayId: 'ORD-1', items: [{ productId: 'p1', variantId: null, quantity: 2 }] },
      ],
      products: [{ id: 'p1', name: 'Mug', availabilityMode: 'MANAGED_STOCK' }],
      managedLedger: [
        { referenceId: 'return-r6', productId: 'p1', variantId: null, quantity: 2 },
      ],
      physicalLedger: [],
    });
    const report = await service.buildReport();
    expect(report.rows).toHaveLength(0);
    expect(report.checks.find((c) => c.key === 'Q2')?.value).toBe(0);
  });
});
