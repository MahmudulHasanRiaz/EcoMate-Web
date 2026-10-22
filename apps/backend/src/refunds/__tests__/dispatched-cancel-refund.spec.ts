import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { RefundsService } from '../refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CancelReturnStockService } from '../../stock/cancel-return-stock.service';
import {
  DispatchCancelService,
  type DispatchCancelPlan,
} from '../../dispatch-cancel/dispatch-cancel.service';

/**
 * Cancel a DISPATCHED order with the refund (owner directive, 2026-10-21).
 *
 * The atomic cancel-with-refund now cancels the dispatch WITH ITS COURIER
 * first: the courier push happens before the transaction, the dispatch rows
 * flip inside it. A picked-up dispatch (or a courier without a cancel API) is
 * refused — the refund + the order cancel never happen. A courier failure
 * leaves everything untouched.
 */
describe('RefundsService — cancel a dispatched order with the refund', () => {
  let service: RefundsService;
  let dispatchCancel: DispatchCancelService;
  let prisma: any;
  let courierCancel: jest.Mock;

  const order = {
    id: 'order-1',
    displayId: 'ORD-261021-0001',
    kind: 'SALE',
    total: 2000,
    timeline: [],
  };

  const dispatch = (over: any = {}) => ({
    id: 'dsp-1',
    courier: 'carrybee',
    status: 'DISPATCHED',
    consignmentId: 'CONS-1',
    trackingCode: null,
    pickedUpAt: null,
    handedOverAt: null,
    deliveredAt: null,
    courierStatus: 'order.created',
    courierStatusAt: null,
    ...over,
  });

  const dto = {
    orderId: 'order-1',
    amount: 2000,
    method: 'bkash',
    reason: 'Customer request',
    cancelToo: true,
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      order: {
        findUnique: jest.fn().mockResolvedValue({ ...order }),
        update: jest.fn().mockResolvedValue({ ...order }),
      },
      orderStatus: {
        findFirst: jest.fn().mockResolvedValue({ id: 'status-cancelled', name: 'Cancelled' }),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'refund-1',
          ...data,
        })),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 2000 } }),
        findFirst: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'pay-neg-1' }),
      },
      dispatch: {
        // The plain-refund gate looks for an ACTIVE dispatch (findFirst); the
        // cancel-with-refund path uses the dispatch-cancel service (findMany).
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'dsp-1', status: 'DISPATCHED' }),
        findMany: jest.fn().mockResolvedValue([dispatch()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        DispatchCancelService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CancelReturnStockService,
          useValue: { releaseForCancellation: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<RefundsService>(RefundsService);
    dispatchCancel = module.get<DispatchCancelService>(DispatchCancelService);
    courierCancel = jest
      .spyOn(dispatchCancel as any, 'callCourierCancel')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => jest.restoreAllMocks());

  it('an eligible dispatch: the courier cancel is pushed, the dispatch and the order are cancelled', async () => {
    await service.create(dto as any, 'staff-1');

    expect(courierCancel).toHaveBeenCalledWith(
      'carrybee',
      'CONS-1',
      expect.stringContaining('staff-1'),
    );
    // The dispatch is cancelled in the same transaction as the refund + the
    // order cancel.
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dsp-1' }),
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    // The order is cancelled.
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({ paymentStatus: 'REFUNDED' }),
      }),
    );
  });

  it('a PICKED-UP dispatch is refused — no refund, no order cancel', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ status: 'PICKED_UP', pickedUpAt: new Date() }),
    ]);

    await expect(service.create(dto as any, 'staff-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('Steadfast (no cancel API) proceeds in MANUAL mode — the refund still happens', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ courier: 'steadfast', consignmentId: 'SF-1' }),
    ]);

    await service.create(dto as any, 'staff-1');

    expect(courierCancel).not.toHaveBeenCalled();
    expect(prisma.refund.create).toHaveBeenCalled();
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          courierCancelMode: 'MANUAL',
          courierCancelRef: 'SF-1',
        }),
      }),
    );
  });

  it('a FAILING courier cancel aborts everything (no refund, no order cancel)', async () => {
    courierCancel.mockRejectedValue(new Error('courier refused'));

    await expect(
      service.create(dto as any, 'staff-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('a plain refund (no cancel) keeps the old rule: a dispatched order is refused', async () => {
    await expect(
      service.create({ ...dto, cancelToo: false } as any, 'staff-1'),
    ).rejects.toThrow(/active dispatch/i);
  });

  it('the plan carries the courier reference for the audit', async () => {
    const plan: DispatchCancelPlan = await dispatchCancel.prepare(
      'order-1',
      'staff-1',
    );
    expect(plan.outcomes[0].reference).toBe('CONS-1');
  });
});
