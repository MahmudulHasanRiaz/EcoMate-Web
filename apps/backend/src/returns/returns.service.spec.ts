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

  const order = {
    id: 'order-1',
    displayId: 'ORD-260101-0001',
    trashedAt: null,
    status: { id: 'st-shipping', name: 'Shipping' },
    items: [] as any[],
  };

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
          // The guarded stock core re-loads the row INSIDE the transaction —
          // delegate to the outer mock so tests control the stored row.
          findUnique: jest.fn((...args: any[]) =>
            (prisma.return.findUnique as jest.Mock)(...args),
          ),
          findMany: jest.fn().mockResolvedValue([]),
        },
        // Signed adjustment path: original-order write + atomic timeline append.
        order: {
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn((...args: any[]) =>
            (prisma.order.findUnique as jest.Mock)(...args),
          ),
        },
        // Mark-original-delivered path: the existing Delivered status row.
        orderStatus: {
          findUnique: jest.fn().mockResolvedValue({ id: 'st-delivered', name: 'Delivered' }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
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

    it('records createdBy = the performing staff email on creation, null without an actor', async () => {
      await service.create({ orderId: 'order-1', type: 'FULL' }, 'staff@ecomate.com');
      expect(prisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdBy: 'staff@ecomate.com' }),
        }),
      );
      await service.create({ orderId: 'order-1', type: 'FULL' });
      expect(prisma.return.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdBy: null }),
        }),
      );
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

    it('list supports courier + date-range + exchangeOrderId filters with order link', async () => {
      prisma.return.findMany.mockResolvedValueOnce([{ id: 'ret-1' }]);
      (prisma.return as any).count = jest.fn().mockResolvedValue(1);
      await service.list({
        courier: 'steadfast',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-14',
        exchangeOrderId: 'ex-1',
      } as any);
      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courier: 'steadfast',
            exchangeOrderId: 'ex-1',
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
          include: expect.objectContaining({
            order: expect.anything(),
          }),
        }),
      );
    });

    it('get includes the exchange-order and refund links', async () => {
      prisma.return.findUnique.mockResolvedValueOnce({
        id: 'ret-1',
        orderId: 'order-1',
        exchangeOrderId: 'ex-1',
        refundId: 'refund-1',
      });
      prisma.order.findUnique.mockResolvedValueOnce({ id: 'ex-1', displayId: 'ORD-EX-1' });
      (prisma.refund.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'refund-1',
        status: 'pending',
      });
      const res = await service.get('ret-1');
      expect(res).toMatchObject({ id: 'ret-1' });
      expect((res as any).exchangeOrder).toMatchObject({ id: 'ex-1' });
      expect((res as any).refund).toMatchObject({ id: 'refund-1' });
    });

    it('get deep-loads the original order: customer snapshot + item snapshots in ONE query (no N+1)', async () => {
      prisma.return.findUnique.mockResolvedValueOnce({ id: 'ret-1', orderId: 'order-1' });
      await service.get('ret-1');
      expect(prisma.return.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ret-1' },
          include: expect.objectContaining({
            order: expect.objectContaining({
              select: expect.objectContaining({
                displayId: true,
                customerPhone: true,
                guestName: true,
                secondaryPhone: true,
                customer: { select: expect.objectContaining({ id: true, name: true }) },
                items: {
                  select: expect.objectContaining({
                    productId: true,
                    variantId: true,
                    quantity: true,
                    price: true,
                    product: expect.objectContaining({
                      select: expect.objectContaining({ name: true, sku: true, images: true }),
                    }),
                    variant: expect.objectContaining({
                      select: expect.objectContaining({ sku: true, image: true, images: true }),
                    }),
                  }),
                },
              }),
            }),
          }),
        }),
      );
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
          items: [{ productId: 'p-1', variantId: null, quantity: 2, damagedQuantity: 0 }],
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
        expect.objectContaining({ items: [{ productId: 'p-9', variantId: null, quantity: 1, damagedQuantity: 0 }] }),
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

  /**
   * Owner-locked signed per-field semantics: positive RAISES the original
   * order's field value, negative LOWERS it. All widening combos + hard
   * rejections + timeline entries + all-or-nothing.
   */
  describe('create — signed per-field billing adjustments (partial)', () => {
    const richOrder = {
      ...order,
      items: [{ id: 'oi-1', productId: 'p1', variantId: null, quantity: 5, price: 360 }],
      subtotal: 1800,
      shippingCharge: 100,
      discount: 50,
      discountType: 'flat',
      total: 1850,
    };

    let txMock: any;
    const baseDto = () => ({
      orderId: 'order-1',
      type: 'PARTIAL' as const,
      source: 'STAFF' as const,
      items: [{ productId: 'p1', variantId: null, quantity: 1 }],
    });

    beforeEach(() => {
      txMock = null;
      prisma.$transaction.mockImplementation((cb: any) => {
        txMock = makeTx();
        return cb(txMock);
      });
      prisma.$transaction.mockClear();
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(richOrder);
    });

    it('shipping +50 raises original shippingCharge and total by exactly 50 + writes the timeline entry', async () => {
      const ret: any = await service.create(
        { ...baseDto(), shippingAdjustment: 50 },
        'staff@shop.com',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { shippingCharge: 150, discount: 50, total: 1900 },
      });
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('"type":"shipping"');
      expect(payload).toContain('"oldValue":100');
      expect(payload).toContain('"newValue":150');
      expect(payload).toContain(
        `Shipping charge +50 by staff@shop.com during partial return ${ret.displayId}`,
      );
    });

    it('shipping -50 lowers original shippingCharge and total by exactly 50', async () => {
      const ret: any = await service.create(
        { ...baseDto(), shippingAdjustment: -50 },
        'staff@shop.com',
      );
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { shippingCharge: 50, discount: 50, total: 1800 },
      });
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain(
        `Shipping charge -50 by staff@shop.com during partial return ${ret.displayId}`,
      );
    });

    it('discount +20 raises original discount by 20 (total drops by 20)', async () => {
      await service.create({ ...baseDto(), discountAdjustment: 20 }, 'staff@shop.com');
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { shippingCharge: 100, discount: 70, total: 1830 },
      });
    });

    it('discount -20 lowers original discount by 20 (total rises by 20) + timeline entry', async () => {
      const ret: any = await service.create(
        { ...baseDto(), discountAdjustment: -20 },
        'staff@shop.com',
      );
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { shippingCharge: 100, discount: 30, total: 1870 },
      });
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('"type":"discount"');
      expect(payload).toContain('"oldValue":50');
      expect(payload).toContain('"newValue":30');
      expect(payload).toContain(
        `Discount -20 by staff@shop.com during partial return ${ret.displayId}`,
      );
    });

    it('applies both fields independently in ONE update', async () => {
      await service.create(
        { ...baseDto(), shippingAdjustment: 50, discountAdjustment: -20 },
        'staff@shop.com',
      );
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { shippingCharge: 150, discount: 30, total: 1920 },
      });
      expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('percentage-type order: recomputes the effective discount from the new stored value', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...richOrder,
        subtotal: 1000,
        discount: 10,
        discountType: 'percentage',
        total: 900,
      });
      await service.create({ ...baseDto(), discountAdjustment: 5 }, 'staff@shop.com');
      // stored value 10 → 15 (percent points); effective 1000 × 15/100 = 150.
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { shippingCharge: 100, discount: 15, total: 950 },
      });
    });

    it('rejects a shipping adjustment that would leave shipping below 0 (400, nothing persists)', async () => {
      await expect(
        service.create({ ...baseDto(), shippingAdjustment: -500 }, 'staff@shop.com'),
      ).rejects.toThrow(/Shipping charge cannot go below 0/);
      expect(txMock.return.create).not.toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
      expect(txMock.$executeRaw).not.toHaveBeenCalled();
    });

    it('rejects a discount adjustment that would leave discount below 0 (400)', async () => {
      await expect(
        service.create({ ...baseDto(), discountAdjustment: -60 }, 'staff@shop.com'),
      ).rejects.toThrow(/Discount cannot go below 0/);
      expect(txMock.return.create).not.toHaveBeenCalled();
    });

    it('rejects adjustments that would push the recomputed total negative (400)', async () => {
      await expect(
        service.create({ ...baseDto(), discountAdjustment: 5000 }, 'staff@shop.com'),
      ).rejects.toThrow(/Order total cannot go negative/);
      expect(txMock.return.create).not.toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
    });

    it('rejects adjustments on FULL returns (partial-only semantics)', async () => {
      await expect(
        service.create({ ...baseDto(), type: 'FULL' as const, shippingAdjustment: 10 }, 'staff@shop.com'),
      ).rejects.toThrow(/only supported on partial returns/);
      expect(txMock.return.create).not.toHaveBeenCalled();
    });

    it('partial with no adjustments still runs the business tx (default mark-delivered write)', async () => {
      await service.create(baseDto(), 'staff@shop.com');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { statusId: 'st-delivered' },
      });
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('Original order marked Delivered on partial return');
      expect(txMock.return.create).toHaveBeenCalled();
    });

    it('FULL with no adjustments keeps the legacy path (no business write at all)', async () => {
      await service.create({ ...baseDto(), type: 'FULL' as const }, 'staff@shop.com');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1); // displayId sequence only
      expect(txMock.order.update).not.toHaveBeenCalled();
      expect(txMock.$executeRaw).not.toHaveBeenCalled();
      expect(txMock.orderStatus.findUnique).not.toHaveBeenCalled();
      expect(prisma.return.create).toHaveBeenCalled();
    });

    it('propagates an original-order write failure (all-or-nothing — no truthy return)', async () => {
      const failing = makeTx();
      failing.order.update.mockRejectedValue(new Error('db down'));
      prisma.$transaction.mockImplementation((cb: any) => cb(failing));
      await expect(
        service.create({ ...baseDto(), shippingAdjustment: 10 }, 'staff@shop.com'),
      ).rejects.toThrow('db down');
    });
  });

  /**
   * Owner-locked §5: partial returns mark the ORIGINAL order Delivered by
   * default; unchecking leaves it to courier status updates (the sheet is
   * authority — no parallel interpretation here). Both branches record the
   * decision on the original order's timeline.
   */
  describe('create — mark original order as delivered (partial)', () => {
    const decOrder = {
      ...order,
      items: [{ id: 'oi-1', productId: 'p1', variantId: null, quantity: 5, price: 360 }],
      subtotal: 1800,
      shippingCharge: 100,
      discount: 50,
      discountType: 'flat',
      total: 1850,
    };

    let txMock: any;
    const baseDto = () => ({
      orderId: 'order-1',
      type: 'PARTIAL' as const,
      source: 'STAFF' as const,
      items: [{ productId: 'p1', variantId: null, quantity: 1 }],
    });

    beforeEach(() => {
      txMock = null;
      prisma.$transaction.mockImplementation((cb: any) => {
        txMock = makeTx();
        return cb(txMock);
      });
      prisma.$transaction.mockClear();
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(decOrder);
    });

    it('default (omitted) → original order set to Delivered + decision timeline entry', async () => {
      const ret: any = await service.create(baseDto(), 'staff@shop.com');
      expect(txMock.orderStatus.findUnique).toHaveBeenCalledWith({ where: { name: 'Delivered' } });
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { statusId: 'st-delivered' },
      });
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('"type":"status"');
      expect(payload).toContain('"oldValue":"Shipping"');
      expect(payload).toContain('"newValue":"Delivered"');
      expect(payload).toContain(
        `Original order marked Delivered on partial return ${ret.displayId} by staff@shop.com`,
      );
    });

    it('explicit true behaves exactly like the default', async () => {
      await service.create({ ...baseDto(), markOriginalDelivered: true }, 'staff@shop.com');
      expect(txMock.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { statusId: 'st-delivered' },
      });
      expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('partial covering ALL ordered units (flag omitted) never marks Delivered — timeline records the skip', async () => {
      const ret: any = await service.create(
        {
          ...baseDto(),
          items: [{ productId: 'p1', variantId: null, quantity: 5 }],
        },
        'staff@shop.com',
      );
      // Remaining units = 5 ordered − 5 returned = 0 → delivered-marking never applies.
      expect(txMock.orderStatus.findUnique).not.toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
      expect(txMock.return.create).toHaveBeenCalled();
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('Delivered-marking skipped — this return covers all items');
      expect(payload).toContain(ret.displayId);
      expect(payload).not.toContain('Original order marked Delivered');
    });

    it('partial covering ALL ordered units with explicit true → 400, nothing persists', async () => {
      await expect(
        service.create(
          {
            ...baseDto(),
            items: [{ productId: 'p1', variantId: null, quantity: 5 }],
            markOriginalDelivered: true,
          },
          'staff@shop.com',
        ),
      ).rejects.toThrow(/covers all items/i);
      expect(txMock.orderStatus.findUnique).not.toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
      expect(txMock.return.create).not.toHaveBeenCalled();
      expect(txMock.$executeRaw).not.toHaveBeenCalled();
    });

    it('unchecked → original order status untouched + left-for-courier timeline entry', async () => {
      const ret: any = await service.create({ ...baseDto(), markOriginalDelivered: false }, 'staff@shop.com');
      expect(txMock.orderStatus.findUnique).not.toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain(
        `Order left for courier status updates on partial return ${ret.displayId} by staff@shop.com`,
      );
      expect(payload).not.toContain('"statusId"');
    });

    it('already-Delivered order → entry written, no no-op status update', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...decOrder,
        statusId: 'st-delivered',
        status: { id: 'st-delivered', name: 'Delivered' },
      });
      await service.create(baseDto(), 'staff@shop.com');
      expect(txMock.orderStatus.findUnique).toHaveBeenCalled();
      expect(txMock.order.update).not.toHaveBeenCalled();
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('Original order marked Delivered on partial return');
    });

    it('explicitly sending the flag on FULL → 400 (both true and false), nothing persists', async () => {
      await expect(
        service.create({ ...baseDto(), type: 'FULL' as const, markOriginalDelivered: true }, 'staff@shop.com'),
      ).rejects.toThrow(/only supported on partial returns/);
      expect(txMock.return.create).not.toHaveBeenCalled();
      await expect(
        service.create({ ...baseDto(), type: 'FULL' as const, markOriginalDelivered: false }, 'staff@shop.com'),
      ).rejects.toThrow(/only supported on partial returns/);
      expect(txMock.return.create).not.toHaveBeenCalled();
    });

    it('incomplete status configuration → 400, nothing persists', async () => {
      const noDelivered = makeTx({ orderStatus: { findUnique: jest.fn().mockResolvedValue(null) } });
      prisma.$transaction.mockImplementation((cb: any) => cb(noDelivered));
      await expect(service.create(baseDto(), 'staff@shop.com')).rejects.toThrow(
        'Order status configuration is incomplete',
      );
      expect(noDelivered.return.create).not.toHaveBeenCalled();
      expect(noDelivered.order.update).not.toHaveBeenCalled();
    });

    it('status write failure propagates (rolls back with the return creation)', async () => {
      const failing = makeTx();
      failing.order.update.mockRejectedValue(new Error('db down'));
      prisma.$transaction.mockImplementation((cb: any) => cb(failing));
      await expect(service.create(baseDto(), 'staff@shop.com')).rejects.toThrow('db down');
    });

    it('adjustments + default mark-delivered commit together in ONE tx (3 entries, 2 order writes)', async () => {
      await service.create({ ...baseDto(), shippingAdjustment: 50 }, 'staff@shop.com');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.order.update).toHaveBeenCalledTimes(2);
      expect(txMock.order.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'order-1' },
        data: { shippingCharge: 150, discount: 50, total: 1900 },
      });
      expect(txMock.order.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'order-1' },
        data: { statusId: 'st-delivered' },
      });
      const payload = txMock.$executeRaw.mock.calls[0][1] as string;
      expect(payload).toContain('"type":"shipping"');
      expect(payload).toContain('"type":"status"');
      expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});
