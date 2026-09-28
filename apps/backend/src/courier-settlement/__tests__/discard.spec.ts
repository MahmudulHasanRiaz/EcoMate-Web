// §9/§15 — discard is a permanent, hard deletion. The invoice row and all
// invoice-scoped children (rows, exceptions, adjustments, activities,
// snapshots — all onDelete: Cascade) are removed, so a discarded draft
// vanishes from every list, filter, count, and the duplicate-file lookup.
// Financial states are refused — a finalized invoice cannot be thrown away.

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierSettlementFinalizeService } from '../courier-settlement-finalize.service';
import { CourierSettlementSettingsService } from '../courier-settlement-settings.service';
import { CourierSettlementAccountingService } from '../courier-settlement-accounting.service';
import { CourierSettlementCostService } from '../cost-projection.service';
import { CourierSettlementActivityService } from '../activity.service';

async function makeService(state?: string | null) {
  const prisma: any = {
    courierSettlementInvoice: {
      findUnique: jest.fn().mockResolvedValue(
        state === undefined
          ? { id: 'inv-1', displayId: 'CS-260927-0001', state: 'READY_FOR_REVIEW' }
          : state === null
            ? null
            : { id: 'inv-1', displayId: 'CS-260927-0001', state },
      ),
      delete: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    },
    $transaction: jest.fn(),
  };
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const settings = { get: jest.fn().mockResolvedValue(null) };
  const accounting = { postFinalization: jest.fn() };
  const cost = { writeBack: jest.fn() };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementFinalizeService,
      { provide: PrismaService, useValue: prisma },
      { provide: CourierSettlementSettingsService, useValue: settings },
      { provide: CourierSettlementAccountingService, useValue: accounting },
      { provide: CourierSettlementCostService, useValue: cost },
      { provide: CourierSettlementActivityService, useValue: activity },
    ],
  }).compile();

  return { svc: mod.get(CourierSettlementFinalizeService), prisma, activity };
}

describe('CourierSettlementFinalizeService.discard (§9/§15 — hard delete)', () => {
  it('permanently deletes a pre-finalize invoice and leaves no trace', async () => {
    const { svc, prisma, activity } = await makeService();
    const res = await svc.discard('inv-1', 'u1', 'duplicate of CS-260927-0001');
    expect(res).toEqual({ invoiceId: 'inv-1', deleted: true });
    expect(prisma.courierSettlementInvoice.delete).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
    });
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('raises NotFound for an unknown or already-deleted invoice', async () => {
    const { svc } = await makeService(null);
    await expect(svc.discard('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to discard a financially finalized invoice', async () => {
    const { svc } = await makeService('ACCOUNTING_POSTED');
    await expect(svc.discard('inv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses while a finalization is in flight', async () => {
    const { svc } = await makeService('FINALIZING');
    await expect(svc.discard('inv-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
