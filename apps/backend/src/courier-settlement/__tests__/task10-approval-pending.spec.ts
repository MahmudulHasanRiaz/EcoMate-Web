import { expectedCod } from '../economics';
import { sanitizeCourierText } from '../../courier-manager/courier-settle-guard';
import { CodMismatchService } from '../../cod-mismatch/cod-mismatch.service';
import { CourierSettlementImportService } from '../courier-settlement-import.service';
import { resolveRowKind } from '../parsing/helpers';
import { getDescriptor } from '../parsing/descriptors';

/**
 * Task 10 — approval_pending exclusion in all three surfaces
 * (COD-alert + settlement-expected + expectedCod) + truncation/strip helper.
 * TDD RED first: these assert the owner-locked behavior current code violates.
 */
describe('Task 10 — expectedCod never settles approval_pending', () => {
  const base = { total: 1000, payments: [], trashedAt: null, statusName: 'Processing' } as const;

  it.each([
    'delivered_approval_pending',
    'partial_delivered_approval_pending',
    'cancelled_approval_pending',
    'unknown_approval_pending',
    'DELIVERED_APPROVAL_PENDING',
    'exchanged_approval_pending',
    'exceptional',
  ])('is 0 for courierStatus %s', (courierStatus) => {
    const r = expectedCod({ ...base, paymentOptionType: 'CASH_ON_DELIVERY', courierStatus } as any);
    expect(r.value).toBe(0);
    expect(r.source).toBe('not_cod');
  });

  it('confirmed delivered/partial/cancelled courier statuses keep the COD expectation', () => {
    for (const s of ['delivered', 'partial_delivered', 'in_transit', undefined, null]) {
      const r = expectedCod({ ...base, paymentOptionType: 'CASH_ON_DELIVERY', courierStatus: s } as any);
      expect(r.value).toBe(1000);
    }
  });
});

describe('Task 10 — sanitizeCourierText (strip + pre-check lengths)', () => {
  it('strips { } ; < > $ to spaces', () => {
    expect(sanitizeCourierText('a{b}c;d<e>f$g', 100)).toBe('a b c d e f g');
  });

  it('truncates invoice to 100, phone to 40, address to 490, note to 480', () => {
    expect(sanitizeCourierText('X'.repeat(200), 100).length).toBe(100);
    expect(sanitizeCourierText('1'.repeat(100), 40).length).toBe(40);
    expect(sanitizeCourierText('A'.repeat(600), 490).length).toBe(490);
    expect(sanitizeCourierText('N'.repeat(600), 480).length).toBe(480);
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeCourierText('  hello  ', 100)).toBe('hello');
  });
});

describe('Task 10 — COD-alert skips approval_pending dispatches', () => {
  function makeService(dispatches: any[]) {
    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          total: 1000,
          payments: [],
          dispatches,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      codMismatchAlert: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'a1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    return { service: new CodMismatchService(prisma as any), prisma };
  }

  it('approval_pending / exceptional dispatches never raise COD alerts', async () => {
    const { service, prisma } = makeService([
      { courier: 'steadfast', consignmentId: 'C1', status: 'ASSIGNED_TO_RIDER', courierStatus: 'delivered_approval_pending', courierAmount: 1000 },
      { courier: 'steadfast', consignmentId: 'C2', status: 'ASSIGNED_TO_RIDER', courierStatus: 'cancelled_approval_pending', courierAmount: 1000 },
      { courier: 'steadfast', consignmentId: 'C3', status: 'IN_TRANSIT', courierStatus: 'exceptional', courierAmount: 1000 },
    ]);
    // systemDue for total 1000, no payments = 1000; courierAmount 1000 matches,
    // but even a mismatch must not alert for unsettled rows — use mismatch:
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      total: 500,
      payments: [],
      dispatches: [
        { courier: 'steadfast', consignmentId: 'C1', status: 'ASSIGNED_TO_RIDER', courierStatus: 'delivered_approval_pending', courierAmount: 1000 },
      ],
    });
    const out = await service.recompute('o1');
    expect(out).toEqual([]);
    expect(prisma.codMismatchAlert.create).not.toHaveBeenCalled();
  });

  it('confirmed DELIVERED dispatches still raise COD alerts on mismatch', async () => {
    const { service, prisma } = makeService([]);
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      total: 500,
      payments: [],
      dispatches: [
        { courier: 'steadfast', consignmentId: 'C9', status: 'DELIVERED', courierStatus: 'delivered', courierAmount: 1000 },
      ],
    });
    const out = await service.recompute('o1');
    expect(out).toHaveLength(1);
    expect(prisma.codMismatchAlert.create).toHaveBeenCalled();
  });
});

describe('Task 10 — settlement booking skips non-DELIVERY rows', () => {
  it('an unsettled (UNKNOWN-kind approval_pending) row with collected>0 books no payment', async () => {
    const svc = Object.create(CourierSettlementImportService.prototype);
    (svc as any).credit = null;
    const created: any[] = [];
    const tx: any = {
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `pay-${created.length + 1}`, ...data };
          created.push(row);
          return row;
        }),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prepared: any = {
      rowRecords: [
        {
          // Approval-pending rows classify to non-DELIVERY kinds
          // (settle-exclusion.spec locks this); the booking gate enforces it.
          row: { rowClass: 'DATA', rowKind: 'UNKNOWN', effectiveCollected: 1000 },
          match: { orderId: 'o1' },
        },
      ],
    };
    await (svc as any).bookSettlementPayments(tx, 'inv-1', 'steadfast', prepared);
    expect(created).toHaveLength(0);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('a DELIVERY row with collected>0 still books', async () => {
    const svc = Object.create(CourierSettlementImportService.prototype);
    (svc as any).credit = null;
    const created: any[] = [];
    const tx: any = {
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `pay-${created.length + 1}`, ...data };
          created.push(row);
          return row;
        }),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prepared: any = {
      rowRecords: [
        {
          row: { rowClass: 'DATA', rowKind: 'DELIVERY', effectiveCollected: 770 },
          match: { orderId: 'o1' },
        },
      ],
    };
    await (svc as any).bookSettlementPayments(tx, 'inv-1', 'steadfast', prepared);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ orderId: 'o1', amount: 770, status: 'PAID' });
  });

  it('a partial_delivered row with collected>0 books a REAL payment row', async () => {
    const kinds = getDescriptor('steadfast').kindMap;
    const rowKind = resolveRowKind('partial_delivered', kinds);
    expect(rowKind).toBe('DELIVERY');
    const svc = Object.create(CourierSettlementImportService.prototype);
    (svc as any).credit = null;
    const created: any[] = [];
    const tx: any = {
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `pay-${created.length + 1}`, ...data };
          created.push(row);
          return row;
        }),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prepared: any = {
      rowRecords: [{ row: { rowClass: 'DATA', rowKind, effectiveCollected: 500 }, match: { orderId: 'o1' } }],
    };
    await (svc as any).bookSettlementPayments(tx, 'inv-1', 'steadfast', prepared);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ orderId: 'o1', amount: 500, status: 'PAID' });
  });

  it('approval_pending rows resolve NON-bookable and skip booking', async () => {
    const kinds = getDescriptor('steadfast').kindMap;
    for (const status of ['delivered_approval_pending', 'partial_delivered_approval_pending']) {
      expect(resolveRowKind(status, kinds)).not.toBe('DELIVERY');
    }
    const svc = Object.create(CourierSettlementImportService.prototype);
    (svc as any).credit = null;
    const created: any[] = [];
    const tx: any = {
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `pay-${created.length + 1}`, ...data };
          created.push(row);
          return row;
        }),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prepared: any = {
      rowRecords: [
        {
          row: {
            rowClass: 'DATA',
            rowKind: resolveRowKind('partial_delivered_approval_pending', kinds),
            effectiveCollected: 500,
          },
          match: { orderId: 'o1' },
        },
      ],
    };
    await (svc as any).bookSettlementPayments(tx, 'inv-1', 'steadfast', prepared);
    expect(created).toHaveLength(0);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });
});
