// Task 5 settle exclusion at the settlement-classification layer.
//
// Owner rule (Steadfast docs): "Anything ending _approval_pending is the
// rider's word, not ours yet. Do not settle your books on it." `exceptional`
// is lost/damaged/off-path — likewise never a settled delivery. The steadfast
// kindMap resolves by exact lowercase match, so these labels must NEVER
// resolve to the settle-eligible DELIVERY kind.
import { resolveRowKind } from '../helpers';
import { getDescriptor } from '../descriptors';

describe('courier settlement — Task 5 settle exclusion (classification)', () => {
  const steadfastKinds = getDescriptor('steadfast').kindMap;

  it('approval-pending delivery statuses never classify as DELIVERY', () => {
    for (const status of [
      'delivered_approval_pending',
      'partial_delivered_approval_pending',
      'cancelled_approval_pending',
      'unknown_approval_pending',
    ]) {
      expect(resolveRowKind(status, steadfastKinds)).not.toBe('DELIVERY');
    }
  });

  it('exceptional never classifies as DELIVERY', () => {
    expect(resolveRowKind('exceptional', steadfastKinds)).not.toBe('DELIVERY');
  });

  it('return-endpoint statuses never classify as DELIVERY', () => {
    for (const status of [
      'cancelled_return_proccessing',
      'cancelled_return_rider_assigned',
      'cancelled_return_received',
      'partial_delivered_return_proccessing',
      'partial_delivered_return_rider_assigned',
      'partial_delivered_return_received',
    ]) {
      expect(resolveRowKind(status, steadfastKinds)).not.toBe('DELIVERY');
    }
  });

  it('confirmed delivered still classifies as DELIVERY (no over-blocking)', () => {
    expect(resolveRowKind('delivered', steadfastKinds)).toBe('DELIVERY');
  });
});
