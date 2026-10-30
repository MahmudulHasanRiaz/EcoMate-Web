import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'dsp-1',
          orderId: 'order-1',
          courier: 'steadfast',
          status: 'CANCELLED',
          courierCancelMode: 'MANUAL',
          courierCancelRef: 'SF-1',
          panelCancelConfirmedAt: null,
          panelCancelConfirmedBy: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
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

  it('a PICKUP_FAILED dispatch: NO courier call — the booking is already dead (owner ruling 2026-10-30)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({
        courier: 'pathao',
        status: 'PICKUP_FAILED',
        courierStatus: 'order.pickup-failed',
      }),
    ]);

    const plan = await service.prepare('order-1', 'staff@ecomate.com');

    expect(courierCancel).not.toHaveBeenCalled();
    expect(plan.blockedReason).toBeNull();
    expect(plan.outcomes).toHaveLength(1);
    expect(plan.outcomes[0]).toMatchObject({
      dispatchId: 'dsp-1',
      courier: 'pathao',
      reference: 'CONS-1',
      mode: 'MANUAL',
    });
    expect((plan.outcomes[0].response as any)?.pickupFailed).toBe(true);
  });

  it('apply() on a pickup-failed outcome auto-confirms: no panel cancellation is owed', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({
        courier: 'pathao',
        status: 'PICKUP_FAILED',
        courierStatus: 'order.pickup-failed',
      }),
    ]);
    const plan = await service.prepare('order-1', 'staff@ecomate.com');
    const tx = makeTx();

    await service.apply(tx as any, plan, 'staff@ecomate.com');

    expect(tx.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dsp-1' }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          courierCancelMode: 'MANUAL',
          panelCancelConfirmedAt: expect.any(Date),
          panelCancelConfirmedBy: 'staff@ecomate.com',
        }),
      }),
    );
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

  it('Pathao is cancelled through its cancel endpoint (like Carrybee/RedX)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ courier: 'pathao', consignmentId: 'PATHAO-9' }),
    ]);

    const plan = await service.prepare('order-1', 'staff@ecomate.com');

    expect(courierCancel).toHaveBeenCalledWith(
      'pathao',
      'PATHAO-9',
      expect.stringContaining('staff@ecomate.com'),
    );
    expect(plan.outcomes[0]).toMatchObject({
      courier: 'pathao',
      reference: 'PATHAO-9',
      mode: 'API',
    });
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

  it('Steadfast proceeds in MANUAL mode: no courier call, the booking is still owed', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ courier: 'steadfast', consignmentId: 'SF-1' }),
    ]);

    const plan = await service.prepare('order-1', 'staff@ecomate.com');

    expect(courierCancel).not.toHaveBeenCalled();
    expect(plan.outcomes[0]).toMatchObject({
      courier: 'steadfast',
      reference: 'SF-1',
      mode: 'MANUAL',
    });
    expect(plan.outcomes[0].response).toMatchObject({ manual: true });
  });

  it('Steadfast apply() stores MANUAL mode and leaves the panel marker PENDING', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({ courier: 'steadfast', consignmentId: 'SF-1' }),
    ]);
    const plan = await service.prepare('order-1', 'staff@ecomate.com');
    const tx = makeTx();

    await service.apply(tx as any, plan, 'staff@ecomate.com');

    const data = tx.dispatch.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'CANCELLED',
      courierCancelMode: 'MANUAL',
      courierCancelRef: 'SF-1',
      courierCancelAt: expect.any(Date),
    });
    // The marker is cleared ONLY by the explicit confirmation.
    expect(data).not.toHaveProperty('panelCancelConfirmedAt');

    const timeline = JSON.parse(tx.$executeRaw.mock.calls[0][1] as string);
    expect(timeline[0].note).toMatch(/still active/i);
    expect(timeline[0].note).toMatch(/MUST be cancelled in the Steadfast panel/i);
    expect(timeline[0]).toMatchObject({
      panelCancelPending: true,
      panelCancelOwedBy: 'staff@ecomate.com',
      courierCancelMode: 'MANUAL',
    });
    expect(timeline[0].panelCancelOwedAt).toBeTruthy();
  });

  it('a picked-up Steadfast dispatch is still BLOCKED (manual fallback does not bypass pickup)', async () => {
    prisma.dispatch.findMany.mockResolvedValue([
      dispatch({
        courier: 'steadfast',
        status: 'PICKED_UP',
        pickedUpAt: new Date('2026-10-20T10:00:00Z'),
      }),
    ]);

    await expect(
      service.prepare('order-1', 'staff@ecomate.com'),
    ).rejects.toThrow(/already picked up/i);
    expect(courierCancel).not.toHaveBeenCalled();
  });

  it('confirmManualPanelCancel clears the marker and records the actor + timestamp', async () => {
    const result = await service.confirmManualPanelCancel(
      'dsp-1',
      'staff@ecomate.com',
    );

    expect(result).toMatchObject({ id: 'dsp-1' });
    expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'dsp-1',
          courierCancelMode: 'MANUAL',
          panelCancelConfirmedAt: null,
        }),
        data: expect.objectContaining({
          panelCancelConfirmedAt: expect.any(Date),
          panelCancelConfirmedBy: 'staff@ecomate.com',
        }),
      }),
    );
    const timeline = JSON.parse(prisma.$executeRaw.mock.calls[0][1] as string);
    expect(timeline[0]).toMatchObject({
      type: 'dispatch.panel-cancel-confirmed',
      performedBy: 'staff@ecomate.com',
      courierReference: 'SF-1',
      panelCancelPending: false,
    });
    expect(timeline[0].note).toMatch(/confirmed by staff@ecomate.com/i);
  });

  it('the marker cannot be cleared twice', async () => {
    prisma.dispatch.findUnique.mockResolvedValue({
      id: 'dsp-1',
      orderId: 'order-1',
      courier: 'steadfast',
      status: 'CANCELLED',
      courierCancelMode: 'MANUAL',
      courierCancelRef: 'SF-1',
      panelCancelConfirmedAt: new Date(),
      panelCancelConfirmedBy: 'other@ecomate.com',
    });

    await expect(
      service.confirmManualPanelCancel('dsp-1', 'staff@ecomate.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.dispatch.updateMany).not.toHaveBeenCalled();
  });

  it('a dispatch without a MANUAL panel step cannot be confirmed', async () => {
    prisma.dispatch.findUnique.mockResolvedValue({
      id: 'dsp-1',
      orderId: 'order-1',
      courier: 'carrybee',
      status: 'CANCELLED',
      courierCancelMode: 'API',
      courierCancelRef: 'CONS-1',
      panelCancelConfirmedAt: null,
      panelCancelConfirmedBy: null,
    });

    await expect(
      service.confirmManualPanelCancel('dsp-1', 'staff@ecomate.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a lost confirmation race (CAS count 0) reports a conflict', async () => {
    prisma.dispatch.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.confirmManualPanelCancel('dsp-1', 'staff@ecomate.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
