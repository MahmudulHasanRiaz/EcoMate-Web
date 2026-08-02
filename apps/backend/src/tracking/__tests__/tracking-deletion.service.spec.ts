import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { DeletionService } from '../tracking-deletion.service';
import { DeletionController } from '../deletion.controller';

describe('DeletionService (GDPR-style admin deletion workflow)', () => {
  const contextFindMany = jest.fn();
  const contextDeleteMany = jest.fn();
  const snapshotFindMany = jest.fn();
  const snapshotUpdateMany = jest.fn();
  const orderFindMany = jest.fn();

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
        where: { externalId: 'ext-abc' },
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
    it('resolves the customer orders, deletes contexts by trackingSessionId (ctxId), anonymizes snapshots by orderId/ctxId', async () => {
      orderFindMany.mockResolvedValue([
        { id: 'ord-1', trackingSessionId: 'ctx-1' },
        { id: 'ord-2', trackingSessionId: null }, // POS/split order with no tracking session
      ]);
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

      expect(orderFindMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-7' },
        select: { id: true, trackingSessionId: true },
      });
      expect(contextDeleteMany).toHaveBeenCalledWith({
        where: { ctxId: { in: ['ctx-1'] } },
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

    it('is a no-op when the customer has no orders', async () => {
      orderFindMany.mockResolvedValue([]);

      const result = await service.deleteByCustomerId('cust-nobody');

      expect(contextDeleteMany).not.toHaveBeenCalled();
      expect(snapshotFindMany).not.toHaveBeenCalled();
      expect(result).toEqual({ contextsDeleted: 0, snapshotsAnonymized: 0 });
    });
  });
});

describe('DeletionController (POST /tracking/admin/delete)', () => {
  const deleteByExternalId = jest.fn();
  const deleteByCustomerId = jest.fn();
  const service = {
    deleteByExternalId,
    deleteByCustomerId,
  } as unknown as DeletionService;
  const controller = new DeletionController(service);

  beforeEach(() => {
    jest.clearAllMocks();
    deleteByExternalId.mockResolvedValue({ contextsDeleted: 1, snapshotsAnonymized: 0 });
    deleteByCustomerId.mockResolvedValue({ contextsDeleted: 0, snapshotsAnonymized: 3 });
  });

  it('is gated with RequiresFeature(admin_tracking) at the class level', () => {
    const feature = Reflect.getMetadata(REQUIRES_FEATURE_KEY, DeletionController);
    expect(feature).toBe('admin_tracking');
  });

  it('POST delete carries Roles(admin) metadata', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, DeletionController.prototype.delete);
    expect(roles).toEqual(['admin']);
  });

  it('delegates to deleteByExternalId when externalId is provided', async () => {
    const result = await controller.delete({ externalId: 'ext-abc' });

    expect(deleteByExternalId).toHaveBeenCalledWith('ext-abc');
    expect(deleteByCustomerId).not.toHaveBeenCalled();
    expect(result).toEqual({ contextsDeleted: 1, snapshotsAnonymized: 0 });
  });

  it('delegates to deleteByCustomerId when only customerId is provided', async () => {
    const result = await controller.delete({ customerId: 'cust-7' });

    expect(deleteByCustomerId).toHaveBeenCalledWith('cust-7');
    expect(deleteByExternalId).not.toHaveBeenCalled();
    expect(result).toEqual({ contextsDeleted: 0, snapshotsAnonymized: 3 });
  });

  it('throws BadRequestException when neither externalId nor customerId is provided', async () => {
    await expect(controller.delete({})).rejects.toThrow(BadRequestException);
    expect(deleteByExternalId).not.toHaveBeenCalled();
    expect(deleteByCustomerId).not.toHaveBeenCalled();
  });
});
