// §9/§15 — deletion never happens. Discard is the audited pre-finalize
// withdrawal: the invoice stays for audit, stops blocking the duplicate-file
// checksum lookup, and can no longer be finalized. Financial states are
// refused — a finalized invoice cannot be thrown away.

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
      update: jest.fn().mockResolvedValue({ state: 'DISCARDED' }),
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

describe('CourierSettlementFinalizeService.discard (§9/§15)', () => {
  it('withdraws a pre-finalize invoice to DISCARDED and audits the reason', async () => {
    const { svc, prisma, activity } = await makeService();
    const res = await svc.discard('inv-1', 'u1', 'duplicate of CS-260927-0001');
    expect(res).toEqual({ invoiceId: 'inv-1', state: 'DISCARDED', alreadyDiscarded: false });
    expect(prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'DISCARDED' }) }),
    );
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-1',
        action: 'DISCARDED',
        actor: 'u1',
        detail: expect.objectContaining({
          from: 'READY_FOR_REVIEW',
          reason: 'duplicate of CS-260927-0001',
        }),
      }),
    );
  });

  it('is idempotent for an already discarded invoice', async () => {
    const { svc, prisma } = await makeService('DISCARDED');
    const res = await svc.discard('inv-1');
    expect(res.alreadyDiscarded).toBe(true);
    expect(prisma.courierSettlementInvoice.update).not.toHaveBeenCalled();
  });

  it('refuses to discard a financially finalized invoice', async () => {
    const { svc } = await makeService('ACCOUNTING_POSTED');
    await expect(svc.discard('inv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses while a finalization is in flight', async () => {
    const { svc } = await makeService('FINALIZING');
    await expect(svc.discard('inv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('raises NotFound for an unknown invoice', async () => {
    const { svc } = await makeService(null);
    await expect(svc.discard('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
