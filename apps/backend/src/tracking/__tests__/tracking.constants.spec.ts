import {
  TRACKING_EVENT_TYPES,
  ORDER_LIFECYCLE_EVENT_TYPES,
  OUTBOX_STATUS,
  DISPATCH_STATUS,
  SUCCESS_POLICIES,
  SCHEMA_VERSION,
} from '../tracking.constants';

describe('tracking.constants', () => {
  it('exposes the canonical event types (PageView excluded by design)', () => {
    expect(TRACKING_EVENT_TYPES).toEqual([
      'Purchase',
      'Refund',
      'AddToCart',
      'AddToWishlist',
      'InitiateCheckout',
      'AddPaymentInfo',
      'ViewContent',
      'Search',
      'CompleteRegistration',
      'Lead',
      // Server-side order-lifecycle custom events (Meta-only routing at the
      // adapter boundary).
      'OrderPlaced',
      'OrderConfirmed',
      'OrderCancelled',
      'OrderDelivered',
      'OrderReturned',
    ]);
  });

  it('exposes the order-lifecycle subset for adapter-boundary routing', () => {
    expect(ORDER_LIFECYCLE_EVENT_TYPES).toEqual([
      'OrderPlaced',
      'OrderConfirmed',
      'OrderCancelled',
      'OrderDelivered',
      'OrderReturned',
    ]);
    for (const t of ORDER_LIFECYCLE_EVENT_TYPES) {
      expect(TRACKING_EVENT_TYPES).toContain(t);
    }
  });

  it('exposes the outbox status machine', () => {
    expect(OUTBOX_STATUS).toEqual(['PENDING', 'CLAIMED', 'SENT', 'FAILED', 'DEAD']);
  });

  it('exposes the dispatch status machine', () => {
    expect(DISPATCH_STATUS).toEqual([
      'PENDING',
      'SENDING',
      'SENT',
      'RETRY',
      'FAILED',
      'DEDUPED',
      'SKIPPED',
      'DEAD',
    ]);
  });

  it('exposes success policies and schema version', () => {
    expect(SUCCESS_POLICIES).toEqual(['ALL_SENT', 'ANY_SENT', 'N_SENT']);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('freezes all exported arrays', () => {
    expect(Object.isFrozen(TRACKING_EVENT_TYPES)).toBe(true);
    expect(Object.isFrozen(OUTBOX_STATUS)).toBe(true);
    expect(Object.isFrozen(DISPATCH_STATUS)).toBe(true);
    expect(Object.isFrozen(SUCCESS_POLICIES)).toBe(true);
  });
});
