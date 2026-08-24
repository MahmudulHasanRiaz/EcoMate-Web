import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CommissionsService } from '../commissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

describe('CommissionsService', () => {
  let service: CommissionsService;
  let prisma: any;

  const confirmedId = 'status-confirmed';

  const prismaMock = {
    employee: {
      findUnique: jest.fn(),
    },
    orderStatus: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: confirmedId }),
    },
    order: {
      findUnique: jest.fn(),
    },
    commissionRule: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    commissionEarning: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'earning-1',
        employeeId: 'emp-1',
        ruleId: 'rule-1',
        orderId: 'order-1',
        amount: '100',
        status: 'approved',
      }),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100 } }),
    },
    commissionReversal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'rev-1',
        commissionEarningId: 'earning-1',
        orderId: 'order-1',
        amount: '100',
        reason: 'Order cancelled',
        refundedAmount: null,
        reversedById: 'actor-1',
      }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 25 } }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<CommissionsService>(CommissionsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
    prismaMock.orderStatus.findFirst.mockResolvedValue({ id: confirmedId });
    prismaMock.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      employeeId: 'EMP-1',
    });
    prismaMock.commissionEarning.createMany.mockResolvedValue({ count: 1 });
    prismaMock.commissionEarning.findUnique.mockResolvedValue({
      id: 'earning-1',
      employeeId: 'emp-1',
      ruleId: 'rule-1',
      orderId: 'order-1',
      amount: '100',
      status: 'approved',
    });
    prismaMock.commissionReversal.findFirst.mockResolvedValue(null);
    prismaMock.commissionReversal.create.mockResolvedValue({
      id: 'rev-1',
      commissionEarningId: 'earning-1',
      orderId: 'order-1',
      amount: '100',
      reason: 'Order cancelled',
      refundedAmount: null,
      reversedById: 'actor-1',
    });
  });

  describe('rule CRUD', () => {
    it('createRule persists a rule with actor id', async () => {
      prismaMock.commissionRule.create.mockResolvedValue({
        id: 'rule-1',
        employeeId: 'emp-1',
      });
      const result = await service.createRule(
        {
          employeeId: 'emp-1',
          amountType: 'percent' as any,
          amount: 5,
        },
        'actor-1',
      );
      expect(result).toEqual({ id: 'rule-1', employeeId: 'emp-1' });
      expect(prismaMock.commissionRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeId: 'emp-1',
            amountType: 'percent',
            amount: 5,
            isActive: true,
            createdById: 'actor-1',
          }),
        }),
      );
    });

    it('createRule validates employee existence', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.createRule({
          employeeId: 'nope',
          amountType: 'fixed' as any,
          amount: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('createRule validates triggerStatusId', async () => {
      prismaMock.orderStatus.findUnique.mockResolvedValue(null);
      await expect(
        service.createRule({
          employeeId: 'emp-1',
          amountType: 'fixed' as any,
          amount: 10,
          triggerStatusId: 'bad-status',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updateRule updates only provided fields', async () => {
      prismaMock.commissionRule.findUnique.mockResolvedValue({
        id: 'rule-1',
        employeeId: 'emp-1',
      });
      prismaMock.commissionRule.update.mockResolvedValue({ id: 'rule-1' });
      await service.updateRule('rule-1', { amount: 7 });
      expect(prismaMock.commissionRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { amount: 7 },
      });
    });

    it('updateRule throws for missing rule', async () => {
      prismaMock.commissionRule.findUnique.mockResolvedValue(null);
      await expect(
        service.updateRule('rule-1', { amount: 7 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('setActive toggles isActive', async () => {
      prismaMock.commissionRule.findUnique.mockResolvedValue({
        id: 'rule-1',
      });
      prismaMock.commissionRule.update.mockResolvedValue({ id: 'rule-1' });
      await service.setActive('rule-1', false);
      expect(prismaMock.commissionRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { isActive: false },
      });
    });

    it('deleteRule removes the rule', async () => {
      prismaMock.commissionRule.findUnique.mockResolvedValue({
        id: 'rule-1',
      });
      prismaMock.commissionRule.delete.mockResolvedValue({ id: 'rule-1' });
      const result = await service.deleteRule('rule-1');
      expect(result).toEqual({ success: true, id: 'rule-1' });
    });
  });

  describe('processOrderCommissions', () => {
    const baseOrder = (statusId: string, total = 1000) => ({
      id: 'order-1',
      statusId,
      total,
      trashedAt: null,
    });

    const runHook = (order: any, rules: any[]) => {
      prismaMock.order.findUnique.mockResolvedValue(order);
      prismaMock.commissionRule.findMany.mockResolvedValue(rules);
      return service.processOrderCommissions('order-1');
    };

    it('creates a percent earning for a Confirmed order (null trigger = default confirmed)', async () => {
      const count = await runHook(baseOrder(confirmedId), [
        {
          id: 'rule-1',
          employeeId: 'emp-1',
          triggerStatusId: null,
          amountType: 'percent',
          amount: 5,
          minOrderAmount: null,
          capPerOrder: null,
        },
      ]);
      expect(count).toBe(1);
      expect(prismaMock.commissionEarning.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDuplicates: true,
          data: [
            expect.objectContaining({
              employeeId: 'emp-1',
              ruleId: 'rule-1',
              orderId: 'order-1',
              amount: new Prisma.Decimal(50),
              status: 'approved',
            }),
          ],
        }),
      );
    });

    it('creates a fixed earning', async () => {
      const count = await runHook(baseOrder(confirmedId), [
        {
          id: 'rule-2',
          employeeId: 'emp-2',
          triggerStatusId: null,
          amountType: 'fixed',
          amount: 100,
          minOrderAmount: null,
          capPerOrder: null,
        },
      ]);
      expect(count).toBe(1);
      const rows = prismaMock.commissionEarning.createMany.mock.calls[0][0].data;
      expect(rows[0].amount.toString()).toBe('100');
    });

    it('skips rule when order total below minOrderAmount', async () => {
      const count = await runHook(baseOrder(confirmedId, 500), [
        {
          id: 'rule-3',
          employeeId: 'emp-1',
          triggerStatusId: null,
          amountType: 'fixed',
          amount: 100,
          minOrderAmount: 2000,
          capPerOrder: null,
        },
      ]);
      expect(count).toBe(0);
      expect(prismaMock.commissionEarning.createMany).not.toHaveBeenCalled();
    });

    it('caps the earning at capPerOrder', async () => {
      await runHook(baseOrder(confirmedId), [
        {
          id: 'rule-4',
          employeeId: 'emp-1',
          triggerStatusId: null,
          amountType: 'percent',
          amount: 10,
          minOrderAmount: null,
          capPerOrder: 30,
        },
      ]);
      const rows = prismaMock.commissionEarning.createMany.mock.calls[0][0].data;
      expect(rows[0].amount.toString()).toBe('30');
    });

    it('supports multiple employees via distinct rules', async () => {
      const count = await runHook(baseOrder(confirmedId), [
        {
          id: 'rule-a',
          employeeId: 'emp-1',
          triggerStatusId: null,
          amountType: 'percent',
          amount: 5,
          minOrderAmount: null,
          capPerOrder: null,
        },
        {
          id: 'rule-b',
          employeeId: 'emp-2',
          triggerStatusId: null,
          amountType: 'percent',
          amount: 3,
          minOrderAmount: null,
          capPerOrder: null,
        },
      ]);
      expect(count).toBe(2);
      const rows = prismaMock.commissionEarning.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
    });

    it('null-trigger rule does NOT apply to non-confirmed orders', async () => {
      const count = await runHook(baseOrder('status-shipped'), [
        {
          id: 'rule-5',
          employeeId: 'emp-1',
          triggerStatusId: null,
          amountType: 'fixed',
          amount: 100,
          minOrderAmount: null,
          capPerOrder: null,
        },
      ]);
      expect(count).toBe(0);
      expect(prismaMock.commissionEarning.createMany).not.toHaveBeenCalled();
    });

    it('explicit triggerStatusId rule applies to the matching status', async () => {
      const count = await runHook(baseOrder('status-shipped'), [
        {
          id: 'rule-6',
          employeeId: 'emp-1',
          triggerStatusId: 'status-shipped',
          amountType: 'fixed',
          amount: 100,
          minOrderAmount: null,
          capPerOrder: null,
        },
      ]);
      expect(count).toBe(1);
    });

    it('is idempotent — re-processing the same order re-issues createMany with skipDuplicates', async () => {
      const rules = [
        {
          id: 'rule-1',
          employeeId: 'emp-1',
          triggerStatusId: null,
          amountType: 'fixed',
          amount: 100,
          minOrderAmount: null,
          capPerOrder: null,
        },
      ];
      const first = await runHook(baseOrder(confirmedId), rules);
      const second = await runHook(baseOrder(confirmedId), rules);
      expect(first).toBe(1);
      expect(second).toBe(1);
      expect(prismaMock.commissionEarning.createMany).toHaveBeenCalledTimes(2);
      expect(
        prismaMock.commissionEarning.createMany.mock.calls.every(
          (c: any[]) => c[0].skipDuplicates === true,
        ),
      ).toBe(true);
    });

    it('returns 0 for a trashed order without touching rules', async () => {
      const count = await runHook(
        { ...baseOrder(confirmedId), trashedAt: new Date() },
        [],
      );
      expect(count).toBe(0);
      expect(prismaMock.commissionRule.findMany).not.toHaveBeenCalled();
    });
  });

  describe('reverseEarning', () => {
    it('reverses the full earning with reason + actor when no refundedAmount', async () => {
      const result = await service.reverseEarning(
        'earning-1',
        { orderId: 'order-1', reason: 'Order cancelled' },
        'actor-1',
      );

      expect(result.id).toBe('rev-1');
      expect(prismaMock.commissionEarning.findUnique).toHaveBeenCalledWith({
        where: { id: 'earning-1' },
      });
      expect(prismaMock.commissionReversal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          commissionEarningId: 'earning-1',
          orderId: 'order-1',
          amount: new Prisma.Decimal(100),
          reason: 'Order cancelled',
          refundedAmount: null,
          reversedById: 'actor-1',
        }),
      });
    });

    it('reverses a proportional share of the earning (order 1000, refund 250 → 25%)', async () => {
      prismaMock.order.findUnique.mockResolvedValue({ total: 1000 });
      prismaMock.commissionReversal.create.mockResolvedValue({
        id: 'rev-partial',
        amount: '25',
      });

      const result = await service.reverseEarning(
        'earning-1',
        { orderId: 'order-1', reason: 'Partial refund', refundedAmount: 250 },
        'actor-9',
      );

      const createCall = (
        prismaMock.commissionReversal.create as jest.Mock
      ).mock.calls[0][0].data;
      expect(Number(createCall.amount.toString())).toBe(25);
      expect(Number(createCall.refundedAmount)).toBe(250);
      expect(result.id).toBe('rev-partial');
    });

    it('caps a refund larger than the order at a full reversal (ratio > 1 → 1)', async () => {
      prismaMock.order.findUnique.mockResolvedValue({ total: 100 });
      const result = await service.reverseEarning(
        'earning-1',
        { orderId: 'order-1', reason: 'Oversized refund', refundedAmount: 500 },
      );
      const data = (
        prismaMock.commissionReversal.create as jest.Mock
      ).mock.calls[0][0].data;
      expect(Number(data.amount.toString())).toBe(100);
      expect(result).toBeDefined();
    });

    it('falls back to min(earning, refundedAmount) when the order row is missing', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);
      await service.reverseEarning(
        'earning-1',
        { orderId: 'order-1', reason: 'Missing order', refundedAmount: 40 },
      );
      const data = (
        prismaMock.commissionReversal.create as jest.Mock
      ).mock.calls[0][0].data;
      expect(Number(data.amount.toString())).toBe(40);
    });

    it('is idempotent for the same (earningId, orderId) — returns the existing reversal', async () => {
      const existing = { id: 'rev-existing', amount: '100' };
      prismaMock.commissionReversal.findFirst.mockResolvedValue(existing);

      const result = await service.reverseEarning('earning-1', {
        orderId: 'order-1',
        reason: 'Order cancelled',
      });

      expect(result).toEqual(existing);
      expect(prismaMock.commissionReversal.create).not.toHaveBeenCalled();
    });

    it('conflicts (409) when a manal reversal already exists for an earning', async () => {
      prismaMock.commissionReversal.findFirst.mockResolvedValue({
        id: 'rev-manual',
      });

      await expect(
        service.reverseEarning('earning-1', { reason: 'Manual reversal' }),
      ).rejects.toThrow('This commission is already reversed');
    });

    it('throws 404 when the earning is missing', async () => {
      prismaMock.commissionEarning.findUnique.mockResolvedValue(null);
      await expect(
        service.reverseEarning('earning-nope', { reason: 'why' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects reversing a DRAFT earning (400)', async () => {
      prismaMock.commissionEarning.findUnique.mockResolvedValue({
        id: 'earning-2',
        status: 'draft',
        amount: '50',
        orderId: 'order-1',
      });
      await expect(
        service.reverseEarning('earning-2', { reason: 'draft' }),
      ).rejects.toThrow(/[Dd]raft earnings cannot be reversed/);
    });

    it('requires a reason', async () => {
      await expect(
        service.reverseEarning('earning-1', { reason: '   ' } as any),
      ).rejects.toThrow('reason is required');
    });
  });

  describe('reverseForOrder (order hook)', () => {
    it('reverses every approved earning on the order and reports counts', async () => {
      prismaMock.commissionEarning.findMany.mockResolvedValue([
        { id: 'earning-a' },
        { id: 'earning-b' },
      ]);
      prismaMock.commissionReversal.create.mockResolvedValue({ id: 'rev-x' });

      const result = await service.reverseForOrder(
        'order-1',
        undefined,
        'Order cancelled',
      );

      expect(result).toEqual({ reversed: 2, already: 0 });
      expect(prismaMock.commissionEarning.findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1', status: 'approved' },
        select: { id: true },
      });
      const createData = prismaMock.commissionReversal.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(createData.every((d: any) => d.orderId === 'order-1')).toBe(true);
      expect(
        createData.every((d: any) => d.reason === 'Order cancelled'),
      ).toBe(true);
    });

    it('counts already-reversed earnings as already (skips, never throws)', async () => {
      prismaMock.commissionEarning.findMany.mockResolvedValue([
        { id: 'earning-a' },
        { id: 'earning-b' },
      ]);
      prismaMock.commissionReversal.create
        .mockResolvedValueOnce({ id: 'rev-a' })
        .mockRejectedValueOnce(new Error('This commission is already reversed'));

      const result = await service.reverseForOrder('order-1', undefined, 'x');
      expect(result).toEqual({ reversed: 1, already: 1 });
    });

    it('returns zero when the lookup fails (resilient)', async () => {
      prismaMock.commissionEarning.findMany.mockRejectedValue(
        new Error('db down'),
      );
      const result = await service.reverseForOrder('order-1');
      expect(result).toEqual({ reversed: 0, already: 0 });
    });
  });

  describe('listEarnings filters + totals', () => {
    beforeEach(() => {
      prismaMock.commissionEarning.findMany.mockResolvedValue([]);
      prismaMock.commissionEarning.count.mockResolvedValue(0);
      prismaMock.commissionEarning.aggregate.mockResolvedValue({
        _sum: { amount: 500 },
      });
      prismaMock.commissionReversal.aggregate.mockResolvedValue({
        _sum: { amount: 50 },
      });
    });

    it('maps reversed=true to a some-reversals filter', async () => {
      await service.listEarnings({ reversed: 'true' }, 1, 10);
      const where = (
        prismaMock.commissionEarning.findMany as jest.Mock
      ).mock.calls[0][0].where;
      expect(where.reversals).toEqual({ some: {} });
    });

    it('maps reversed=false to a none-reversals filter', async () => {
      await service.listEarnings({ reversed: 'false' }, 1, 10);
      const where = (
        prismaMock.commissionEarning.findMany as jest.Mock
      ).mock.calls[0][0].where;
      expect(where.reversals).toEqual({ none: {} });
    });

    it('maps inPayroll true/false to payslipId present/absent', async () => {
      await service.listEarnings({ inPayroll: 'true' }, 1, 10);
      let where = (
        prismaMock.commissionEarning.findMany as jest.Mock
      ).mock.calls[0][0].where;
      expect(where.payslipId).toEqual({ not: null });

      await service.listEarnings({ inPayroll: 'false' }, 1, 10);
      where = (
        prismaMock.commissionEarning.findMany as jest.Mock
      ).mock.calls[1][0].where;
      expect(where.payslipId).toBeNull();
    });

    it('computes totals (commission − reversed = net payable)', async () => {
      const result = await service.listEarnings({}, 1, 10);
      expect(result.meta.totals).toEqual({
        totalCommission: 500,
        totalReversed: 50,
        netPayable: 450,
      });
    });

    it('includes order, rule and reversals on each row', async () => {
      prismaMock.commissionEarning.findMany.mockResolvedValue([
        {
          id: 'earning-1',
          employeeId: 'emp-1',
          amount: '100',
          order: { id: 'order-1', displayId: 'ORD-1', total: 1000 },
          rule: { id: 'rule-1', amountType: 'percent', amount: 10 },
          reversals: [{ id: 'rev-1', amount: '100', reason: 'cancelled' }],
        },
      ]);
      const result = await service.listEarnings({}, 1, 10);
      expect(result.data[0].order.displayId).toBe('ORD-1');
      expect(result.data[0].reversals).toHaveLength(1);
      const include = (
        prismaMock.commissionEarning.findMany as jest.Mock
      ).mock.calls[0][0].include;
      expect(include.reversals).toBeDefined();
      expect(include.rule).toBe(true);
    });
  });
});
