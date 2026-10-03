import { NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Public order tracking (display-id / phone lookup).
 *
 * These endpoints are reachable by anyone who knows an order number, so the
 * DTO is deliberately narrow. The storefront tracking page renders timeline,
 * shipment and the delivery area — this suite exists because the select
 * silently omitted all three, so the page rendered an empty rail and a
 * permanent "No shipping address available" while the order really did have
 * that data.
 */
describe('OrdersService public tracking DTO', () => {
  let service: OrdersService;
  let prisma: { order: { findFirst: jest.Mock; findMany: jest.Mock } };

  // Instantiated without the constructor: only prisma is exercised here, and
  // wiring the full dependency graph would make these assertions depend on
  // unrelated services.
  beforeEach(() => {
    prisma = { order: { findFirst: jest.fn(), findMany: jest.fn() } };
    service = new (OrdersService as any)(prisma as unknown as PrismaService);
  });

  const baseOrder = (overrides: Record<string, any> = {}) => ({
    id: 'order-1',
    displayId: 'ORD-260101-0001',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    total: 2500,
    courierService: null,
    courierTrackingCode: null,
    courierConsignmentId: null,
    dispatches: [],
    status: { name: 'Shipped', color: '#2ecc71' },
    shippingAddress: null,
    timeline: [],
    items: [],
    ...overrides,
  });

  const findOne = (order: any) => {
    prisma.order.findFirst.mockResolvedValue(order);
    return service.findByDisplayId(order.displayId);
  };

  describe('timeline', () => {
    it('returns timeline steps the storefront can render', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [
            { status: 'Pending', timestamp: '2026-01-01T10:00:00.000Z' },
            { status: 'Shipped', timestamp: '2026-01-02T12:30:00.000Z' },
          ],
        }),
      );

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].status).toBe('Pending');
      expect(result.timeline[1].status).toBe('Shipped');
    });

    it('orders steps oldest first so the newest renders last', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [
            { status: 'Shipped', timestamp: '2026-01-03T09:00:00.000Z' },
            { status: 'Pending', timestamp: '2026-01-01T10:00:00.000Z' },
            { status: 'Confirmed', timestamp: '2026-01-02T11:00:00.000Z' },
          ],
        }),
      );

      expect(result.timeline.map((t) => t.status)).toEqual([
        'Pending',
        'Confirmed',
        'Shipped',
      ]);
    });

    it('strips performedBy — a staff email must never reach a public endpoint', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [
            {
              status: 'Confirmed',
              timestamp: '2026-01-01T10:00:00.000Z',
              note: 'Confirmed by phone',
              performedBy: 'staff@ecomate.com',
            },
          ],
        }),
      );

      expect(result.timeline[0].note).toBe('Confirmed by phone');
      expect(result.timeline[0]).not.toHaveProperty('performedBy');
      expect(JSON.stringify(result)).not.toContain('staff@ecomate.com');
    });

    it('excludes entries a staff member marked private', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [
            { status: 'Pending', timestamp: '2026-01-01T10:00:00.000Z' },
            {
              status: 'Internal review',
              timestamp: '2026-01-01T11:00:00.000Z',
              visibility: 'private',
              note: 'Address was wrong, calling back',
            },
            {
              status: 'Confirmed',
              timestamp: '2026-01-01T12:00:00.000Z',
              visibility: 'public',
            },
          ],
        }),
      );

      expect(result.timeline.map((t) => t.status)).toEqual(['Pending', 'Confirmed']);
      expect(JSON.stringify(result)).not.toContain('Address was wrong');
    });

    it('drops internal value-change fields', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [
            {
              status: 'Updated',
              timestamp: '2026-01-01T10:00:00.000Z',
              visibility: 'public',
              oldValue: 100,
              newValue: 120,
              note: 'Shipping: ৳100 → ৳120',
            },
          ],
        }),
      );

      expect(result.timeline[0]).not.toHaveProperty('oldValue');
      expect(result.timeline[0]).not.toHaveProperty('newValue');
    });

    it('returns an empty array for a missing or malformed column', async () => {
      await expect(findOne(baseOrder({ timeline: null }))).resolves.toMatchObject({
        timeline: [],
      });
      await expect(findOne(baseOrder({ timeline: 'nonsense' }))).resolves.toMatchObject({
        timeline: [],
      });
      await expect(findOne(baseOrder({ timeline: undefined }))).resolves.toMatchObject({
        timeline: [],
      });
    });

    it('ignores rows with neither a status nor a note', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [
            { status: 'Pending', timestamp: '2026-01-01T10:00:00.000Z' },
            { timestamp: '2026-01-02T10:00:00.000Z' },
            null,
          ],
        }),
      );

      expect(result.timeline).toHaveLength(1);
    });

    it('normalises a Date timestamp to an ISO string', async () => {
      const result = await findOne(
        baseOrder({
          timeline: [{ status: 'Pending', timestamp: new Date('2026-01-01T10:00:00.000Z') }],
        }),
      );

      expect(result.timeline[0].timestamp).toBe('2026-01-01T10:00:00.000Z');
    });
  });

  describe('shipment', () => {
    it('exposes the courier and tracking code', async () => {
      const result = await findOne(
        baseOrder({
          courierService: 'steadfast',
          courierTrackingCode: 'STD-88213',
          courierConsignmentId: 'CONS-99',
        }),
      );

      expect(result.shipment).toEqual({
        courier: 'steadfast',
        trackingCode: 'STD-88213',
      });
    });

    it('is null when no courier is assigned', async () => {
      const result = await findOne(baseOrder());
      expect(result.shipment).toBeNull();
    });
  });

  describe('delivery area', () => {
    it('returns city and district', async () => {
      const result = await findOne(
        baseOrder({
          shippingAddress: {
            name: 'Rahim Uddin',
            phone: '01700000000',
            address: 'House 42, Road 7, Dhanmondi',
            thana: 'Dhanmondi',
            city: 'Dhaka',
            district: 'Dhaka',
          },
        }),
      );

      expect(result.shippingAddress).toEqual({ city: 'Dhaka', district: 'Dhaka' });
    });

    it('never leaks the street address, recipient name or phone', async () => {
      const result = await findOne(
        baseOrder({
          shippingAddress: {
            name: 'Rahim Uddin',
            phone: '01700000000',
            address: 'House 42, Road 7, Dhanmondi',
            city: 'Dhaka',
            district: 'Dhaka',
          },
        }),
      );

      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain('01700000000');
      expect(serialised).not.toContain('Dhanmondi');
      expect(serialised).not.toContain('Rahim');
      expect(result.shippingAddress).not.toHaveProperty('phone');
      expect(result.shippingAddress).not.toHaveProperty('address');
      expect(result.shippingAddress).not.toHaveProperty('name');
    });

    it('is null when no address was recorded', async () => {
      const result = await findOne(baseOrder({ shippingAddress: null }));
      expect(result.shippingAddress).toBeNull();
    });
  });

  it('still throws NotFound for an unknown order number', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.findByDisplayId('NOPE-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('applies the same timeline redaction on the phone lookup', async () => {
    prisma.order.findMany.mockResolvedValue([
      baseOrder({
        timeline: [
          { status: 'Pending', timestamp: '2026-01-01T10:00:00.000Z' },
          {
            status: 'Internal',
            timestamp: '2026-01-01T11:00:00.000Z',
            visibility: 'private',
            note: 'customer is a VIP, call them',
          },
        ],
      }),
    ]);

    const [result] = await service.findByPhone('01700000000');
    expect(result.timeline.map((t) => t.status)).toEqual(['Pending']);
    expect(JSON.stringify(result)).not.toContain('VIP');
  });
});