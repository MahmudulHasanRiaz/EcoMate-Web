import { DispatchService } from './dispatch.service';

/**
 * Pre-cancel live verification (owner spec 2026-10-30): the cancel dialog's
 * preview syncs the order's live dispatches with their couriers FIRST, then
 * evaluates eligibility on the fresh rows, and reports the paid picture.
 * A failed verification falls back to local state + verificationFailed.
 */
describe('DispatchService.getCancelPreview', () => {
  const fullRow = {
    id: 'dsp-1',
    orderId: 'order-1',
    courier: 'pathao',
    status: 'PICKUP_FAILED',
    consignmentId: 'CONS-1',
    trackingCode: null,
    pickedUpAt: null,
    handedOverAt: null,
    deliveredAt: null,
    courierStatus: 'order.pickup-failed',
    courierStatusAt: null,
    createdAt: new Date(),
  };

  const makeService = () => {
    const prisma: any = {
      order: { findUnique: jest.fn().mockResolvedValue({ id: 'order-1' }) },
      dispatch: {
        findMany: jest.fn().mockImplementation(async (args: any) =>
          args?.select
            ? [{ id: 'dsp-1', consignmentId: 'CONS-1', trackingCode: null }]
            : [fullRow],
        ),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
    };
    const dispatchCancel: any = {
      evaluateOrder: jest
        .fn()
        .mockResolvedValue({ blockedReason: null, dispatches: [] }),
    };
    const service = new DispatchService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      dispatchCancel,
    );
    return { service, prisma, dispatchCancel };
  };

  it('syncs the live dispatches first, then reports FRESH eligibility', async () => {
    const { service } = makeService();
    const sync = jest
      .spyOn(service, 'syncStatusFromCourier')
      .mockResolvedValue({
        total: 1,
        synced: [{ id: 'dsp-1' }],
        unchanged: [],
        failed: [],
      } as any);

    const preview = await service.getCancelPreview('order-1');

    expect(sync).toHaveBeenCalledWith(['dsp-1']);
    expect(preview.verificationAttempted).toBe(true);
    expect(preview.verificationFailed).toBe(false);
    expect(preview.blockedReason).toBeNull();
    // PICKUP_FAILED + no pickup timestamps → cancellable on the fresh rows.
    expect(preview.dispatches).toHaveLength(1);
    expect(preview.dispatches[0].cancelEligibility.eligible).toBe(true);
  });

  it('a failed courier sync sets verificationFailed (decision falls back to local status)', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'syncStatusFromCourier').mockResolvedValue({
      total: 1,
      synced: [],
      unchanged: [],
      failed: [{ id: 'dsp-1', reason: 'Courier is not configured' }],
    } as any);

    const preview = await service.getCancelPreview('order-1');

    expect(preview.verificationAttempted).toBe(true);
    expect(preview.verificationFailed).toBe(true);
    // The local (fresh-read) eligibility is still reported.
    expect(preview.dispatches[0].cancelEligibility.eligible).toBe(true);
  });

  it('a dispatch without any courier reference is not synced', async () => {
    const { service, prisma } = makeService();
    prisma.dispatch.findMany.mockImplementation(async (args: any) =>
      args?.select
        ? [{ id: 'dsp-1', consignmentId: null, trackingCode: null }]
        : [fullRow],
    );
    const sync = jest.spyOn(service, 'syncStatusFromCourier');

    const preview = await service.getCancelPreview('order-1');

    expect(sync).not.toHaveBeenCalled();
    expect(preview.verificationAttempted).toBe(false);
    expect(preview.verificationFailed).toBe(false);
  });

  it('reports the outstanding balance and per-payment refundable remainders', async () => {
    const { service, prisma } = makeService();
    jest
      .spyOn(service, 'syncStatusFromCourier')
      .mockResolvedValue({ total: 1, synced: [], unchanged: [], failed: [] } as any);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 500 } });
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'pay-1',
        gatewayCode: 'bkash_manual',
        account: 'bKash (Manual)',
        accountId: 'acc-1',
        amount: 500,
        createdAt: new Date(),
      },
    ]);
    prisma.refund.aggregate.mockImplementation(async (args: any) =>
      args?.where?.sourcePaymentId === 'pay-1'
        ? { _sum: { amount: 200 } }
        : { _sum: { amount: 0 } },
    );

    const preview = await service.getCancelPreview('order-1');

    expect(preview.outstanding).toBe(500);
    expect(preview.payments).toHaveLength(1);
    expect(preview.payments[0]).toMatchObject({
      id: 'pay-1',
      amount: 500,
      refunded: 200,
      refundable: 300,
    });
  });

  it('404s for a missing order', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(service.getCancelPreview('nope')).rejects.toThrow(
      /Order not found/,
    );
  });
});
