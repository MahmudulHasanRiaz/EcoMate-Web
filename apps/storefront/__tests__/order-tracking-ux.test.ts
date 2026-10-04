import { describe, expect, it } from 'vitest';
import {
  determineActiveStageIndex,
  maskPhone,
  resolveCustomerInfo,
  resolveFullAddress,
  resolveTerminalState,
  isStageInTimeline,
  JOURNEY_STAGES
} from '../app/(main)/orders/page';

// These tests mirror the public tracking DTO (`PublicDisplayOrder` in
// orders.service.ts) on purpose. That DTO is deliberately no-PII: it
// carries only city/district from shippingAddress and no customer phone
// at all, so helpers must degrade gracefully instead of inventing data.

describe('Public Order Tracking Page — UX helpers', () => {
  describe('maskPhone', () => {
    it('masks Bangladeshi numbers as 018***5678 format', () => {
      expect(maskPhone('01812345678')).toBe('018***5678');
      expect(maskPhone('+8801812345678')).toBe('018***5678');
      expect(maskPhone('8801796622620')).toBe('017***2620');
      expect(maskPhone('01601701567')).toBe('016***1567');
    });

    it('returns empty string for null/undefined/empty', () => {
      expect(maskPhone('')).toBe('');
      expect(maskPhone(null)).toBe('');
      expect(maskPhone(undefined)).toBe('');
    });
  });

  describe('resolveCustomerInfo', () => {
    it('extracts and masks customer name and phone when present', () => {
      const order: any = {
        customerFirstName: 'Rahim',
        customerLastName: 'Ahmed',
        customerPhone: '+8801712345678',
      };
      const info = resolveCustomerInfo(order);
      expect(info.name).toBe('Rahim Ahmed');
      expect(info.phone).toBe('017***5678');
    });

    it('falls back to guestName and guestPhone', () => {
      const order: any = {
        guestName: 'Tanvir Hossain',
        guestPhone: '01912345678',
      };
      const info = resolveCustomerInfo(order);
      expect(info.name).toBe('Tanvir Hossain');
      expect(info.phone).toBe('019***5678');
    });

    // The public DTO carries no phone, so the helper must return an empty
    // string rather than a hardcoded number that belongs to a real business.
    it('never fabricates a phone number when none is on the order', () => {
      const info = resolveCustomerInfo({} as any);
      expect(info.name).toBe('Customer');
      expect(info.phone).toBe('');
    });

    it('returns an empty phone for the real public DTO shape', () => {
      const order: any = {
        displayId: 'ORD-261001-0015',
        status: { name: 'Shipping' },
        shippingAddress: { city: 'Dhaka', district: 'Dhaka' },
      };
      const info = resolveCustomerInfo(order);
      expect(info.phone).toBe('');
      expect(info.name).toBe('Customer');
    });
  });

  describe('resolveFullAddress', () => {
    it('shows the city carried by the public DTO', () => {
      const order: any = {
        shippingAddress: { city: 'Dhaka', district: 'Dhaka' },
      };
      expect(resolveFullAddress(order)).toBe('Dhaka');
    });

    it('falls back to district when city is absent', () => {
      const order: any = { shippingAddress: { district: 'Chattogram' } };
      expect(resolveFullAddress(order)).toBe('Chattogram');
    });

    it('reports unavailable when the DTO carries no location', () => {
      expect(resolveFullAddress({} as any)).toBe('Address not available');
      expect(resolveFullAddress({ shippingAddress: null } as any)).toBe('Address not available');
    });

    // The street address never leaves the backend for public lookups. If a
    // future change ever leaked it into this page, this test should fail.
    it('never renders street-level address fields', () => {
      const order: any = {
        shippingAddress: {
          addressLine: 'House 12, Road 4',
          area: 'Dhanmondi',
          city: 'Dhaka',
          postalCode: '1209',
          phone: '+8801712345678',
        },
      };
      expect(resolveFullAddress(order)).toBe('Dhaka');
    });
  });

  describe('resolveTerminalState', () => {
    it('flags statuses that end the journey early', () => {
      expect(resolveTerminalState('Cancelled')).toBe('Order Cancelled');
      expect(resolveTerminalState('Returned')).toBe('Order Returned');
      expect(resolveTerminalState('Damaged')).toBe('Order Damaged');
    });

    it('returns null for normal in-progress and delivered statuses', () => {
      expect(resolveTerminalState('Pending')).toBeNull();
      expect(resolveTerminalState('Shipping')).toBeNull();
      expect(resolveTerminalState('Delivered')).toBeNull();
      expect(resolveTerminalState('')).toBeNull();
    });
  });

  describe('determineActiveStageIndex & JOURNEY_STAGES', () => {
    // The five stages mirror the statuses that actually exist in the
    // database (Pending, Confirmed, Packed, Shipping, Delivered). A stage
    // that no status can ever reach would render permanently hollow.
    it('has the 5 real canonical stages in order', () => {
      expect(JOURNEY_STAGES).toHaveLength(5);
      expect(JOURNEY_STAGES.map((s) => s.key)).toEqual([
        'placed',
        'confirmed',
        'packed',
        'shipping',
        'delivered'
      ]);
    });

    it('maps every real order status to a valid stage index', () => {
      const statuses = [
        'Pending',
        'Payment Pending',
        'Payment Verifying',
        'Hold',
        'Confirmed',
        'Packed',
        'Packing Hold',
        'Shipping',
        'Delivered',
        'Partial',
        'Return Pending'
      ];
      for (const status of statuses) {
        const idx = determineActiveStageIndex(status);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(JOURNEY_STAGES.length);
      }
    });

    it('maps internal order statuses to the proper stage index', () => {
      expect(determineActiveStageIndex('Pending')).toBe(0);
      expect(determineActiveStageIndex('Hold')).toBe(0);
      expect(determineActiveStageIndex('Confirmed')).toBe(1);
      expect(determineActiveStageIndex('Packed')).toBe(2);
      expect(determineActiveStageIndex('Shipping')).toBe(3);
      expect(determineActiveStageIndex('In Transit')).toBe(3);
      expect(determineActiveStageIndex('Delivered')).toBe(4);
    });

    // A cancelled order must not report forward progress from a stale
    // timeline entry, which would tell the customer it is still shipping.
    it('never reports forward progress for terminal statuses', () => {
      const timeline: any = [
        { status: 'Pending', timestamp: '2026-10-01T10:00:00.000Z' },
        { status: 'Confirmed', timestamp: '2026-10-01T12:00:00.000Z' },
        { status: 'Shipping', timestamp: '2026-10-02T09:00:00.000Z' },
      ];
      expect(determineActiveStageIndex('Cancelled', timeline)).toBe(0);
      expect(determineActiveStageIndex('Returned', timeline)).toBe(0);
      expect(determineActiveStageIndex('Damaged', timeline)).toBe(0);
    });

    it('correctly detects timeline entries for past stages', () => {
      const timeline: any = [
        { status: 'Pending', timestamp: '2026-10-01T10:00:00.000Z' },
        { status: 'Confirmed', timestamp: '2026-10-01T12:00:00.000Z' },
        { status: 'Packed', timestamp: '2026-10-02T09:00:00.000Z' },
      ];

      expect(isStageInTimeline('placed', timeline).reached).toBe(true);
      expect(isStageInTimeline('confirmed', timeline).reached).toBe(true);
      expect(isStageInTimeline('packed', timeline).reached).toBe(true);
      expect(isStageInTimeline('shipping', timeline).reached).toBe(false);
      expect(isStageInTimeline('delivered', timeline).reached).toBe(false);
    });
  });
});
