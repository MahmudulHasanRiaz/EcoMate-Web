// P10 — finalization snapshot + effective read model (§14.2).
//
// computeInvoiceTotals is the canonical decomposition (residual = G − C − N)
// over effective DATA rows only: superseded rows and non-DATA classes never
// reach the financial picture. cashReceived/Disbursed follow the cash-collection
// model, so a negative payout (cost-bearing return) lands in Disbursed.

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CourierSettlementSnapshotService,
  computeInvoiceTotals,
} from '../snapshot.service';

const row = (over: Partial<Parameters<typeof computeInvoiceTotals>[0][number]> = {}) => ({
  rowClass: 'DATA',
  supersededByRowId: null,
  effectiveCollected: 0,
  effectiveCharges: 0,
  effectiveNet: 0,
  ...over,
});

describe('computeInvoiceTotals', () => {
  it('sums effective DATA rows and derives residual = G − C − N', () => {
    const t = computeInvoiceTotals([
      row({ effectiveCollected: 1000, effectiveCharges: 80, effectiveNet: 920 }),
      row({ effectiveCollected: 500, effectiveCharges: 40, effectiveNet: 460 }),
    ]);
    expect(t).toEqual({
      collected: 1500,
      charges: 120,
      net: 1380,
      residual: 0,
      // cash derives from NET (the remittance), not gross collected.
      cashReceived: 1380,
      cashDisbursed: 0,
    });
  });

  it('excludes superseded rows from every bucket', () => {
    const t = computeInvoiceTotals([
      row({ effectiveCollected: 1000, effectiveCharges: 80, effectiveNet: 920 }),
      row({
        supersededByRowId: 'row-B',
        effectiveCollected: 9999,
        effectiveCharges: 9999,
        effectiveNet: 9999,
      }),
    ]);
    expect(t.collected).toBe(1000);
    expect(t.charges).toBe(80);
    expect(t.net).toBe(920);
    expect(t.residual).toBe(0);
  });

  it('excludes non-DATA classes (ADJUSTMENT/META rows never hit the totals)', () => {
    const t = computeInvoiceTotals([
      row({ rowClass: 'META', effectiveCollected: 777, effectiveNet: 777 }),
      row({ effectiveCollected: 100, effectiveCharges: 10, effectiveNet: 90 }),
    ]);
    expect(t.collected).toBe(100);
    expect(t.net).toBe(90);
    expect(t.residual).toBe(0);
  });

  it('routes a negative payout (cost-bearing return) to cashDisbursed', () => {
    const t = computeInvoiceTotals([
      row({ effectiveCollected: 0, effectiveCharges: 100, effectiveNet: -100 }),
    ]);
    expect(t.net).toBe(-100);
    expect(t.cashReceived).toBe(0);
    expect(t.cashDisbursed).toBe(100);
    // decomposition still holds: 0 − 100 − (−100) = 0
    expect(t.residual).toBe(0);
  });

  it('splits mixed nets between received and disbursed', () => {
    const t = computeInvoiceTotals([
      row({ effectiveNet: 300 }),
      row({ effectiveNet: -120 }),
    ]);
    expect(t.cashReceived).toBe(300);
    expect(t.cashDisbursed).toBe(120);
    expect(t.net).toBe(180);
  });

  it('rounds to 2 decimals on every field', () => {
    const t = computeInvoiceTotals([
      row({
        effectiveCollected: 10.005,
        effectiveCharges: 3.333,
        effectiveNet: 6.666,
      }),
    ]);
    expect(t.collected).toBe(10.01);
    expect(t.charges).toBe(3.33);
    expect(t.net).toBe(6.67);
    expect(t.residual).toBe(0.01);
  });

  it('an empty invoice is all zeros (never null/NaN)', () => {
    expect(computeInvoiceTotals([])).toEqual({
      collected: 0,
      charges: 0,
      net: 0,
      residual: 0,
      cashReceived: 0,
      cashDisbursed: 0,
    });
  });
});

describe('CourierSettlementSnapshotService', () => {
  const historicalPayload = {
    version: 3,
    takenAt: new Date('2026-09-20T10:00:00Z'),
    takenById: 'admin',
    journalEntryId: 'je-1',
    reason: 'final',
    totals: { collected: 1000, charges: 80, net: 920 },
    rows: [],
  };

  async function service(prismaMock: any) {
    const mod = await Test.createTestingModule({
      providers: [
        CourierSettlementSnapshotService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    return mod.get(CourierSettlementSnapshotService);
  }

  it('getHistorical returns the newest snapshot + the version chain', async () => {
    const snapshots = [
      { ...historicalPayload, version: 3 },
      { ...historicalPayload, version: 2 },
      { ...historicalPayload, version: 1 },
    ];
    const svc = await service({
      courierSettlementFinalizationSnapshot: {
        findMany: jest.fn().mockResolvedValue(snapshots),
      },
    });
    const out = await svc.getHistorical('inv-1');
    expect(out.version).toBe(3);
    expect(out.totals).toEqual({ collected: 1000, charges: 80, net: 920 });
    expect(out.snapshots.map((s: any) => s.version)).toEqual([3, 2, 1]);
  });

  it('getHistorical throws when no snapshot exists (never invents one)', async () => {
    const svc = await service({
      courierSettlementFinalizationSnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    await expect(svc.getHistorical('inv-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getEffective reports current vs superseded rows and recomputed totals', async () => {
    const svc = await service({
      courierSettlementInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inv-1',
          state: 'ADJUSTED',
          accountingStatus: 'posted',
        }),
      },
      courierSettlementRow: {
        // DB-side aggregates replaced the full-row load (§16).
        aggregate: jest
          .fn()
          .mockImplementation(({ where }: any) => {
            if (where.effectiveNet?.gt != null)
              return Promise.resolve({ _sum: { effectiveNet: 920 } });
            if (where.effectiveNet?.lt != null)
              return Promise.resolve({ _sum: { effectiveNet: null } });
            return Promise.resolve({
              _sum: { effectiveCollected: 1000, effectiveCharges: 80, effectiveNet: 920 },
            });
          }),
        groupBy: jest.fn().mockResolvedValue([
          { supersededByRowId: null, _count: { _all: 1 } },
          { supersededByRowId: 'row-B', _count: { _all: 1 } },
        ]),
      },
    });
    const out = await svc.getEffective('inv-1');
    expect(out.state).toBe('ADJUSTED');
    expect(out.effectiveTotals.collected).toBe(1000);
    expect(out.effectiveTotals.residual).toBe(0);
    expect(out.effectiveTotals.cashReceived).toBe(920);
    expect(out.currentRows).toBe(1);
    expect(out.supersededRows).toBe(1);
  });

  it('getEffective throws NotFoundException for a missing invoice', async () => {
    const svc = await service({
      courierSettlementInvoice: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.getEffective('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('historical and effective diverge after a revision (the §14.2 banner case)', async () => {
    const historical = {
      courierSettlementFinalizationSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { ...historicalPayload, version: 1, totals: { collected: 1000, net: 920 } },
        ]),
      },
    };
    const svcHistorical = await service(historical);
    const svcEffective = await service({
      courierSettlementInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inv-1',
          state: 'RECONCILED',
          accountingStatus: 'posted',
        }),
      },
      courierSettlementRow: {
        aggregate: jest.fn().mockImplementation(({ where }: any) => {
          if (where.effectiveNet?.gt != null)
            return Promise.resolve({ _sum: { effectiveNet: 870 } });
          if (where.effectiveNet?.lt != null)
            return Promise.resolve({ _sum: { effectiveNet: null } });
          return Promise.resolve({
            _sum: { effectiveCollected: 950, effectiveCharges: 80, effectiveNet: 870 },
          });
        }),
        groupBy: jest.fn().mockResolvedValue([
          { supersededByRowId: null, _count: { _all: 1 } },
        ]),
      },
    });
    const h = await svcHistorical.getHistorical('inv-1');
    const e = await svcEffective.getEffective('inv-1');
    expect(h.totals.collected).toBe(1000);
    expect(e.effectiveTotals.collected).toBe(950);
    expect(h.totals.collected).not.toBe(e.effectiveTotals.collected);
  });
});
