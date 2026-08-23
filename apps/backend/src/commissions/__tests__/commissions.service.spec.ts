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
      count: jest.fn().mockResolvedValue(0),
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
});
