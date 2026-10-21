import {
  COURIER_CANCEL_CAPABILITY,
  PRE_PICKUP_COURIER_STATUSES,
  PRE_PICKUP_DISPATCH_STATUSES,
  evaluateDispatchCancelEligibility,
  isPanelCancelPending,
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

  it('Pathao has a cancel API — a pre-pickup dispatch is eligible', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'pathao',
      status: 'DISPATCHED',
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.manualPanelCancel).toBe(false);
    expect(result.needsCourierPanel).toBe(false);
  });

  it('Steadfast has NO cancel API — the cancel proceeds in MANUAL mode with a panel warning', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'steadfast',
      status: 'DISPATCHED',
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.manualPanelCancel).toBe(true);
    expect(result.needsCourierPanel).toBe(true);
    expect(result.warning).toMatch(/MUST also cancel the booking in the Steadfast panel/i);
  });

  it('Steadfast is still BLOCKED after pickup (the manual fallback never bypasses it)', () => {
    const result = evaluateDispatchCancelEligibility({
      courier: 'steadfast',
      status: 'PICKED_UP',
      pickedUpAt: new Date('2026-10-20T09:00:00Z'),
    });
    expect(result.eligible).toBe(false);
    expect(result.manualPanelCancel).toBe(false);
    expect(result.reason).toMatch(/already picked up/i);
  });

  it('Carrybee/RedX/Pathao can cancel from here; Steadfast is manual', () => {
    expect(COURIER_CANCEL_CAPABILITY.carrybee.canCancel).toBe(true);
    expect(COURIER_CANCEL_CAPABILITY.carrybee.method).toBe('carrybee');
    expect(COURIER_CANCEL_CAPABILITY.redx.canCancel).toBe(true);
    expect(COURIER_CANCEL_CAPABILITY.redx.method).toBe('redx');
    expect(COURIER_CANCEL_CAPABILITY.pathao.canCancel).toBe(true);
    expect(COURIER_CANCEL_CAPABILITY.pathao.method).toBe('pathao');
    expect(COURIER_CANCEL_CAPABILITY.steadfast.canCancel).toBe(false);
    expect(COURIER_CANCEL_CAPABILITY.steadfast.manualFallback).toBe(true);
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

  it('the panel-cancellation marker is pending only for an unconfirmed MANUAL cancel with a booking', () => {
    const base = {
      status: 'CANCELLED',
      courierCancelMode: 'MANUAL',
      courierCancelRef: 'SF-1',
      panelCancelConfirmedAt: null,
    };
    expect(isPanelCancelPending(base)).toBe(true);
    expect(
      isPanelCancelPending({ ...base, panelCancelConfirmedAt: new Date() }),
    ).toBe(false);
    expect(isPanelCancelPending({ ...base, courierCancelMode: 'API' })).toBe(
      false,
    );
    expect(isPanelCancelPending({ ...base, courierCancelRef: null })).toBe(
      false,
    );
    expect(isPanelCancelPending({ ...base, status: 'DISPATCHED' })).toBe(false);
  });
});
