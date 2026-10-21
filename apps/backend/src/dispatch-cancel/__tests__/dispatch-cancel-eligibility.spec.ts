import {
  COURIER_CANCEL_CAPABILITY,
  PRE_PICKUP_COURIER_STATUSES,
  PRE_PICKUP_DISPATCH_STATUSES,
  evaluateDispatchCancelEligibility,
} from '../dispatch-cancel-eligibility';

/**
 * Cancel a DISPATCHED order — the eligibility rules (owner directive,
 * 2026-10-21).
 *
 * The parcel must still be with us (the internal status must be pre-pickup
 * and no pickup/handover timestamp may be set) AND the courier must have a
 * cancel API we can push to.
 */
describe('dispatch cancel eligibility', () => {
  it('treats DISPATCHED and PICKUP_FAILED as pre-pickup', () => {
    expect(PRE_PICKUP_DISPATCH_STATUSES).toContain('DISPATCHED');
    expect(PRE_PICKUP_DISPATCH_STATUSES).toContain('PICKUP_FAILED');
  });

  it('a fresh Carrybee dispatch (DISPATCHED) is cancellable', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'carrybee',
      status: 'DISPATCHED',
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.needsCourierPanel).toBe(false);
  });

  it('a fresh RedX dispatch (DISPATCHED) is cancellable', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'redx',
      status: 'DISPATCHED',
    });
    expect(result.eligible).toBe(true);
  });

  it('a PICKUP_FAILED dispatch is still cancellable (the parcel never left)', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'carrybee',
      status: 'PICKUP_FAILED',
    });
    expect(result.eligible).toBe(true);
  });

  it.each([
    'HANDED_OVER',
    'PICKED_UP',
    'IN_TRANSIT',
    'ASSIGNED_TO_RIDER',
    'ASSIGNED_TO_HUB',
    'HOLD',
    'DELIVERED',
    'PARTIAL',
    'RETURN_PENDING',
    'RETURNED',
  ])('a %s dispatch is too late to cancel', (status) => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'carrybee',
      status: status as never,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already picked up/i);
    expect(result.blockingStatus).toBe(status);
  });

  it('blocks a dispatch whose pickedUpAt timestamp is set (the status can lag)', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'carrybee',
      status: 'DISPATCHED',
      pickedUpAt: new Date('2026-10-20T09:00:00Z'),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already picked up/i);
    expect(result.collectedAt).toEqual(new Date('2026-10-20T09:00:00Z'));
  });

  it('blocks a dispatch whose handedOverAt timestamp is set', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'redx',
      status: 'DISPATCHED',
      handedOverAt: new Date('2026-10-19T09:00:00Z'),
    });
    expect(result.eligible).toBe(false);
  });

  it('blocks Pathao/Steadfast: no cancel API — staff must use the courier panel', () => {
    for (const courier of ['pathao', 'steadfast']) {
      const result = evaluateDispatchCancelEligibility({
        courier,
        status: 'DISPATCHED',
      });
      expect(result.eligible).toBe(false);
      expect(result.needsCourierPanel).toBe(true);
      expect(result.reason).toMatch(/panel first/i);
    }
  });

  it('Carrybee/RedX can cancel from here', () => {
    expect(COURIER_CANCEL_CAPABILITY.carrybee.canCancel).toBe(true);
    expect(COURIER_CANCEL_CAPABILITY.carrybee.method).toBe('carrybee');
    expect(COURIER_CANCEL_CAPABILITY.redx.canCancel).toBe(true);
    expect(COURIER_CANCEL_CAPABILITY.redx.method).toBe('redx');
    expect(COURIER_CANCEL_CAPABILITY.pathao.canCancel).toBe(false);
    expect(COURIER_CANCEL_CAPABILITY.steadfast.canCancel).toBe(false);
  });

  it('an unknown courier is treated as "no cancel API" (fail closed)', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'mystery',
      status: 'DISPATCHED',
    });
    expect(result.eligible).toBe(false);
    expect(result.needsCourierPanel).toBe(true);
  });

  it('the per-courier sheet lists the pre-pickup raw statuses for every courier', () => {
    expect(Object.keys(PRE_PICKUP_COURIER_STATUSES).sort()).toEqual([
      'carrybee',
      'pathao',
      'redx',
      'steadfast',
    ]);
    expect(PRE_PICKUP_COURIER_STATUSES.pathao.eligible).toContain(
      'order.created',
    );
    expect(PRE_PICKUP_COURIER_STATUSES.steadfast.eligible).toContain(
      'in_review',
    );
    expect(PRE_PICKUP_COURIER_STATUSES.redx.eligible).toContain(
      'pickup-pending',
    );
    expect(PRE_PICKUP_COURIER_STATUSES.carrybee.eligible).toContain(
      'order.created',
    );
    // The ineligible lists must never contain an eligible label.
    for (const sheet of Object.values(PRE_PICKUP_COURIER_STATUSES)) {
      for (const label of sheet.eligible) {
        expect(sheet.ineligible).not.toContain(label);
      }
    }
  });
});
