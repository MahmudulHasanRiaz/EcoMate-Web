// §5 state machine — the review states must be able to move FORWARD after an
// issue is fixed. Import lands an invoice in ISSUE_FOUND; without this refresh
// a red finding would strand the invoice forever even once every exception was
// resolved (ISSUE_FOUND is not a claimable finalize state). Financial states
// are never rewritten by an exception refresh.

import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierSettlementExceptionsService } from '../exceptions.service';
import { CourierSettlementActivityService } from '../activity.service';

async function makeService(over: {
  state?: string | null;
  red?: number;
  yellow?: number;
} = {}) {
  const prisma: any = {
    courierSettlementInvoice: {
      findUnique: jest.fn().mockResolvedValue(
        over.state === undefined ? { state: 'ISSUE_FOUND' } : over.state === null ? null : { state: over.state },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    courierSettlementException: {
      count: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(where.severity === 'red' ? (over.red ?? 0) : (over.yellow ?? 0)),
        ),
    },
    $transaction: jest.fn(),
  };
  const activity = { record: jest.fn().mockResolvedValue(undefined) };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementExceptionsService,
      { provide: PrismaService, useValue: prisma },
      { provide: CourierSettlementActivityService, useValue: activity },
    ],
  }).compile();

  return { svc: mod.get(CourierSettlementExceptionsService), prisma, activity };
}

describe('CourierSettlementExceptionsService.refreshInvoiceState (§5)', () => {
  it('moves ISSUE_FOUND → READY_FOR_REVIEW once no open findings remain', async () => {
    const { svc, prisma, activity } = await makeService({ red: 0, yellow: 0 });
    await expect(svc.refreshInvoiceState('inv-1')).resolves.toBe('READY_FOR_REVIEW');
    expect(prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { state: 'READY_FOR_REVIEW' } }),
    );
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-1',
        detail: expect.objectContaining({ from: 'ISSUE_FOUND', to: 'READY_FOR_REVIEW' }),
      }),
    );
  });

  it('keeps ISSUE_FOUND while a RED finding is still open', async () => {
    const { svc, prisma } = await makeService({ red: 1, yellow: 2 });
    await expect(svc.refreshInvoiceState('inv-1')).resolves.toBe('ISSUE_FOUND');
    expect(prisma.courierSettlementInvoice.update).not.toHaveBeenCalled();
  });

  it('maps 0 red + open YELLOW → REVIEW_REQUIRED', async () => {
    const { svc, prisma } = await makeService({ red: 0, yellow: 1 });
    await expect(svc.refreshInvoiceState('inv-1')).resolves.toBe('REVIEW_REQUIRED');
    expect(prisma.courierSettlementInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { state: 'REVIEW_REQUIRED' } }),
    );
  });

  it('never rewrites a financially finalized state', async () => {
    const { svc, prisma } = await makeService({ state: 'ACCOUNTING_POSTED', red: 0, yellow: 0 });
    await expect(svc.refreshInvoiceState('inv-1')).resolves.toBeNull();
    expect(prisma.courierSettlementInvoice.update).not.toHaveBeenCalled();
  });

  it('never rewrites an in-flight finalization', async () => {
    const { svc, prisma } = await makeService({ state: 'FINALIZING', red: 0, yellow: 0 });
    await expect(svc.refreshInvoiceState('inv-1')).resolves.toBeNull();
    expect(prisma.courierSettlementInvoice.update).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown invoice', async () => {
    const { svc, prisma } = await makeService({ state: null });
    await expect(svc.refreshInvoiceState('nope')).resolves.toBeNull();
    expect(prisma.courierSettlementInvoice.update).not.toHaveBeenCalled();
  });
});
