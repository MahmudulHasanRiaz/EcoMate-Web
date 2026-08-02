import { DeletionService } from '../tracking-deletion.service';

describe('DeletionService (GDPR-style admin deletion workflow)', () => {
  const contextFindMany = jest.fn();
  const contextDeleteMany = jest.fn();
  const snapshotFindMany = jest.fn();
  const snapshotUpdateMany = jest.fn();
  const orderFindMany = jest.fn();
  const customerFindUnique = jest.fn();

  const prisma = {
    trackingContext: {
      findMany: contextFindMany,
      deleteMany: contextDeleteMany,
    },
    trackingSnapshot: {
      findMany: snapshotFindMany,
      updateMany: snapshotUpdateMany,
    },
    order: { findMany: orderFindMany },
    customerProfile: { findUnique: customerFindUnique },
  } as any;

  const service = new DeletionService(prisma);

  const rawPayload = {
    eventType: 'Purchase',
    eventId: 'purchase_ord-1',
    orderId: 'ord-1',
    eventTime: 1722585600,
    value: 100,
    currency: 'BDT',
    customer: {
      email: 'Buyer@Example.com',
      phone: '+8801711111111',
      firstName: 'Jane',
      lastName: 'Doe',
      city: 'Dhaka',
      state: 'Dhaka',
      country: 'BD',
      zip: '1212',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    contextFindMany.mockResolvedValue([]);
    contextDeleteMany.mockResolvedValue({ count: 0 });
    snapshotFindMany.mockResolvedValue([]);
    snapshotUpdateMany.mockResolvedValue({ count: 0 });
    orderFindMany.mockResolvedValue([]);
    customerFindUnique.mockResolvedValue(null);
  });

  describe('deleteByExternalId(externalId)', () => {
    it('deletes contexts by externalId and anonymizes linked snapshot payload PII, returning counts', async () => {
      contextFindMany.mockResolvedValue([
        { id: 'ctx-row-1', ctxId: 'ctx-1' },
        { id: 'ctx-row-2', ctxId: 'ctx-2' },
      ]);
      contextDeleteMany.mockResolvedValue({ count: 2 });
      snapshotFindMany.mockResolvedValue([
        { id: 'snap-1', payload: rawPayload },
        { id: 'snap-2', payload: { ...rawPayload, eventId: 'purchase_ord-2' } },
      ]);
      snapshotUpdateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteByExternalId('ext-abc');

      expect(contextFindMany).toHaveBeenCalledWith({
        where: { externalId: { in: ['ext-abc'] } },
        select: { id: true, ctxId: true },
      });
      expect(contextDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['ctx-row-1', 'ctx-row-2'] } },
      });

      // snapshots linked to the deleted contexts (by ctxId)
      expect(snapshotFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ctxId: { in: ['ctx-1', 'ctx-2'] } },
          select: { id: true, payload: true },
        }),
      );

      // PII nulled, envelope preserved
      expect(snapshotUpdateMany).toHaveBeenCalledTimes(2);
      const [dataArgs] = snapshotUpdateMany.mock.calls[0];
      expect(dataArgs.where).toEqual({ id: 'snap-1' });
      const stripped = dataArgs.data.payload;
      expect(stripped.eventId).toBe('purchase_ord-1');
      expect(stripped.orderId).toBe('ord-1');
      expect(stripped.eventTime).toBe(1722585600);
      expect(stripped.value).toBe(100);
      expect(stripped.customer.email).toBeNull();
      expect(stripped.customer.phone).toBeNull();
      expect(stripped.customer.firstName).toBeNull();
      expect(stripped.customer.lastName).toBeNull();
      // every customer sub-field (names + contact + geo) is erased
      expect(stripped.customer).toEqual({
        email: null,
        phone: null,
        firstName: null,
        lastName: null,
        city: null,
        state: null,
        country: null,
        zip: null,
      });

      expect(result).toEqual({ contextsDeleted: 2, snapshotsAnonymized: 2 });
    });

    it('is a no-op (zero counts, no snapshot writes) when no context matches the externalId', async () => {
      contextFindMany.mockResolvedValue([]);

      const result = await service.deleteByExternalId('ext-unknown');

      expect(contextDeleteMany).not.toHaveBeenCalled();
      expect(snapshotFindMany).not.toHaveBeenCalled();
      expect(snapshotUpdateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ contextsDeleted: 0, snapshotsAnonymized: 0 });
    });
  });

  describe('deleteByCustomerId(customerId)', () => {
    it('resolves the customer orders, deletes contexts via the shared externalId, anonymizes snapshots by orderId/ctxId', async () => {
      orderFindMany.mockResolvedValue([
        { id: 'ord-1', trackingSessionId: 'ctx-1' },
        { id: 'ord-2', trackingSessionId: null }, // POS/split order with no tracking session
      ]);
      // externalId discovery from the checkout session ctxId
      contextFindMany.mockResolvedValueOnce([{ externalId: 'ext-1' }]);
      // the delegate path resolves every context sharing that externalId
      contextFindMany.mockResolvedValueOnce([{ id: 'row-1', ctxId: 'ctx-1' }]);
      contextDeleteMany.mockResolvedValue({ count: 1 });
      snapshotFindMany.mockResolvedValue([
        {
          id: 'snap-1',
          payload: { ...rawPayload, orderId: 'ord-1', eventId: 'purchase_ord-1' },
        },
        {
          id: 'snap-2',
          payload: {
            ...rawPayload,
            orderId: 'ord-2',
            eventId: 'purchase_ord-2',
            ctxId: 'ctx-1',
          },
        },
      ]);
      snapshotUpdateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteByCustomerId('cust-7');

      expect(customerFindUnique).toHaveBeenCalledWith({
        where: { id: 'cust-7' },
        select: { phone: true },
      });
      expect(orderFindMany).toHaveBeenCalledWith({
        where: { OR: [{ customerId: 'cust-7' }] },
        select: { id: true, trackingSessionId: true },
      });
      expect(contextFindMany).toHaveBeenNthCalledWith(1, {
        where: { ctxId: { in: ['ctx-1'] } },
        select: { externalId: true },
      });
      expect(contextFindMany).toHaveBeenNthCalledWith(2, {
        where: { externalId: { in: ['ext-1'] } },
        select: { id: true, ctxId: true },
      });
      expect(contextDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['row-1'] } },
      });
      expect(snapshotFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ orderId: { in: ['ord-1', 'ord-2'] } }, { ctxId: { in: ['ctx-1'] } }],
          },
          select: { id: true, payload: true },
        }),
      );

      expect(result).toEqual({ contextsDeleted: 1, snapshotsAnonymized: 2 });
    });

    it('deletes a pre-order/abandoned context sharing the customer externalId (no linked order yet)', async () => {
      customerFindUnique.mockResolvedValue({ phone: '+8801711111111' });
      orderFindMany.mockResolvedValue([
        { id: 'ord-1', trackingSessionId: 'ctx-checkout' },
      ]);
      // the checkout session context carries the customer-keyed externalId
      contextFindMany.mockResolvedValueOnce([{ externalId: 'ext-cust' }]);
      // EVERY context sharing ext-cust — including the abandoned pre-order one
      contextFindMany.mockResolvedValueOnce([
        { id: 'row-checkout', ctxId: 'ctx-checkout' },
        { id: 'row-pre-order', ctxId: 'ctx-pre-order' }, // no order linked yet
      ]);
      contextDeleteMany.mockResolvedValue({ count: 2 });
      snapshotFindMany.mockResolvedValue([
        {
          id: 'snap-1',
          payload: { ...rawPayload, orderId: 'ord-1', eventId: 'purchase_ord-1' },
        },
      ]);
      snapshotUpdateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteByCustomerId('cust-7');

      expect(contextDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['row-checkout', 'row-pre-order'] } },
      });
      expect(result).toEqual({ contextsDeleted: 2, snapshotsAnonymized: 1 });
    });

    it('resolves guest orders (customerId null) by the customer phone and includes their contexts/snapshots', async () => {
      customerFindUnique.mockResolvedValue({ phone: '+8801711111111' });
      orderFindMany.mockResolvedValue([
        { id: 'ord-1', trackingSessionId: 'ctx-checkout' },
        { id: 'ord-guest', trackingSessionId: 'ctx-guest' }, // guest order matched by phone
      ]);
      contextFindMany.mockResolvedValueOnce([{ externalId: 'ext-cust' }]);
      contextFindMany.mockResolvedValueOnce([
        { id: 'row-checkout', ctxId: 'ctx-checkout' },
        { id: 'row-guest', ctxId: 'ctx-guest' },
      ]);
      contextDeleteMany.mockResolvedValue({ count: 2 });
      snapshotFindMany.mockResolvedValue([
        {
          id: 'snap-1',
          payload: { ...rawPayload, orderId: 'ord-guest', eventId: 'purchase_guest' },
        },
      ]);
      snapshotUpdateMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteByCustomerId('cust-7');

      expect(orderFindMany).toHaveBeenCalledWith({
        where: {
          OR: [{ customerId: 'cust-7' }, { guestPhone: '+8801711111111' }],
        },
        select: { id: true, trackingSessionId: true },
      });
      expect(snapshotFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { orderId: { in: ['ord-1', 'ord-guest'] } },
              { ctxId: { in: ['ctx-checkout', 'ctx-guest'] } },
            ],
          },
          select: { id: true, payload: true },
        }),
      );
      expect(result).toEqual({ contextsDeleted: 2, snapshotsAnonymized: 1 });
    });

    it('is a no-op when the customer has no orders', async () => {
      orderFindMany.mockResolvedValue([]);

      const result = await service.deleteByCustomerId('cust-nobody');

      expect(contextDeleteMany).not.toHaveBeenCalled();
      expect(snapshotFindMany).not.toHaveBeenCalled();
      expect(result).toEqual({ contextsDeleted: 0, snapshotsAnonymized: 0 });
    });
  });
});
