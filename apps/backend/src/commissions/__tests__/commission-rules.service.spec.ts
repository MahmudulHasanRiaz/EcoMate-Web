import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommissionRulesService } from '../commission-rules.service';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeEffectiveFrom, normalizeEffectiveTo } from '../commission-dates';

/**
 * This service previously had NO unit coverage, which is how the interval-overlap
 * bug survived: a rule whose window contained another active rule's window was
 * reported as non-overlapping, so the write reached the database and died on the
 * partial unique index with a bare constraint error.
 *
 * What is locked here:
 *   - "One active rule per employee per action" is rejected up front with a
 *     message an admin can act on.
 *   - Validity dates are stored as Dhaka day boundaries, inclusive at both ends.
 *   - Responses carry the Dhaka calendar day the operator configured.
 *   - "End now" closes the window to the end of today, idempotently.
 */
describe('CommissionRulesService', () => {
  let service: CommissionRulesService;
  let prisma: any;

  const EMPLOYEE = 'emp-a';

  function baseRule(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rule-1',
      employeeId: EMPLOYEE,
      name: null,
      purpose: 'Confirmed',
      amountType: 'fixed',
      amount: new Prisma.Decimal('50.00'),
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      employee: {
        id: EMPLOYEE,
        employeeId: 'EMP-001',
        department: { name: 'Ops' },
        betterAuthUser: { name: 'Rahim Khan', image: null },
      },
      ...overrides,
    };
  }

  function input(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      employeeId: EMPLOYEE,
      purpose: 'Confirmed',
      amountType: 'fixed' as const,
      amount: 50,
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
      effectiveFrom: null,
      effectiveTo: null,
      ...overrides,
    } as any;
  }

  beforeEach(async () => {
    prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({ id: EMPLOYEE }),
      },
      orderStatus: {
        findFirst: jest.fn().mockResolvedValue({ id: 'status-1' }),
      },
      commissionRuleV2: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionRulesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CommissionRulesService);
  });

  describe('one active rule per employee per action', () => {
    it('rejects a second active rule on the same purpose, naming the conflict', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        { id: 'other', effectiveFrom: null, effectiveTo: null },
      ]);

      await expect(service.create(input())).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.commissionRuleV2.create).not.toHaveBeenCalled();
    });

    // The regression: a NEW window strictly containing an existing one used to
    // be reported as non-overlapping and reach the database.
    it('rejects a window that CONTAINS an existing rule on the same purpose', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        {
          id: 'other',
          effectiveFrom: normalizeEffectiveFrom('2026-01-15'),
          effectiveTo: normalizeEffectiveTo('2026-01-20'),
        },
      ]);

      await expect(
        service.create(input({ effectiveFrom: '2026-01-01', effectiveTo: '2026-01-31' })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.commissionRuleV2.create).not.toHaveBeenCalled();
    });

    it('rejects a partially overlapping window on the same purpose', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        {
          id: 'other',
          effectiveFrom: normalizeEffectiveFrom('2026-01-10'),
          effectiveTo: normalizeEffectiveTo('2026-01-20'),
        },
      ]);

      await expect(
        service.create(input({ effectiveFrom: '2026-01-15', effectiveTo: '2026-01-25' })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows the same employee a second rule on a DIFFERENT purpose', async () => {
      // An existing active rule on Confirmed must not block a rule on Packed —
      // the query is scoped by purpose, so the stub answers accordingly.
      prisma.commissionRuleV2.findMany.mockImplementation((args: any) =>
        args?.where?.purpose === 'Packed'
          ? Promise.resolve([])
          : Promise.resolve([{ id: 'other', effectiveFrom: null, effectiveTo: null }]),
      );
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule({ purpose: 'Packed' }));
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule({ purpose: 'Packed' }));

      await expect(service.create(input({ purpose: 'Packed' }))).resolves.toBeTruthy();
      expect(prisma.commissionRuleV2.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ purpose: 'Packed' }) }),
      );
    });

    it('ignores INACTIVE rules — only an active rule blocks a new one', async () => {
      // The query is filtered server-side; assert the filter is actually sent so
      // an inactive rule can never be returned as a blocker.
      prisma.commissionRuleV2.findMany.mockResolvedValue([]);
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());

      await service.create(input());

      expect(prisma.commissionRuleV2.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ employeeId: EMPLOYEE, purpose: 'Confirmed', isActive: true }),
        }),
      );
    });

    it('does not run the overlap check for a rule created inactive', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        { id: 'other', effectiveFrom: null, effectiveTo: null },
      ]);
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule({ isActive: false }));
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule({ isActive: false }));

      await expect(service.create(input({ isActive: false }))).resolves.toBeTruthy();
      expect(prisma.commissionRuleV2.findMany).not.toHaveBeenCalled();
    });

    it('translates the database constraint violation into the same 409', async () => {
      prisma.commissionRuleV2.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.create(input())).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('validity dates are stored as Dhaka day boundaries', () => {
    beforeEach(() => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([]);
    });

    it('anchors a start date to the beginning of that Dhaka day', async () => {
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());

      await service.create(input({ effectiveFrom: '2026-11-01' }));

      expect(prisma.commissionRuleV2.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            effectiveFrom: new Date('2026-10-31T18:00:00.000Z'),
          }),
        }),
      );
    });

    it('extends an end date to the end of that Dhaka day so the day still pays', async () => {
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());

      await service.create(input({ effectiveFrom: '2026-10-01', effectiveTo: '2026-10-04' }));

      expect(prisma.commissionRuleV2.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            effectiveTo: new Date('2026-10-04T17:59:59.999Z'),
          }),
        }),
      );
    });

    it('accepts a one-day window — start and end on the same date', async () => {
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());

      await expect(
        service.create(input({ effectiveFrom: '2026-10-04', effectiveTo: '2026-10-04' })),
      ).resolves.toBeTruthy();
    });

    it('rejects an end date before the start date', async () => {
      await expect(
        service.create(input({ effectiveFrom: '2026-10-05', effectiveTo: '2026-10-04' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.commissionRuleV2.create).not.toHaveBeenCalled();
    });

    it('stores null bounds as null — an endless rule is a real configuration', async () => {
      prisma.commissionRuleV2.create.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());

      await service.create(input({ effectiveFrom: null, effectiveTo: null }));

      expect(prisma.commissionRuleV2.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ effectiveFrom: null, effectiveTo: null }),
        }),
      );
    });

    it('normalises dates supplied on update too', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.findMany.mockResolvedValue([]);
      prisma.commissionRuleV2.update.mockResolvedValue(baseRule());

      await service.update('rule-1', { effectiveFrom: '2026-11-01' } as any);

      expect(prisma.commissionRuleV2.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ effectiveFrom: new Date('2026-10-31T18:00:00.000Z') }),
        }),
      );
    });

    it('clears a date when explicitly passed null on update', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(
        baseRule({ effectiveTo: new Date('2026-10-04T17:59:59.999Z') }),
      );
      prisma.commissionRuleV2.findMany.mockResolvedValue([]);
      prisma.commissionRuleV2.update.mockResolvedValue(baseRule({ effectiveTo: null }));

      await service.update('rule-1', { effectiveTo: null } as any);

      expect(prisma.commissionRuleV2.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ effectiveTo: null }) }),
      );
    });
  });

  describe('the response carries the Dhaka day, not a UTC timestamp', () => {
    it('emits effectiveFrom as the day the operator configured', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(
        baseRule({ effectiveFrom: new Date('2026-10-31T18:00:00.000Z') }),
      );

      const out = await service.get('rule-1');

      expect(out.effectiveFrom).toBe('2026-11-01');
    });

    it('emits effectiveTo as the same day, not the previous one', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(
        baseRule({ effectiveTo: new Date('2026-10-04T17:59:59.999Z') }),
      );

      const out = await service.get('rule-1');

      expect(out.effectiveTo).toBe('2026-10-04');
    });

    it('emits null for an endless rule', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());

      const out = await service.get('rule-1');

      expect(out.effectiveFrom).toBeNull();
      expect(out.effectiveTo).toBeNull();
    });
  });

  describe('endNow', () => {
    it('closes the window at the end of the current Dhaka day', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.update.mockResolvedValue(baseRule());

      await service.endNow('rule-1');

      const { data } = prisma.commissionRuleV2.update.mock.calls[0][0];
      // End of today in Dhaka: the rule still pays for today's own orders.
      const end = data.effectiveTo as Date;
      expect(end.getTime()).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);
      expect(end.getUTCHours()).toBe(17);
      expect(end.getUTCMinutes()).toBe(59);
    });

    it('never deletes or deactivates the rule — it stays auditable', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.update.mockResolvedValue(baseRule());

      await service.endNow('rule-1');

      const { data } = prisma.commissionRuleV2.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('isActive');
    });

    it('is idempotent — re-ending an already-ended rule changes nothing', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(
        baseRule({ effectiveTo: new Date('2026-01-15T17:59:59.999Z') }),
      );

      await service.endNow('rule-1');

      expect(prisma.commissionRuleV2.update).not.toHaveBeenCalled();
    });

    it('404s for a rule that does not exist', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(null);

      await expect(service.endNow('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('validation guards', () => {
    it('requires the employee to exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.create(input())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires a commissionable purpose', async () => {
      await expect(service.create(input({ purpose: 'Nonsense' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('requires the purpose to be a real order status in this installation', async () => {
      prisma.orderStatus.findFirst.mockResolvedValue(null);

      await expect(service.create(input())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a zero or negative amount', async () => {
      await expect(service.create(input({ amount: 0 }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(input({ amount: -5 }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a percentage above 100', async () => {
      await expect(
        service.create(input({ amountType: 'percent', amount: 101 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a count and a period to be set together', async () => {
      await expect(
        service.create(input({ minimumCount: 10, thresholdPeriod: null })),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.create(input({ minimumCount: null, thresholdPeriod: 'daily' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a negative minimum order amount or cap', async () => {
      await expect(service.create(input({ minOrderAmount: -1 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.create(input({ capPerOrder: -1 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    // A partial update must not be able to produce a rule that create would
    // have rejected — the merged shape is what gets validated.
    it('validates the MERGED shape on update, not just the supplied fields', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(
        baseRule({ minimumCount: 10, thresholdPeriod: 'daily' }),
      );
      prisma.commissionRuleV2.findMany.mockResolvedValue([]);

      await expect(
        service.update('rule-1', { minimumCount: null } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.commissionRuleV2.update).not.toHaveBeenCalled();
    });

    it('404s on update of a missing rule', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { amount: 10 } as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setActive', () => {
    it('re-runs the overlap check when re-activating', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule({ isActive: false }));
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        { id: 'other', effectiveFrom: null, effectiveTo: null },
      ]);

      await expect(service.setActive('rule-1', true)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.commissionRuleV2.update).not.toHaveBeenCalled();
    });

    it('does not check for overlap when deactivating', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule());
      prisma.commissionRuleV2.update.mockResolvedValue(baseRule({ isActive: false }));

      await service.setActive('rule-1', false);

      expect(prisma.commissionRuleV2.findMany).not.toHaveBeenCalled();
    });

    it('excludes the rule itself from the overlap check', async () => {
      prisma.commissionRuleV2.findUnique.mockResolvedValue(baseRule({ isActive: false }));
      prisma.commissionRuleV2.findMany.mockResolvedValue([]);
      prisma.commissionRuleV2.update.mockResolvedValue(baseRule());

      await service.setActive('rule-1', true);

      expect(prisma.commissionRuleV2.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'rule-1' } }),
        }),
      );
    });
  });
});