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
    costingLot: {
      findMany: jest.fn(async () => scenario.costingLots ?? []),
    },
    order: {
      findMany: jest.fn(async (args: any) => {
        const statusIn = args?.where?.status?.name?.in as string[] | undefined;
        if (statusIn && statusIn.includes('Return Pending')) {
          return scenario.legacyOrders ?? [];
        }
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
      findMany: jest.fn(async (args: any) => {
        // WS3's physical-applicability evidence query filters by orderId;
        // the Q6 check filters by status ACTIVE instead.
        if (args?.where?.orderId) return scenario.physicalEngagement ?? [];
        return scenario.activeRes ?? [];
      }),
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
    verifyStockIntegrity: jest.fn(async () => scenario.verification ?? ({
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
      // The order's delivery DID engage the physical layer (a reservation
      // record exists) — so the missing physical restore is a real,
      // applicable shortage (WS3 applicability gate).
      physicalEngagement: [{ orderId: 'o1', productId: 'p1', variantId: null }],
    });
    const report = await service.buildReport();
    expect(report.counts.R2).toBe(1);
    const row = report.rows[0];
    expect(row.layer).toBe('physical');
    expect(row.missingPhysicalQty).toBe(2);
    expect(row.missingManagedQty).toBe(0);
  });

  it('R3 (WS3 gate): physical shortage with NO reservation/deduction evidence is report-only, never applicable', async () => {
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
      // No physicalEngagement: the physical layer was never engaged for
      // this line, so the apparent shortage must not be auto-applied
      // (a warehouse/stock location is never invented).
    });
    const report = await service.buildReport();
    expect(report.counts.R2).toBe(0);
    expect(report.counts.R3).toBe(1);
    const row = report.rows.find((r) => r.category === 'R3')!;
    expect(row.layer).toBe('physical');
    expect(row.missingPhysicalQty).toBe(0);
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

  it('R6: INVENTORY_CONTROLLED simple product with stranded positive managed qty', async () => {
    const { service } = makeService({
      q4Products: [
        { id: 'p9', name: 'Gadget', type: 'simple', managedStockQuantity: 5, variants: [] },
      ],
    });
    const report = await service.buildReport();
    expect(report.counts.R6).toBe(1);
    const row = report.rows.find((r) => r.category === 'R6')!;
    expect(row.productId).toBe('p9');
    expect(row.variantId).toBeNull();
    expect(row.strandedManagedQty).toBe(5);
    expect(row.missingManagedQty).toBe(0); // not a return-restore row
    expect(row.evidence).toContain('managedStockQuantity=5');
  });

  it('R6: variable product with a NEGATIVE stranded variant qty (the pre-fix survivor)', async () => {
    const { service } = makeService({
      q4Products: [
        {
          id: 'p10',
          name: 'Tee',
          type: 'variable',
          managedStockQuantity: 0,
          variants: [
            { id: 'v10a', managedStockQuantity: 0 },
            { id: 'v10b', managedStockQuantity: -3 },
          ],
        },
      ],
    });
    const report = await service.buildReport();
    expect(report.counts.R6).toBe(1);
    const row = report.rows.find((r) => r.category === 'R6')!;
    expect(row.variantId).toBe('v10b');
    expect(row.strandedManagedQty).toBe(-3);
  });

  it('R6: ledger residue — managed entries after the mode-change entry, qty already 0', async () => {
    const { service } = makeService({
      q4Products: [
        { id: 'p11', name: 'Residue', type: 'simple', managedStockQuantity: 0, variants: [] },
      ],
      managedLedger: [
        {
          productId: 'p11',
          variantId: null,
          note: 'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED — snapshot: 4 units',
          performedAt: new Date('2026-09-01T10:00:00.000Z'),
        },
        {
          productId: 'p11',
          variantId: null,
          note: 'Reserved for ORD-260902-0001',
          performedAt: new Date('2026-09-02T10:00:00.000Z'),
        },
      ],
    });
    const report = await service.buildReport();
    expect(report.counts.R6).toBe(1);
    const row = report.rows.find((r) => r.category === 'R6')!;
    expect(row.strandedManagedQty).toBe(0);
    expect(row.evidence).toContain('ledger residue');
  });

  it('R6: clean IC product (mode-change entry is the LAST ledger entry) is NOT flagged', async () => {
    const { service } = makeService({
      q4Products: [
        { id: 'p12', name: 'Clean', type: 'simple', managedStockQuantity: 0, variants: [] },
      ],
      managedLedger: [
        {
          productId: 'p12',
          variantId: null,
          note: 'Mode changed from MANAGED_STOCK to INVENTORY_CONTROLLED — snapshot: 4 units',
          performedAt: new Date('2026-09-01T10:00:00.000Z'),
        },
      ],
    });
    const report = await service.buildReport();
    expect(report.counts.R6).toBe(0);
  });

  it('R7: physical row with NO costing lot and NO physical-ledger origin is report-only flagged; a lot-backed row is not', async () => {
    const { service } = makeService({
      q4Physical: [
        { id: 'pi-1', productId: 'p7', variantId: null, warehouseId: 'w1', quantity: 4 },
        { id: 'pi-2', productId: 'p8', variantId: null, warehouseId: 'w1', quantity: 2 },
      ],
      products: [
        { id: 'p7', name: 'Mirror Mug' },
        { id: 'p8', name: 'Real Mug' },
      ],
      costingLots: [{ productId: 'p8', variantId: null, warehouseId: 'w1' }],
      physicalLedger: [],
    });
    const report = await service.buildReport();
    expect(report.counts.R7).toBe(1);
    const row = report.rows.find((r) => r.category === 'R7')!;
    expect(row.productId).toBe('p7');
    expect(row.productName).toBe('Mirror Mug');
    expect(row.physicalQty).toBe(4);
    expect(row.warehouseId).toBe('w1');
    expect(row.missingPhysicalQty).toBe(0); // never an apply target
  });

  it('R8 terminal: Returned order with timeline evidence and NO Return record is backfillable', async () => {
    const { service } = makeService({
      legacyOrders: [
        {
          id: 'oL1',
          displayId: 'ORD-L1',
          status: { name: 'Returned' },
          timeline: [
            { status: 'Return Pending', timestamp: '2026-08-01T10:00:00.000Z', performedBy: 'staff@shop.com' },
            { status: 'Returned', timestamp: '2026-08-03T10:00:00.000Z', performedBy: 'staff@shop.com' },
          ],
          items: [{ productId: 'p1', quantity: 2 }],
        },
      ],
      returns: [],
    });
    const report = await service.buildReport();
    expect(report.counts.R8).toBe(1);
    expect(report.counts.R8H).toBe(0);
    const row = report.rows.find((r) => r.category === 'R8')!;
    expect(row.r8Kind).toBe('terminal');
    expect(row.legacyAt).toBe('2026-08-03T10:00:00.000Z');
    expect(row.legacyActor).toBe('staff@shop.com');
    expect(row.orderId).toBe('oL1');
  });

  it('R8 pending: Return Pending order with NO Return record is backfillable as REQUESTED only', async () => {
    const { service } = makeService({
      legacyOrders: [
        {
          id: 'oL2',
          displayId: 'ORD-L2',
          status: { name: 'Return Pending' },
          timeline: [
            { status: 'Return Pending', timestamp: '2026-08-05T10:00:00.000Z', performedBy: 'staff@shop.com' },
          ],
          items: [{ productId: 'p1', quantity: 1 }],
        },
      ],
      returns: [],
    });
    const report = await service.buildReport();
    expect(report.counts.R8).toBe(1);
    const row = report.rows.find((r) => r.category === 'R8')!;
    expect(row.r8Kind).toBe('pending');
    expect(row.legacyAt).toBe('2026-08-05T10:00:00.000Z');
    expect(row.evidence).toContain('never marks a return received');
  });

  it('R8-H: Returned order with NO timeline transition is report-only (date never fabricated)', async () => {
    const { service } = makeService({
      legacyOrders: [
        {
          id: 'oL3',
          displayId: 'ORD-L3',
          status: { name: 'Returned' },
          timeline: [],
          items: [{ productId: 'p1', quantity: 1 }],
        },
      ],
      returns: [],
    });
    const report = await service.buildReport();
    expect(report.counts.R8).toBe(0);
    expect(report.counts.R8H).toBe(1);
    const row = report.rows.find((r) => r.category === 'R8')!;
    expect(row.r8Kind).toBe('human');
    expect(row.evidence).toContain('R8-H');
  });

  it('R8: an order that already HAS a Return record is not listed (idempotency key)', async () => {
    const { service } = makeService({
      legacyOrders: [
        {
          id: 'oL1',
          displayId: 'ORD-L1',
          status: { name: 'Returned' },
          timeline: [
            { status: 'Returned', timestamp: '2026-08-03T10:00:00.000Z', performedBy: 'staff@shop.com' },
          ],
          items: [{ productId: 'p1', quantity: 2 }],
        },
      ],
      returns: [{ orderId: 'oL1' }],
    });
    const report = await service.buildReport();
    expect(report.counts.R8).toBe(0);
    expect(report.rows.filter((r) => r.category === 'R8')).toHaveLength(0);
  });

  it('Q5: detail names drifted orders by displayId plus the drift reason', async () => {
    const { service } = makeService({
      drifted: [
        { id: 'o-d1', displayId: 'ORD-260101-0001', statusName: 'Delivered', reasons: ['reserved-not-deducted'] },
        { id: 'o-d2', displayId: 'ORD-260101-0002', statusName: 'Cancelled', reasons: ['managed-flags-lingering', 'active-physical-reservation'] },
      ],
    });
    const report = await service.buildReport();
    const q5 = report.checks.find((c) => c.key === 'Q5')!;
    expect(q5.value).toBe(2);
    expect(q5.pass).toBe(false);
    expect(q5.detail).toContain('ORD-260101-0001 (Delivered) — reserved, never deducted');
    expect(q5.detail).toContain('ORD-260101-0002 (Cancelled) — managed flags still set, ACTIVE physical reservation');
    expect(q5.detail).not.toContain('o-d1');
  });

  it('Q5: clean drift scan passes with "None."', async () => {
    const { service } = makeService({ drifted: [] });
    const report = await service.buildReport();
    const q5 = report.checks.find((c) => c.key === 'Q5')!;
    expect(q5.value).toBe(0);
    expect(q5.pass).toBe(true);
    expect(q5.detail).toBe('None.');
  });

  it('Q8: detail names the failing unit with ledger-vs-state numbers', async () => {
    const { service } = makeService({
      verification: {
        checked: 15,
        pass: 14,
        fail: 1,
        products: [
          {
            key: 'p:prod-1|',
            scope: 'MANAGED',
            onHandExpected: 10,
            onHandActual: 8,
            reservedExpected: 0,
            reservedActual: 0,
            availableExpected: 10,
            availableActual: 8,
            pass: false,
            notes: ['on-hand 8 / reserved 0 vs snap 10 / 0'],
          },
        ],
        negativeAvailable: [],
      },
    });
    const report = await service.buildReport();
    const q8 = report.checks.find((c) => c.key === 'Q8')!;
    expect(q8.value).toBe(1);
    expect(q8.pass).toBe(false);
    expect(q8.detail).toContain('checked=15 pass=14 fail=1');
    expect(q8.detail).toContain('p:prod-1| [MANAGED]: on-hand 8 (ledger 10), reserved 0 (ledger 0)');
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
