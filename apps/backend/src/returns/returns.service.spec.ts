import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelReturnStockService } from '../stock/cancel-return-stock.service';

/**
 * Task 6 (Fix 13 §§17.1–17.3): unified Return entity — backend CRUD.
 *
 * - EVERY return creates ONE Return row (no phantom Orders).
 * - displayId is RTN-YYMMDD-NNNN, unique + sequential (mirrors ORD-XXXX).
 * - Status chain REQUESTED → IN_TRANSIT → RECEIVED → RESTOCKED → CLOSED.
 * - mark-received restores ONLY Return.items quantities (item-level — the
 *   kept/delivered part of a partial never restocks); empty items → 400.
 * - link-refund stores refundId (refund must exist). close → CLOSED.
 * - upsertCourierReturn: create on first courier signal (source COURIER),
 *   update courierStatus after; courierReturnId is set-once, never clobbered.
 */
describe('ReturnsService — unified Return entity (Task 6)', () => {
  let service: ReturnsService;
  let prisma: any;
  let cancelReturnStock: any;

  const order = { id: 'order-1', displayId: 'ORD-260101-0001', trashedAt: null };

  function makeTx(over: Record<string, any> = {}) {
    return {
      returnCounter: {
        upsert: jest.fn().mockImplementation(({ create }: any) =>
          Promise.resolve({ date: '260101', seq: create?.seq ?? 1 }),
        ),
      },
      return: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ...over,
    };
  }

  beforeEach(async () => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        findFirst: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      return: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ret-1', ...data }),
        ),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue({ id: 'refund-1' }),
      },
      dispatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((cb: any) => cb(makeTx())),
    };
    cancelReturnStock = {
      restoreForReturnItems: jest.fn().mockResolvedValue({ restored: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CancelReturnStockService, useValue: cancelReturnStock },
      ],
    }).compile();

    service = module.get<ReturnsService>(ReturnsService);
  });

  describe('create', () => {
    it('creates a REQUESTED staff Return with an RTN- sequence displayId', async () => {
      const ret = await service.create({
        orderId: 'order-1',
        type: 'FULL',
        items: [{ productId: 'p-1', quantity: 2 }],
        reason: 'changed mind',
      });

      expect(prisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            type: 'FULL',
            status: 'REQUESTED',
            source: 'STAFF',
          }),
        }),
      );
      expect(ret.displayId).toMatch(/^RTN-\d{6}-\d{4}$/);
    });

    it('increments the daily RTN sequence (no phantom Orders created)', async () => {
      prisma.$transaction.mockImplementationOnce((cb: any) =>
        cb(makeTx({
          returnCounter: {
            upsert: jest.fn().mockResolvedValue({ date: '260101', seq: 7 }),
          },
        })),
      );
      const ret = await service.create({ orderId: 'order-1', type: 'FULL' });
      // Date prefix is today (real clock); the sequence comes from the mock.
      expect(ret.displayId).toMatch(/^RTN-\d{6}-0007$/);
      // No Order row is ever written by Return creation.
      expect(prisma.order.create).toBeUndefined();
    });

    it('404s for a missing order and 400s for bad items', async () => {
      prisma.order.findUnique.mockResolvedValueOnce(null);
      await expect(service.create({ orderId: 'ghost', type: 'FULL' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.create({ orderId: 'order-1', type: 'FULL', items: [{ productId: 'p-1', quantity: 0 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({
          orderId: 'order-1',
          type: 'FULL',
          items: [
            { productId: 'p-1', quantity: 1 },
            { productId: 'p-1', quantity: 1 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('get / list / detail', () => {
    it('get returns the Return with its order link; 404 when missing', async () => {
      prisma.return.findUnique.mockResolvedValueOnce(null);
      await expect(service.get('ghost')).rejects.toBeInstanceOf(NotFoundException);
      prisma.return.findUnique.mockResolvedValueOnce({ id: 'ret-1', orderId: 'order-1' });
      await expect(service.get('ret-1')).resolves.toMatchObject({ id: 'ret-1' });
    });

    it('list filters by order + status with pagination meta', async () => {
      prisma.return.findMany.mockResolvedValueOnce([{ id: 'ret-1' }]);
      (prisma.return as any).count = jest.fn().mockResolvedValue(1);
      const res = await service.list({ orderId: 'order-1', status: 'REQUESTED' });
      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'order-1', status: 'REQUESTED' }),
        }),
      );
      expect(res.meta).toMatchObject({ total: 1 });
    });
  });

  describe('markReceived (staff-confirmed path)', () => {
    const stored = {
      id: 'ret-1',
      orderId: 'order-1',
      type: 'FULL',
      status: 'IN_TRANSIT',
      source: 'COURIER',
      courier: 'steadfast',
      items: [{ productId: 'p-1', quantity: 2 }],
      stockReconciled: false,
    };

    it('RECEIVED → RESTOCKED with an item-level restore of exactly the stored items', async () => {
      prisma.return.findUnique.mockResolvedValue(stored);
      const res = await service.markReceived('ret-1', { performedBy: 'staff@x.com' });

      expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          items: [{ productId: 'p-1', variantId: null, quantity: 2 }],
          returnId: 'ret-1',
        }),
      );
      expect(res).toMatchObject({ status: 'RESTOCKED', stockReconciled: true });
      expect(res.stockReconciledAt).toBeDefined();
      // FULL → dispatch RETURNED; the ORDER is untouched (stays Return Pending).
      expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RETURNED' }) }),
      );
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('PARTIAL keeps the dispatch at PARTIAL (never RETURNED)', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...stored, type: 'PARTIAL' });
      await service.markReceived('ret-1', {});
      expect(prisma.dispatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL' }) }),
      );
    });

    it('accepts an explicit items override and 400s when quantities are unknown', async () => {
      prisma.return.findUnique.mockResolvedValueOnce({ ...stored, items: [] });
      await expect(service.markReceived('ret-1', {})).rejects.toBeInstanceOf(BadRequestException);
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();

      prisma.return.findUnique.mockResolvedValue({ ...stored, items: [] });
      await service.markReceived('ret-1', { items: [{ productId: 'p-9', quantity: 1 }] });
      expect(cancelReturnStock.restoreForReturnItems).toHaveBeenCalledWith(
        expect.objectContaining({ items: [{ productId: 'p-9', variantId: null, quantity: 1 }] }),
      );
    });

    it('is idempotent: an already-RESTOCKED Return never restores twice', async () => {
      prisma.return.findUnique.mockResolvedValue({
        ...stored,
        status: 'RESTOCKED',
        stockReconciled: true,
      });
      const res = await service.markReceived('ret-1', {});
      expect(cancelReturnStock.restoreForReturnItems).not.toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'RESTOCKED' });
    });

    it('400s on CLOSED Returns', async () => {
      prisma.return.findUnique.mockResolvedValue({ ...stored, status: 'CLOSED' });
      await expect(service.markReceived('ret-1', {})).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('linkRefund / close', () => {
    it('links an existing refund by id; 404s for a missing refund', async () => {
      prisma.return.findUnique.mockResolvedValue({ id: 'ret-1' });
      await service.linkRefund('ret-1', { refundId: 'refund-1' });
      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ refundId: 'refund-1' }) }),
      );
      prisma.refund.findUnique.mockResolvedValueOnce(null);
      await expect(service.linkRefund('ret-1', { refundId: 'ghost' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('close moves any open Return to CLOSED; 400s when already CLOSED', async () => {
      prisma.return.findUnique.mockResolvedValue({ id: 'ret-1', status: 'RESTOCKED' });
      const res = await service.close('ret-1');
      expect(res).toMatchObject({ status: 'CLOSED' });
      prisma.return.findUnique.mockResolvedValue({ id: 'ret-1', status: 'CLOSED' });
      await expect(service.close('ret-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('upsertCourierReturn', () => {
    it('creates a COURIER Return on first signal (status REQUESTED)', async () => {
      prisma.return.findFirst.mockResolvedValue(null);
      const ret = await service.upsertCourierReturn({
        orderId: 'order-1',
        courier: 'steadfast',
        courierReturnId: 'RR-10',
        courierStatus: 'return_request',
        type: 'FULL',
        reason: 'customer asked',
      });
      expect(prisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'COURIER',
            courier: 'steadfast',
            courierReturnId: 'RR-10',
            status: 'REQUESTED',
          }),
        }),
      );
      expect(ret.displayId).toMatch(/^RTN-/);
    });

    it('updates courierStatus on later signals but never clobbers courierReturnId', async () => {
      prisma.return.findFirst.mockResolvedValue({
        id: 'ret-1',
        orderId: 'order-1',
        courier: 'steadfast',
        courierReturnId: 'RR-10',
        status: 'REQUESTED',
      });
      await service.upsertCourierReturn({
        orderId: 'order-1',
        courier: 'steadfast',
        courierReturnId: 'RL-99',
        courierStatus: 'return_list_accepted',
      });
      expect(prisma.return.create).not.toHaveBeenCalled();
      const updateArg = prisma.return.update.mock.calls[0][0];
      expect(updateArg).toMatchObject({ where: { id: 'ret-1' } });
      // courierStatus advances…
      expect(updateArg.data.courierStatus).toBe('return_list_accepted');
      // …but the first courier return id is set-once, never clobbered.
      expect(updateArg.data.courierReturnId ?? 'RR-10').toBe('RR-10');
    });
  });

  describe('findOpenStaffReturnWithItems (T6 partial restore-or-hold lookup)', () => {
    it('returns the open STAFF Return with items, skips empty rows', async () => {
      prisma.return.findMany.mockResolvedValue([
        { id: 'ret-empty', status: 'REQUESTED', source: 'STAFF', items: [] },
        {
          id: 'ret-staff-1',
          status: 'REQUESTED',
          source: 'STAFF',
          items: [{ productId: 'p-1', quantity: 1 }],
        },
      ]);

      await expect(service.findOpenStaffReturnWithItems('order-1')).resolves.toMatchObject({
        id: 'ret-staff-1',
      });
      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'order-1', source: 'STAFF' }),
        }),
      );
    });

    it('returns null when no staff Return carries items', async () => {
      prisma.return.findMany.mockResolvedValue([
        { id: 'ret-empty', status: 'REQUESTED', source: 'STAFF', items: [] },
      ]);
      await expect(service.findOpenStaffReturnWithItems('order-1')).resolves.toBeNull();
    });

    it('skips CLOSED/RESTOCKED rows (never double-restore)', async () => {
      prisma.return.findMany.mockResolvedValue([
        {
          id: 'ret-old',
          status: 'RESTOCKED',
          source: 'STAFF',
          items: [{ productId: 'p-1', quantity: 1 }],
        },
      ]);
      await expect(service.findOpenStaffReturnWithItems('order-1')).resolves.toBeNull();
    });
  });
});
