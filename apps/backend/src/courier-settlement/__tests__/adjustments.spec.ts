// P10 — the 3 correction classes (§8), reversal (§10), and the ΔR/counterpart gate.
//
// A. source  — identification fields only: raw string preserved (never money-
//              coerced), no journal, difference null, matching re-run.
// B. cost    — effectiveCharges override; ΔC posts a compensating journal and
//              writes the order cost projection back.
// C. settlement — effectiveCollected/Net override with its declared counterpart.
//
// A correction whose ΔR ≠ 0 with no declared counterpart is REJECTED (§8.2) —
// it would silently invent a residual.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierSettlementAdjustmentsService } from '../adjustments.service';
import { CourierSettlementAccountingService } from '../courier-settlement-accounting.service';
import { CourierSettlementActivityService } from '../activity.service';
import { CourierSettlementCostService } from '../cost-projection.service';
import { CourierSettlementReconciliationService } from '../reconciliation.service';
import { CourierSettlementExceptionsService } from '../exceptions.service';
import { CacheService } from '../../cache/cache.service';

const invoice = { id: 'inv-1', displayId: 'CS-260927-0001' };

function makeRow() {
  return {
    id: 'row-1',
    invoiceId: 'inv-1',
    rowNumber: 1,
    orderId: 'ord-1',
    consignmentId: 'OLD-CONSIGN',
    identifier: 'ORD-1',
    declaredCollected: 1000,
    declaredCharges: 80,
    declaredNet: 920,
    effectiveCollected: 1000,
    effectiveCharges: 80,
    effectiveNet: 920,
    effectiveResidual: 0,
    normalized: { displayId: 'ORD-1', trackingCode: 'TRK-OLD', consignmentId: 'OLD-CONSIGN' },
    hasAdjustment: false,
    matchMethod: 'NONE',
  };
}

async function makeService(over: {
  invoice?: any;
  row?: any;
  adjustment?: any;
  count?: number;
} = {}) {
  const prisma: any = {
    courierSettlementInvoice: {
      findUnique: jest.fn().mockResolvedValue(
        over.invoice === undefined ? invoice : over.invoice,
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    courierSettlementRow: {
      findUnique: jest.fn().mockResolvedValue(
        over.row === undefined ? makeRow() : over.row,
      ),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest
        .fn()
        .mockResolvedValue([
          // Prisma Decimal objects, not numbers — coercion is part of the contract
          { rowClass: 'DATA', supersededByRowId: null, effectiveCollected: '1000', effectiveCharges: '80', effectiveNet: '920' },
        ]),
      // effectiveTotals refresh now aggregates in the DB (§16).
      aggregate: jest.fn().mockImplementation(({ where }: any) => {
        if (where?.effectiveNet?.gt != null)
          return Promise.resolve({ _sum: { effectiveNet: '920' } });
        if (where?.effectiveNet?.lt != null)
          return Promise.resolve({ _sum: { effectiveNet: null } });
        return Promise.resolve({
          _sum: { effectiveCollected: '1000', effectiveCharges: '80', effectiveNet: '920' },
        });
      }),
      groupBy: jest.fn().mockResolvedValue([
        { supersededByRowId: null, _count: { _all: 1 } },
      ]),
    },
    courierSettlementAdjustment: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'adj-1', adjustmentClass: 'source' }),
      findUnique: jest.fn().mockResolvedValue(
        over.adjustment ?? { id: 'adj-1', invoiceId: 'inv-1', field: 'effectiveCharges', difference: 20, adjustmentClass: 'cost', counterpart: 'net', journalEntryId: 'je-1', reversedById: null, rowId: 'row-1' },
      ),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(over.count ?? 1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  const accounting = {
    postCorrection: jest.fn().mockResolvedValue({ journalEntryId: 'je-9' }),
    dhakaEntryDate: jest.fn().mockReturnValue('2026-09-27'),
  };
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const cost = { writeBack: jest.fn().mockResolvedValue(undefined) };
  const reconciliation = { rematchRow: jest.fn().mockResolvedValue([]) };
  const exceptions = { refreshInvoiceState: jest.fn().mockResolvedValue('READY_FOR_REVIEW') };
  const cache = { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementAdjustmentsService,
      { provide: PrismaService, useValue: prisma },
      { provide: CourierSettlementAccountingService, useValue: accounting },
      { provide: CourierSettlementActivityService, useValue: activity },
      { provide: CourierSettlementCostService, useValue: cost },
      { provide: CourierSettlementReconciliationService, useValue: reconciliation },
      { provide: CourierSettlementExceptionsService, useValue: exceptions },
      { provide: CacheService, useValue: cache },
    ],
  }).compile();

  const svc = mod.get(CourierSettlementAdjustmentsService);
  return { svc, prisma, accounting, activity, cost, reconciliation, exceptions, cache };
}

describe('CourierSettlementAdjustmentsService — class A (source)', () => {
  it('throws NotFoundException when the invoice does not exist', async () => {
    const { svc } = await makeService({ invoice: null });
    await expect(
      svc.create({ invoiceId: 'nope', adjustmentClass: 'source', field: 'consignmentId', adjustedValue: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves the raw string — never money-coerced to 0', async () => {
    const { svc, prisma, accounting, reconciliation, cache } = await makeService();
    const rec = await svc.create({
      invoiceId: 'inv-1',
      rowId: 'row-1',
      adjustmentClass: 'source',
      field: 'consignmentId',
      adjustedValue: 'TRK-123',
      actor: 'admin',
    });

    const data = prisma.courierSettlementAdjustment.create.mock.calls[0][0].data;
    expect(data.adjustedValue).toBe('TRK-123');
    expect(data.originalValue).toBe('OLD-CONSIGN');
    // class A carries no financial delta
    expect(data.difference).toBeNull();
    expect(data.counterpart).toBeUndefined();
    expect(rec.adjustmentClass).toBe('source');
    // §8 class A posts no journal
    expect(accounting.postCorrection).not.toHaveBeenCalled();
    // but it DOES re-run matching so NO_MATCH can clear
    expect(reconciliation.rematchRow).toHaveBeenCalledWith('row-1');
    // financial=false ⇒ analytics caches untouched
    expect(cache.invalidateByPrefix).not.toHaveBeenCalled();
  });

  it('writes the correction into normalized AND the consignmentId column', async () => {
    const { svc, prisma } = await makeService();
    await svc.create({
      invoiceId: 'inv-1',
      rowId: 'row-1',
      adjustmentClass: 'source',
      field: 'consignmentId',
      adjustedValue: 'TRK-123',
    });
    const update = prisma.courierSettlementRow.update.mock.calls[0][0].data;
    expect(update.consignmentId).toBe('TRK-123');
    expect(update.normalized.consignmentId).toBe('TRK-123');
    expect(update.hasAdjustment).toBe(true);
    // no effective value touched
    expect(update.effectiveCharges).toBeUndefined();
    expect(update.effectiveCollected).toBeUndefined();
  });

  it('keeps a PRE-FINALIZE invoice out of ADJUSTED and refreshes its exception state', async () => {
    const { svc, prisma, exceptions } = await makeService({
      invoice: { id: 'inv-1', displayId: 'CS-260927-0001', state: 'ISSUE_FOUND' },
    });
    await svc.create({
      invoiceId: 'inv-1',
      adjustmentClass: 'source',
      field: 'displayId',
      adjustedValue: 'ORD-9',
    });
    // stranding it in ADJUSTED (not a claimable state) would block finalization forever
    expect(prisma.courierSettlementInvoice.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'ADJUSTED' }) }),
    );
    expect(exceptions.refreshInvoiceState).toHaveBeenCalledWith('inv-1', undefined);
  });

  it('refreshes the stored effectiveTotals column so the list view stays truthful', async () => {
    const { svc, prisma } = await makeService({
      invoice: { id: 'inv-1', displayId: 'CS-260927-0001', state: 'ACCOUNTING_POSTED' },
    });
    await svc.create({
      invoiceId: 'inv-1',
      adjustmentClass: 'source',
      field: 'displayId',
      adjustedValue: 'ORD-9',
    });
    expect(prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          effectiveTotals: expect.objectContaining({
            collected: 1000,
            charges: 80,
            net: 920,
            residual: 0,
          }),
        }),
      }),
    );
  });

  it('moves a finalizable invoice to ADJUSTED and records the activity', async () => {
    const { svc, prisma, exceptions } = await makeService({
      invoice: { id: 'inv-1', displayId: 'CS-260927-0001', state: 'ACCOUNTING_POSTED' },
    });
    await svc.create({
      invoiceId: 'inv-1',
      adjustmentClass: 'source',
      field: 'displayId',
      adjustedValue: 'ORD-9',
    });
    expect(prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'ADJUSTED' }) }),
    );
    expect(exceptions.refreshInvoiceState).not.toHaveBeenCalled();
  });

  it('leaves the invoice ADJUSTED and records the activity', async () => {
    const { svc, prisma, activity } = await makeService();
    await svc.create({
      invoiceId: 'inv-1',
      adjustmentClass: 'source',
      field: 'displayId',
      adjustedValue: 'ORD-9',
    });
    expect(prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'ADJUSTED' }) }),
    );
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', action: 'ADJUSTED' }),
    );
  });
});

describe('CourierSettlementAdjustmentsService — class B (cost)', () => {
  it('rejects a ΔR ≠ 0 correction with no declared counterpart', async () => {
    const { svc } = await makeService();
    await expect(
      svc.create({
        invoiceId: 'inv-1',
        rowId: 'row-1',
        adjustmentClass: 'cost',
        field: 'effectiveCharges',
        adjustedValue: 100, // +20, counterpart absent ⇒ ΔR = −20
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts the journal, overrides effectiveCharges and writes cost back', async () => {
    const { svc, prisma, accounting, cost, cache } = await makeService();
    await svc.create({
      invoiceId: 'inv-1',
      rowId: 'row-1',
      adjustmentClass: 'cost',
      field: 'effectiveCharges',
      adjustedValue: 100,
      counterpart: 'net',
      actor: 'admin',
    });

    expect(accounting.postCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ deltaC: 20, deltaN: -20, deltaG: 0, counterpart: 'net' }),
    );
    const update = prisma.courierSettlementRow.update.mock.calls[0][0].data;
    expect(update.effectiveCharges).toBe(100);
    // residual = collected − charges − net = 1000 − 100 − 920
    expect(update.effectiveResidual).toBe(-20);
    expect(cost.writeBack).toHaveBeenCalledWith('ord-1', undefined, 'admin');
    // financial ⇒ derived caches invalidated
    expect(cache.invalidateByPrefix).toHaveBeenCalledWith('analytics:');
    expect(cache.invalidateByPrefix).toHaveBeenCalledWith('courier-settlement:');
  });

  it('stores the journal reference on the adjustment record', async () => {
    const { svc, prisma } = await makeService();
    await svc.create({
      invoiceId: 'inv-1',
      rowId: 'row-1',
      adjustmentClass: 'cost',
      field: 'effectiveCharges',
      adjustedValue: 100,
      counterpart: 'net',
    });
    const data = prisma.courierSettlementAdjustment.create.mock.calls[0][0].data;
    expect(data.adjustmentClass).toBe('cost');
    expect(data.journalEntryId).toBe('je-9');
    expect(data.difference).toBe(20);
    expect(data.counterpart).toBe('net');
  });
});

describe('CourierSettlementAdjustmentsService — class C (settlement)', () => {
  it('defaults the counterpart to gross when adjusting collected', async () => {
    const { svc, accounting, prisma } = await makeService();
    await svc.create({
      invoiceId: 'inv-1',
      rowId: 'row-1',
      adjustmentClass: 'settlement',
      field: 'effectiveCollected',
      adjustedValue: 950, // −50
    });
    expect(accounting.postCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ deltaG: -50, deltaC: 0, deltaN: 0, counterpart: 'gross' }),
    );
    const update = prisma.courierSettlementRow.update.mock.calls[0][0].data;
    expect(update.effectiveCollected).toBe(950);
    // residual = 950 − 80 − 920
    expect(update.effectiveResidual).toBe(-50);
  });

  it('rejects a net correction with no declared counterpart', async () => {
    const { svc, accounting } = await makeService();
    await expect(
      svc.create({
        invoiceId: 'inv-1',
        rowId: 'row-1',
        adjustmentClass: 'settlement',
        field: 'effectiveNet',
        adjustedValue: 900, // ΔN = −20 ⇒ ΔR = +20 with no counterpart
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // never silently booked
    expect(accounting.postCorrection).not.toHaveBeenCalled();
  });
});

describe('CourierSettlementAdjustmentsService — reversal (§10)', () => {
  it('throws NotFoundException for a missing adjustment', async () => {
    const { svc, prisma } = await makeService({ adjustment: null });
    prisma.courierSettlementAdjustment.findUnique.mockResolvedValue(null);
    await expect(svc.reverse('nope', 'fix')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to reverse twice', async () => {
    const { svc } = await makeService({
      adjustment: { id: 'adj-1', invoiceId: 'inv-1', reversedById: 'adj-2', field: 'effectiveCharges', difference: 20, adjustmentClass: 'cost', journalEntryId: 'je-1', rowId: 'row-1', counterpart: 'net' },
    });
    await expect(svc.reverse('adj-1', 'again')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a compensating record, marks the original, restores the row', async () => {
    const { svc, prisma, accounting, cost } = await makeService({
      // the row already carries the adjusted value (80 → 100) at reversal time
      row: { ...makeRow(), effectiveCharges: 100, effectiveResidual: -20 },
      adjustment: {
        id: 'adj-1',
        invoiceId: 'inv-1',
        rowId: 'row-1',
        adjustmentClass: 'cost',
        field: 'effectiveCharges',
        originalValue: '80',
        adjustedValue: '100',
        difference: 20,
        counterpart: 'net',
        journalEntryId: 'je-1',
        reversedById: null,
      },
    });

    const reversal = await svc.reverse('adj-1', 'mistake', 'admin');

    // compensating journal with the opposite sign
    expect(accounting.postCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ deltaC: -20, counterpart: 'net' }),
    );
    const create = prisma.courierSettlementAdjustment.create.mock.calls[0][0].data;
    expect(create.reversalOfId).toBe('adj-1');
    expect(create.difference).toBe(-20);
    expect(create.originalValue).toBe('100');
    expect(create.adjustedValue).toBe('80');
    // original is marked reversed (append-only history, never deleted)
    expect(prisma.courierSettlementAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reversedById: expect.anything() } }),
    );
    // effective value rolled back: 100 − 20 = 80
    const rowUpdate = prisma.courierSettlementRow.update.mock.calls[0][0].data;
    expect(rowUpdate.effectiveCharges).toBe(80);
    expect(cost.writeBack).toHaveBeenCalled();
    expect(reversal).toBeDefined();
  });

  it('rolls back an adjustment that never posted a journal without inventing one', async () => {
    const { svc, accounting } = await makeService({
      adjustment: {
        id: 'adj-1',
        invoiceId: 'inv-1',
        rowId: null,
        adjustmentClass: 'source',
        field: 'consignmentId',
        difference: 0,
        counterpart: null,
        journalEntryId: null,
        reversedById: null,
      },
    });
    await svc.reverse('adj-1', 'undo');
    expect(accounting.postCorrection).not.toHaveBeenCalled();
  });
});

describe('CourierSettlementAdjustmentsService — previewCorrection', () => {
  it('surfaces the rejection reason when ΔR ≠ 0 has no counterpart', async () => {
    const { svc } = await makeService();
    const out = svc.previewCorrection(0, 20, 0, null);
    expect(out.rejected).toBe(true);
    expect(out.deltaR).toBe(-20);
    expect(out.rejectionReason).toMatch(/counterpart/);
    expect(Array.isArray(out.findings)).toBe(true);
  });

  it('accepts a declared counterpart and reports findings', async () => {
    const { svc } = await makeService();
    const out = svc.previewCorrection(0, 20, -20, 'net');
    expect(out.rejected).toBe(false);
    expect(out.deltaR).toBe(0);
    expect(out.counterpartUsed).toBe(false);
  });
});
