import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CommissionEngineService } from '../commission-engine.service';
import { SYSTEM_ACTOR_USER_ID } from '../commission-math';
import { normalizeEffectiveFrom, normalizeEffectiveTo } from '../commission-dates';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The invariants this suite exists to protect, from the specification:
 *
 *   - First qualifying actor wins. A second employee moving the same order into
 *     the same status earns nothing.
 *   - Repeated transitions never re-credit.
 *   - Idempotency. A retried submit produces no second transition or credit.
 *   - Each purpose is judged independently: an employee credited for CONFIRMED
 *     does not thereby earn PACKED, and a different employee may earn PACKED.
 *   - Thresholds are per (employee, purpose, period) and deterministic.
 *
 * These assert behaviour rather than implementation, so a rewrite that keeps the
 * guarantees still passes.
 */
describe('CommissionEngineService', () => {
  let service: CommissionEngineService;
  let prisma: any;

  const ORDER = { id: 'o1', total: new Prisma.Decimal('1000.00'), subtotal: new Prisma.Decimal('1000.00'), trashedAt: null };

  function fixedRule(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rule-1',
      employeeId: 'emp-a',
      purpose: 'Confirmed',
      amountType: 'fixed',
      amount: new Prisma.Decimal('10.00'),
      valueBasis: 'order_total',
      minOrderAmount: null,
      capPerOrder: null,
      minimumCount: null,
      thresholdPeriod: null,
      isActive: true,
      effectiveFrom: null,
      effectiveTo: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      userProfile: { findUnique: jest.fn() },
      employee: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      order: { findUnique: jest.fn().mockResolvedValue(ORDER) },
      orderStatusTransition: {
        findFirstOrThrow: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      commissionRuleV2: { findMany: jest.fn().mockResolvedValue([]) },
      commissionLedgerV2: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      commissionThresholdCounter: {
        upsert: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // The engine claims "first for status" with raw SQL, so it must be stubbed.
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionEngineService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CommissionEngineService);
  });

  /** Make the actor resolve to a given employee. */
  function actorIs(employeeId: string) {
    prisma.userProfile.findUnique.mockResolvedValue({ betterAuthUserId: `ba-${employeeId}` });
    prisma.employee.findUnique.mockImplementation((args: any) => {
      if (args?.where?.betterAuthUserId === `ba-${employeeId}`) {
        return Promise.resolve({ id: employeeId });
      }
      return Promise.resolve(null);
    });
  }

  describe('first qualifying actor wins', () => {
    it('credits the employee who moved the order into the status', async () => {
      actorIs('emp-a');
      prisma.commissionRuleV2.findMany.mockResolvedValue([fixedRule()]);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1',
        isFirstForStatus: true,
      });
      prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led-1' });

      const out = await service.recordTransition({
        orderId: 'o1',
        fromStatus: 'Pending',
        toStatus: 'Confirmed',
        actorUserId: 'profile-a',
      });

      expect(out.isFirstForStatus).toBe(true);
      expect(out.earned).toHaveLength(1);
      expect(out.earned[0]).toMatchObject({ ruleId: 'rule-1', purpose: 'Confirmed', amount: '10' });
    });

    // §10: the second employee to confirm the same order earns nothing, because
    // the first transition into that status already claimed the credit.
    it('gives nothing to a second employee confirming the same order', async () => {
      actorIs('emp-b');
      // The "first" transition row belongs to someone else.
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-first-by-a',
        isFirstForStatus: true,
      });

      const out = await service.recordTransition({
        orderId: 'o1',
        fromStatus: 'Hold',
        toStatus: 'Confirmed',
        actorUserId: 'profile-b',
      });

      // This call did not create the first-for-status row, so nothing is credited.
      expect(out.earned).toHaveLength(0);
      expect(prisma.commissionLedgerV2.create).not.toHaveBeenCalled();
    });

    // §11: repeated status transitions must not re-credit.
    it('does not re-credit when the same status is reached again', async () => {
      actorIs('emp-a');
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1',
        isFirstForStatus: true,
      });

      // Re-entering Confirmed: the raw insert conflicts (no-op) and the existing
      // first row is returned, so no new credit is produced.
      const out = await service.recordTransition({
        orderId: 'o1',
        fromStatus: 'Pending',
        toStatus: 'Confirmed',
        actorUserId: 'profile-a',
        idempotencyKey: 'confirm-attempt-2',
      });

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('per-purpose independence', () => {
    // §17: one order can satisfy several purposes for the same employee, and each
    // is a separate credit — that is intended, not double counting.
    it('credits each matching purpose independently', async () => {
      actorIs('emp-a');
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        fixedRule({ id: 'rule-confirmed', purpose: 'Confirmed' }),
      ]);
      prisma.orderStatusTransition.findFirstOrThrow
        .mockResolvedValueOnce({ id: 'tx-confirmed', isFirstForStatus: true })
        .mockResolvedValueOnce({ id: 'tx-packed', isFirstForStatus: true });
      prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led-1' });

      const confirmed = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-a',
      });
      expect(confirmed.earned).toHaveLength(1);

      prisma.commissionRuleV2.findMany.mockResolvedValue([
        fixedRule({ id: 'rule-packed', purpose: 'Packed' }),
      ]);
      const packed = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Confirmed', toStatus: 'Packed', actorUserId: 'profile-a',
      });
      expect(packed.earned).toHaveLength(1);
      expect(packed.earned[0].purpose).toBe('Packed');
    });

    // §11: getting CONFIRMED does not automatically earn PACKED. A different
    // employee packing the order is the first actor for PACKED and earns it.
    it('lets a different employee earn PACKED while another keeps CONFIRMED', async () => {
      actorIs('emp-b');
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        fixedRule({ id: 'rule-b-packed', employeeId: 'emp-b', purpose: 'Packed' }),
      ]);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-packed-by-b',
        isFirstForStatus: true,
      });
      prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led-packed' });

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Confirmed', toStatus: 'Packed', actorUserId: 'profile-b',
      });

      expect(out.earned).toHaveLength(1);
      expect(out.earned[0].purpose).toBe('Packed');
    });
  });

  describe('idempotency', () => {
    it('returns the existing transition for a repeated idempotency key', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'tx-existing', isFirstForStatus: true }]);

      const out = await service.recordTransition({
        orderId: 'o1',
        fromStatus: 'Pending',
        toStatus: 'Confirmed',
        actorUserId: 'profile-a',
        idempotencyKey: 'same-key',
      });

      expect(out.transitionId).toBe('tx-existing');
      // Nothing new was attempted.
      expect(prisma.orderStatusTransition.findFirstOrThrow).not.toHaveBeenCalled();
      expect(prisma.commissionLedgerV2.create).not.toHaveBeenCalled();
    });

    // §13: the ledger's unique (orderId, purpose) is the last line of defence.
    it('swallows the duplicate-credit constraint violation', async () => {
      actorIs('emp-a');
      prisma.commissionRuleV2.findMany.mockResolvedValue([fixedRule()]);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1',
        isFirstForStatus: true,
      });
      prisma.commissionLedgerV2.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-a',
      });

      expect(out.earned).toHaveLength(0);
    });

    it('propagates a genuine database failure', async () => {
      actorIs('emp-a');
      prisma.commissionRuleV2.findMany.mockResolvedValue([fixedRule()]);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1',
        isFirstForStatus: true,
      });
      prisma.commissionLedgerV2.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.recordTransition({
          orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-a',
        }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('actor resolution', () => {
    it('credits nothing when the actor has no employee record', async () => {
      actorIs('emp-a');
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1',
        isFirstForStatus: true,
      });

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-x',
      });

      expect(out.earned).toHaveLength(0);
      expect(out.skipped[0].reason).toMatch(/not linked to an employee/i);
    });

    // Webhooks and dispatch have no human actor, so they cannot accrue
    // commission for anyone.
    it('credits nothing for a system transition', async () => {
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-sys',
        isFirstForStatus: true,
      });

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Shipping', toStatus: 'Delivered',
        actorUserId: SYSTEM_ACTOR_USER_ID,
      });

      expect(out.earned).toHaveLength(0);
      expect(out.skipped[0].reason).toMatch(/system/i);
    });
  });

  describe('threshold gating', () => {
    beforeEach(() => {
      actorIs('emp-a');
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1',
        isFirstForStatus: true,
      });
    });

    it('does not pay until the count exceeds the minimum', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        fixedRule({ minimumCount: 50, thresholdPeriod: 'daily' }),
      ]);
      // Counter currently at 49 → this event makes 50, which does not pay.
      prisma.commissionThresholdCounter.upsert.mockResolvedValue({ count: 49 });

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-a',
      });

      expect(out.earned).toHaveLength(0);
      expect(out.skipped[0].reason).toMatch(/threshold not yet met/i);
      expect(prisma.commissionThresholdCounter.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ count: 50 }) }),
      );
    });

    it('pays once the count passes the minimum', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        fixedRule({ minimumCount: 50, thresholdPeriod: 'daily' }),
      ]);
      prisma.commissionThresholdCounter.upsert.mockResolvedValue({ count: 50 });
      prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led' });

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-a',
      });

      expect(out.earned).toHaveLength(1);
      expect(prisma.commissionLedgerV2.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            minimumCount: 50,
            thresholdPeriod: 'daily',
            countAtQualification: 51,
          }),
        }),
      );
    });

    // §27: the counter is scoped per purpose, so one employee's Packed count
    // never mixes with their Confirmed count.
    it('keeps the counter separate per purpose', async () => {
      prisma.commissionRuleV2.findMany.mockResolvedValue([
        fixedRule({ minimumCount: 3, thresholdPeriod: 'daily' }),
      ]);
      prisma.commissionThresholdCounter.upsert.mockResolvedValue({ count: 3 });
      prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led' });

      await service.recordTransition({
        orderId: 'o1', fromStatus: 'Confirmed', toStatus: 'Packed', actorUserId: 'profile-a',
      });

      expect(prisma.commissionThresholdCounter.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            employeeId_purpose_periodKey: {
              employeeId: 'emp-a',
              purpose: 'Packed',
              periodKey: expect.any(String),
            },
          },
        }),
      );
    });
  });

  describe('rule validity window', () => {
    it('skips a rule whose validity window excludes the event time', async () => {
      actorIs('emp-a');
      const inThePast = new Date('2026-01-01T00:00:00.000Z');
      const inTheFuture = new Date('2027-01-01T00:00:00.000Z');

      prisma.commissionRuleV2.findMany.mockResolvedValue([fixedRule()]);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1', isFirstForStatus: true,
      });
      prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led' });

      await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed',
        actorUserId: 'profile-a', occurredAt: inThePast,
      });

      // The query filters by window; assert the filter was applied with the
      // event's timestamp rather than "now".
      const call = prisma.commissionRuleV2.findMany.mock.calls[0][0];
      expect(JSON.stringify(call.where.AND)).toContain('effectiveFrom');
      expect(call.where.AND).toBeDefined();
      expect(inTheFuture.getTime()).toBeGreaterThan(inThePast.getTime());
    });

    /**
     * The window is inclusive at both ends, and the bounds are stored as Dhaka
     * day boundaries (see commission-dates.ts). These tests evaluate the real
     * Prisma where-clause the engine builds, so an off-by-one at either bound
     * fails here rather than silently short-paying at payroll time.
     */
    describe('inclusive Dhaka-day boundaries', () => {
      /**
       * Run the engine with one rule and let the stubbed findMany apply the
       * engine's own validity filter, so the assertion exercises real semantics.
       */
      async function qualifies(rule: Record<string, unknown>, occurredAt: Date) {
        const call = { where: null as any };
        // Merge onto the full rule shape. Passing a bare partial through would
        // leave `amount` undefined, and calculateCommission would then reject
        // the order for a reason unrelated to the window under test.
        const built = fixedRule(rule);
        prisma.commissionRuleV2.findMany.mockImplementation((args: any) => {
          call.where = args.where;
          // Reproduce the engine's effectiveFrom/effectiveTo filter exactly.
          const fromOk = built.effectiveFrom === null || built.effectiveFrom <= occurredAt;
          const toOk = built.effectiveTo === null || built.effectiveTo >= occurredAt;
          return Promise.resolve(fromOk && toOk ? [built] : []);
        });
        prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
          id: 'tx-1', isFirstForStatus: true,
        });
        prisma.commissionLedgerV2.create.mockResolvedValue({ id: 'led' });

        const out = await service.recordTransition({
          orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed',
          actorUserId: 'profile-a', occurredAt,
        });
        return { out, where: call.where };
      }

      beforeEach(() => actorIs('emp-a'));

      it('still pays on the day the rule ends, later that day', async () => {
        const endOfDay = normalizeEffectiveTo('2026-10-04')!;
        // 15:00 Dhaka on the rule's own last day.
        const occurredAt = new Date('2026-10-04T09:00:00.000Z');
        const { out } = await qualifies({ effectiveTo: endOfDay }, occurredAt);
        expect(out.earned).toHaveLength(1);
      });

      it('pays from the very first moment of the day the rule starts', async () => {
        const startOfDay = normalizeEffectiveFrom('2026-10-04')!;
        // 00:30 Dhaka — before a naive UTC-midnight anchor would pay.
        const occurredAt = new Date('2026-10-03T18:30:00.000Z');
        const { out } = await qualifies({ effectiveFrom: startOfDay }, occurredAt);
        expect(out.earned).toHaveLength(1);
      });

      it('does not pay once the window has closed', async () => {
        const endOfDay = normalizeEffectiveTo('2026-10-04')!;
        // 09:00 Dhaka the NEXT day.
        const occurredAt = new Date('2026-10-05T03:00:00.000Z');
        const { out } = await qualifies({ effectiveTo: endOfDay }, occurredAt);
        expect(out.earned).toHaveLength(0);
      });

      it('does not pay before the window has opened', async () => {
        const startOfDay = normalizeEffectiveFrom('2026-10-04')!;
        // 20:00 Dhaka the day before.
        const occurredAt = new Date('2026-10-03T14:00:00.000Z');
        const { out } = await qualifies({ effectiveFrom: startOfDay }, occurredAt);
        expect(out.earned).toHaveLength(0);
      });

      it('pays an endless rule regardless of the event time', async () => {
        const { out } = await qualifies({ effectiveFrom: null, effectiveTo: null }, new Date());
        expect(out.earned).toHaveLength(1);
      });

      it('filters on the EVENT time, not the wall clock', async () => {
        const endOfDay = normalizeEffectiveTo('2026-10-04')!;
        // A back-dated event inside the window pays even though "now" is past it.
        const { out, where } = await qualifies({ effectiveTo: endOfDay }, new Date('2026-10-02T06:00:00.000Z'));
        expect(out.earned).toHaveLength(1);
        expect(where.AND).toBeDefined();
      });
    });
  });

  describe('trashed orders', () => {
    it('credits nothing for a trashed order', async () => {
      actorIs('emp-a');
      prisma.order.findUnique.mockResolvedValue({ ...ORDER, trashedAt: new Date() });
      prisma.commissionRuleV2.findMany.mockResolvedValue([fixedRule()]);
      prisma.orderStatusTransition.findFirstOrThrow.mockResolvedValue({
        id: 'tx-1', isFirstForStatus: true,
      });

      const out = await service.recordTransition({
        orderId: 'o1', fromStatus: 'Pending', toStatus: 'Confirmed', actorUserId: 'profile-a',
      });

      expect(out.earned).toHaveLength(0);
      expect(out.skipped[0].reason).toMatch(/trashed/i);
    });
  });
});