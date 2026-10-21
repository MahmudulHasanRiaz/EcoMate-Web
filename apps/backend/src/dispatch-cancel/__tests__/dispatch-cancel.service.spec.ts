import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { DispatchCancelService } from '../dispatch-cancel.service';

/**
 * Cancel a DISPATCHED order (owner directive, 2026-10-21).
 *
 * The rules:
 *  - the parcel must still be with us (pre-pickup) AND the courier must have
 *    a cancel API we can push to;
 *  - the courier cancel happens FIRST — a courier failure aborts everything
 *    (no half-cancelled state);
 *  - ALL live dispatches must be eligible — one blocker stops the whole cancel.
 */
describe('DispatchCancelService', () => {
  let service: DispatchCancelService;
  let prisma: any;
  let courierCancel: jest.Mock;

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

  const makeTx = () => ({
    dispatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  });

  beforeEach(() => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([dispatch()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new DispatchCancelService(prisma);
    courierCancel = jest
      .spyOn(service as any, 'callCourierCancel')
      .mockResolvedValue({ success: true, reference: 'CONS-1' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('an eligible dispatch: the courier cancel is pushed and the plan is returned', async () => {
    const plan = await service.prepare('order-1', 'staff@ecomate.com');

    expect(courierCancel).toHaveBeenCalledWith(
      'carrybee',
      'CONS-1',
      expect.stringContaining('staff@ecomate.com'),
    );
    expect(plan.outcomes).toHaveLength(1);
    expect(plan.outcomes[0]).toMatchObject({
      dispatchId: 'dsp-1',
      courier: 'carrybee',
      reference: 'CONS-1',
    });
    expect(plan.blockedReason).toBeNull();
  });

  it('apply() marks the dispatch cancelled and records the courier reference', async () => {
    const plan = await service.prepare('order-1', 'staff@ecomate.com');
    const tx = makeTx();

    await service.apply(tx as any, plan, 'staff@ecomate.com');

    expect(tx.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dsp-1' }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          courierCancelRef: 'CONS-1',
          courierCancelAt: expect.any(Date),
        }),
      }),
    );
    // The audit entry: who cancelled, the courier, the reference.
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('a picked-up dispatch is BLOCKED server-side and no courier call is made', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ status: 'PICKED_UP', pickedUpAt: new Date('2026-10-20T10:00:00Z') }),
    ]);

    await expect(service.prepare('order-1', 'staff@ecomate.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('a courier without a cancel API is BLOCKED with the panel guidance', async () => {
    prisma.dispatch.findMany.mockResolvedValue([dispatch({ courier: 'pathao' })]);

    await expect(
      service.prepare('order-1', 'staff@ecomate.com'),
    ).rejects.toThrow(/Pathao panel first/i);
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('a failing courier cancel aborts everything (nothing is written)', async () => {
    courierCancel.mockRejectedValue(new Error('courier says no'));

    await expect(
      service.prepare('order-1', 'staff@ecomate.com'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Nothing was written: the service never touches the DB in prepare().
    expect(prisma.dispatch.updateMany).not.toHaveBeenCalled();
  });

  it('multiple dispatches with ONE ineligible dispatch blocks the whole cancel', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ id: 'dsp-1', courier: 'carrybee' }),
      dispatch({ id: 'dsp-2', courier: 'redx', status: 'IN_TRANSIT' }),
    ]);

    await expect(
      service.prepare('order-1', 'staff@ecomate.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // No courier call at all — the plan is refused before anything is pushed.
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('multiple eligible dispatches push a cancel for EVERY dispatch', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ id: 'dsp-1', courier: 'carrybee', consignmentId: 'CONS-1' }),
      dispatch({ id: 'dsp-2', courier: 'redx', consignmentId: 'CONS-2' }),
    ]);

    const plan = await service.prepare('order-1', 'staff@ecomate.com');

    expect(courierCancel).toHaveBeenCalledTimes(2);
    expect(plan.outcomes.map((o) => o.dispatchId)).toEqual(['dsp-1', 'dsp-2']);
  });

  it('an order without a dispatch needs no courier call (the flow is untouched)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([]);

    const plan = await service.prepare('order-1', 'staff@ecomate.com');

    expect(plan.dispatches).toHaveLength(0);
    expect(plan.outcomes).toHaveLength(0);
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('a cancelled dispatch is not part of the cancel (it is done)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([]);

    const plan = await service.evaluateOrder('order-1');

    expect(plan.dispatches).toHaveLength(0);
    expect(plan.blockedReason).toBeNull();
  });

  it('a dispatch without a consignment/tracking id cannot be cancelled', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ consignmentId: null, trackingCode: null }),
    ]);

    await expect(
      service.prepare('order-1', 'staff@ecomate.com'),
    ).rejects.toThrow(/no consignment\/tracking id/i);
  });
});
