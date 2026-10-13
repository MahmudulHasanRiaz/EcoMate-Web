import { Test, TestingModule } from '@nestjs/testing';
import { CodMismatchService } from '../cod-mismatch.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CodMismatchService', () => {
  let service: CodMismatchService;

  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    codMismatchAlert: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  function loadOrder(opts: {
    total?: number;
    payments?: any[];
    dispatches?: any[];
    timeline?: any[];
  }) {
    mockPrisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      total: opts.total ?? 1500,
      payments: opts.payments ?? [],
      dispatches: opts.dispatches ?? [],
      timeline: opts.timeline ?? [],
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.codMismatchAlert.findMany.mockResolvedValue([]);
    mockPrisma.order.update.mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodMismatchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<CodMismatchService>(CodMismatchService);
  });

  describe('recompute', () => {
    it('raises alert when courierAmount != systemDue with exact amounts', async () => {
      loadOrder({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID', appliedCreditAmount: null }],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED', courierAmount: 1370 },
        ],
      });
      mockPrisma.codMismatchAlert.findFirst.mockResolvedValue(null);
      mockPrisma.codMismatchAlert.create.mockImplementation(async ({ data }: any) => ({
        id: 'alert-1',
        ...data,
      }));

      const alerts = await service.recompute('order-1');

      // systemDue = 1500 - 1380 - 0 = 120
      expect(alerts).toHaveLength(1);
      expect(Number(alerts[0].courierAmount)).toBe(1370);
      expect(Number(alerts[0].systemDue)).toBe(120);
      expect(mockPrisma.codMismatchAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          courier: 'pathao',
          consignmentId: 'C1',
          status: 'open',
        }),
      });
      // timeline audit written
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { timeline: expect.arrayContaining([expect.objectContaining({ event: expect.stringContaining('C1') })]) },
      });
    });

    it('subtracts appliedCreditAmount from systemDue', async () => {
      loadOrder({
        total: 1500,
        payments: [
          { amount: 1000, status: 'PAID', appliedCreditAmount: 200 },
          { amount: 500, status: 'PENDING', appliedCreditAmount: null },
        ],
        dispatches: [
          { courier: 'steadfast', consignmentId: 'C2', status: 'DISPATCHED', courierAmount: 999 },
        ],
      });
      mockPrisma.codMismatchAlert.findFirst.mockResolvedValue(null);
      mockPrisma.codMismatchAlert.create.mockImplementation(async ({ data }: any) => ({
        id: 'alert-2',
        ...data,
      }));

      const alerts = await service.recompute('order-1');

      // paid counts only PAID (1000, not the 500 PENDING); applied = 200
      // systemDue = 1500 - 1000 - 200 = 300
      expect(alerts).toHaveLength(1);
      expect(Number(alerts[0].systemDue)).toBe(300);
    });

    it('no alert when equal', async () => {
      loadOrder({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID', appliedCreditAmount: null }],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED', courierAmount: 120 },
        ],
      });

      const alerts = await service.recompute('order-1');

      expect(alerts).toHaveLength(0);
      expect(mockPrisma.codMismatchAlert.create).not.toHaveBeenCalled();
    });

    it('skips NULL courierAmount (no fabricated 0)', async () => {
      loadOrder({
        total: 1500,
        payments: [],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C9', status: 'DISPATCHED', courierAmount: null },
        ],
      });

      const alerts = await service.recompute('order-1');

      expect(alerts).toHaveLength(0);
      expect(mockPrisma.codMismatchAlert.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.codMismatchAlert.create).not.toHaveBeenCalled();
    });

    it('refreshes existing open alert amounts instead of duplicating', async () => {
      loadOrder({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID', appliedCreditAmount: null }],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED', courierAmount: 1370 },
        ],
      });
      mockPrisma.codMismatchAlert.findFirst.mockResolvedValue({
        id: 'alert-1',
        orderId: 'order-1',
        consignmentId: 'C1',
        status: 'open',
      });
      mockPrisma.codMismatchAlert.findMany.mockResolvedValue([
        { id: 'alert-1', orderId: 'order-1', consignmentId: 'C1', status: 'open' },
      ]);
      mockPrisma.codMismatchAlert.update.mockImplementation(async ({ data }: any) => ({
        id: 'alert-1',
        ...data,
      }));

      const alerts = await service.recompute('order-1');

      expect(alerts).toHaveLength(1);
      expect(mockPrisma.codMismatchAlert.create).not.toHaveBeenCalled();
      expect(mockPrisma.codMismatchAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: expect.objectContaining({ courierAmount: 1370, systemDue: 120 }),
      });
    });

    it('refresh-identical: no new timeline entry when amounts unchanged', async () => {
      loadOrder({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID', appliedCreditAmount: null }],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED', courierAmount: 1370 },
        ],
      });
      // systemDue = 1500 - 1380 = 120 — existing row already holds identical amounts
      mockPrisma.codMismatchAlert.findFirst.mockResolvedValue({
        id: 'alert-1',
        orderId: 'order-1',
        consignmentId: 'C1',
        status: 'open',
        courierAmount: 1370,
        systemDue: 120,
      });
      mockPrisma.codMismatchAlert.findMany.mockResolvedValue([
        { id: 'alert-1', orderId: 'order-1', consignmentId: 'C1', status: 'open' },
      ]);
      mockPrisma.codMismatchAlert.update.mockImplementation(async ({ data }: any) => ({
        id: 'alert-1',
        ...data,
      }));

      const alerts = await service.recompute('order-1');

      expect(alerts).toHaveLength(1);
      // No "raised" spam: timeline untouched on an identical refresh.
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('amounts-changed: timeline written when refreshed amounts differ', async () => {
      loadOrder({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID', appliedCreditAmount: null }],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED', courierAmount: 1370 },
        ],
      });
      // systemDue now 120, but the stored row still says 500 — amounts changed.
      mockPrisma.codMismatchAlert.findFirst.mockResolvedValue({
        id: 'alert-1',
        orderId: 'order-1',
        consignmentId: 'C1',
        status: 'open',
        courierAmount: 1370,
        systemDue: 500,
      });
      mockPrisma.codMismatchAlert.findMany.mockResolvedValue([
        { id: 'alert-1', orderId: 'order-1', consignmentId: 'C1', status: 'open' },
      ]);
      mockPrisma.codMismatchAlert.update.mockImplementation(async ({ data }: any) => ({
        id: 'alert-1',
        ...data,
      }));

      const alerts = await service.recompute('order-1');

      expect(alerts).toHaveLength(1);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { timeline: expect.arrayContaining([expect.objectContaining({ event: expect.stringContaining('C1') })]) },
      });
    });

    it('clears open alert when consignment cancelled (status cleared, not resolved)', async () => {
      loadOrder({
        total: 1500,
        payments: [],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'CANCELLED', courierAmount: 1500 },
        ],
      });
      mockPrisma.codMismatchAlert.findMany.mockResolvedValue([
        { id: 'a1', orderId: 'order-1', consignmentId: 'C1', status: 'open' },
      ]);
      mockPrisma.codMismatchAlert.update.mockImplementation(async (args: any) => args);

      await service.recompute('order-1');

      expect(mockPrisma.codMismatchAlert.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: 'cleared' },
      });
    });

    it('clears open alert when amounts match again', async () => {
      loadOrder({
        total: 1500,
        payments: [{ amount: 130, status: 'PAID', appliedCreditAmount: null }],
        dispatches: [
          { courier: 'pathao', consignmentId: 'C1', status: 'DISPATCHED', courierAmount: 1370 },
        ],
      });
      // systemDue = 1500 - 130 = 1370 → matches courierAmount → no raise, clear stale open
      mockPrisma.codMismatchAlert.findMany.mockResolvedValue([
        { id: 'a2', orderId: 'order-1', consignmentId: 'C1', status: 'open' },
      ]);
      mockPrisma.codMismatchAlert.update.mockImplementation(async (args: any) => args);

      const alerts = await service.recompute('order-1');

      expect(alerts).toHaveLength(0);
      expect(mockPrisma.codMismatchAlert.create).not.toHaveBeenCalled();
      expect(mockPrisma.codMismatchAlert.update).toHaveBeenCalledWith({
        where: { id: 'a2' },
        data: { status: 'cleared' },
      });
    });

    it('returns [] for unknown order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.recompute('ghost')).resolves.toEqual([]);
      expect(mockPrisma.codMismatchAlert.create).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('writes resolved audit (status, resolvedBy/At, timeline)', async () => {
      mockPrisma.codMismatchAlert.update.mockResolvedValue({
        id: 'alert-1',
        orderId: 'order-1',
        consignmentId: 'C1',
        status: 'resolved',
        resolvedBy: 'user-9',
        resolvedAt: new Date(),
      });
      mockPrisma.order.findUnique.mockResolvedValue({ timeline: [] });

      const row = await service.resolve('alert-1', 'user-9');

      expect(mockPrisma.codMismatchAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: expect.objectContaining({ status: 'resolved', resolvedBy: 'user-9' }),
      });
      expect(row.status).toBe('resolved');
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { timeline: expect.arrayContaining([expect.objectContaining({ event: expect.stringContaining('user-9') })]) },
      });
    });
  });
});
