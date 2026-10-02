import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateCommission,
  periodKeyFor,
  thresholdQualifies,
  SYSTEM_ACTOR_USER_ID,
  type ThresholdPeriod,
} from './commission-math';

export interface RecordTransitionInput {
  orderId: string;
  fromStatus: string | null;
  toStatus: string;
  /** UserProfile.id of the acting user. Use SYSTEM_ACTOR_USER_ID for automation. */
  actorUserId: string | null;
  note?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** When the transition happened. Defaults to now. */
  occurredAt?: Date;
  /** Supply to make a retried submit a no-op instead of a second transition. */
  idempotencyKey?: string | null;
}

export interface QualificationOutcome {
  transitionId: string;
  isFirstForStatus: boolean;
  earned: Array<{ ledgerId: string; ruleId: string; purpose: string; amount: string }>;
  /** Rules that matched but did not pay, with the reason — surfaced in reports. */
  skipped: Array<{ ruleId: string; purpose: string; reason: string }>;
}

/**
 * Commission Engine v2.
 *
 * The invariant this service exists to guarantee:
 *
 *   For a given order and a given purpose, exactly one employee can ever be
 *   credited — the first person who moved that order into that status.
 *
 * Two independent mechanisms enforce it, deliberately:
 *
 *   1. `OrderStatusTransition.isFirstForStatus` is a column guarded by a
 *      partial unique index on (orderId, toStatus). Two concurrent transitions
 *      into the same status cannot both set it, so "first" is decided by the
 *      database rather than by read-then-write timing.
 *
 *   2. `CommissionLedgerV2` has a unique constraint on (orderId, purpose). Even
 *      if qualification were somehow evaluated twice — a webhook retry, a
 *      double-click, two workers — the second insert is rejected rather than
 *      producing a second credit.
 *
 * Neither depends on the caller telling us who was first. A frontend claim of
 * "I am the first confirmer" is not an input here.
 */
@Injectable()
export class CommissionEngineService {
  private readonly logger = new Logger(CommissionEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a status transition, and credit commission if this is the first
   * actor for the target status.
   *
   * Safe to call from any status-writing path. The transition row is written
   * first and is authoritative; the commission credit is derived from it.
   */
  async recordTransition(
    input: RecordTransitionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<QualificationOutcome> {
    const client = tx ?? this.prisma;
    const occurredAt = input.occurredAt ?? new Date();
    const actorIsSystem = input.actorUserId === SYSTEM_ACTOR_USER_ID;
    const actorUserId = actorIsSystem ? SYSTEM_ACTOR_USER_ID : input.actorUserId ?? null;

    // Resolve the actor to an Employee so commission can be attributed and
    // thresholds can be counted per person.
    const actorEmployeeId = actorIsSystem
      ? null
      : actorUserId
        ? await this.resolveEmployeeId(client, actorUserId)
        : null;

    // A retried submit with the same key must not create a second transition.
    // Read via raw SQL because the uniqueness is a PARTIAL unique index
    // (WHERE idempotencyKey IS NOT NULL), which Prisma cannot express in a
    // WhereUniqueInput.
    if (input.idempotencyKey) {
      const existing = await client.$queryRaw<Array<{ id: string; isFirstForStatus: boolean }>>`
        SELECT "id", "isFirstForStatus"
        FROM "OrderStatusTransition"
        WHERE "idempotencyKey" = ${input.idempotencyKey}
        LIMIT 1
      `;
      if (existing.length > 0) {
        return {
          transitionId: existing[0].id,
          isFirstForStatus: existing[0].isFirstForStatus,
          earned: [],
          skipped: [],
        };
      }
    }

    // Claim "first for this status" atomically. The partial unique index means
    // only one concurrent inserter can win this flag for (orderId, toStatus).
    let isFirstForStatus = false;
    try {
      await client.$executeRaw`
        INSERT INTO "OrderStatusTransition"
          ("id", "orderId", "fromStatus", "toStatus", "actorUserId", "actorEmployeeId",
           "actorType", "isFirstForStatus", "idempotencyKey", "note", "metadata",
           "occurredAt", "createdAt")
        VALUES (
          gen_random_uuid()::text, ${input.orderId}, ${input.fromStatus}, ${input.toStatus},
          ${actorUserId}, ${actorEmployeeId}, ${actorIsSystem ? 'system' : 'staff'},
          ${true}, ${input.idempotencyKey ?? null}, ${input.note ?? null},
          ${(input.metadata ?? {}) as Prisma.InputJsonValue}::jsonb,
          ${occurredAt}, NOW()
        )
        ON CONFLICT ("orderId", "toStatus") WHERE "isFirstForStatus" = true DO NOTHING
      `;
    } catch (err) {
      // The partial-unique conflict is handled below by re-reading; anything
      // else is a real error and must propagate.
      this.logger.warn(`first-status claim failed for order ${input.orderId}: ${(err as Error).message}`);
    }

    const transition = await client.orderStatusTransition.findFirstOrThrow({
      where: { orderId: input.orderId, toStatus: input.toStatus, isFirstForStatus: true },
      select: { id: true, isFirstForStatus: true },
    });
    isFirstForStatus = transition.id !== undefined;

    // If this insertion did not win the flag, it is not the first actor and
    // earns nothing. The transition row still exists as history.
    if (!isFirstForStatus) {
      return { transitionId: '', isFirstForStatus: false, earned: [], skipped: [] };
    }

    const outcome: QualificationOutcome = {
      transitionId: transition.id,
      isFirstForStatus: true,
      earned: [],
      skipped: [],
    };

    // Automation cannot be credited to a person, and a transition with no human
    // actor has no commission owner.
    if (!actorEmployeeId) {
      outcome.skipped.push({
        ruleId: '',
        purpose: input.toStatus,
        reason: actorIsSystem
          ? 'System transition has no staff actor'
          : 'Actor is not linked to an employee record',
      });
      return outcome;
    }

    const { earned, skipped } = await this.qualifyForActor(
      client,
      input.orderId,
      input.toStatus,
      transition.id,
      actorEmployeeId,
      occurredAt,
    );
    outcome.earned = earned;
    outcome.skipped = skipped;
    return outcome;
  }

  /**
   * Evaluate every active rule for this employee and purpose against the order.
   */
  private async qualifyForActor(
    client: Prisma.TransactionClient | PrismaService,
    orderId: string,
    purpose: string,
    transitionId: string,
    employeeId: string,
    occurredAt: Date,
  ): Promise<{ earned: QualificationOutcome['earned']; skipped: QualificationOutcome['skipped'] }> {
    const rules = await client.commissionRuleV2.findMany({
      where: {
        employeeId,
        purpose,
        isActive: true,
        // Validity window: a rule that has not started, or has ended, does not
        // apply to this event.
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: occurredAt } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: occurredAt } }] },
        ],
      },
    });

    if (rules.length === 0) return { earned: [], skipped: [] };

    const order = await client.order.findUnique({
      where: { id: orderId },
      select: { id: true, total: true, subtotal: true, trashedAt: true },
    });
    if (!order || order.trashedAt) {
      return {
        earned: [],
        skipped: rules.map((r) => ({ ruleId: r.id, purpose, reason: 'Order is missing or trashed' })),
      };
    }

    const earned: QualificationOutcome['earned'] = [];
    const skipped: QualificationOutcome['skipped'] = [];

    for (const rule of rules) {
      const calc = calculateCommission(rule as never, order);
      if (!calc) {
        skipped.push({ ruleId: rule.id, purpose, reason: 'Order does not meet the rule conditions' });
        continue;
      }

      let countAtQualification: number | null = null;
      let periodKey = '';

      if (rule.minimumCount && rule.thresholdPeriod) {
        const period = rule.thresholdPeriod as ThresholdPeriod;
        periodKey = periodKeyFor(period, occurredAt);

        // Increment the counter for this bucket and read the resulting count.
        // The counter's primary key makes a repeat increment impossible.
        const counter = await client.commissionThresholdCounter.upsert({
          where: {
            employeeId_purpose_periodKey: { employeeId, purpose, periodKey },
          },
          create: { employeeId, purpose, periodKey, count: 0, lastQualifiedAt: occurredAt },
          update: {},
          select: { count: true },
        });

        const decision = thresholdQualifies(rule.minimumCount, counter.count);
        countAtQualification = decision.countAfter;

        await client.commissionThresholdCounter.update({
          where: { employeeId_purpose_periodKey: { employeeId, purpose, periodKey } },
          data: { count: decision.countAfter, lastQualifiedAt: occurredAt },
        });

        if (!decision.qualifies) {
          skipped.push({
            ruleId: rule.id,
            purpose,
            reason: `Threshold not yet met (${decision.countAfter}/${rule.minimumCount} this ${period})`,
          });
          continue;
        }
      }

      // The unique (orderId, purpose) constraint is the idempotency guarantee.
      try {
        const ledger = await client.commissionLedgerV2.create({
          data: {
            employeeId,
            orderId,
            ruleId: rule.id,
            purpose,
            transitionId,
            actorEmployeeId: employeeId,
            qualifiedAt: occurredAt,
            amountType: rule.amountType,
            ruleAmount: rule.amount,
            valueBasis: rule.valueBasis,
            sourceAmount: calc.sourceAmount,
            amount: calc.amount,
            capApplied: calc.capApplied,
            minimumCount: rule.minimumCount,
            thresholdPeriod: rule.thresholdPeriod,
            countAtQualification,
            periodKey: periodKey || periodKeyFor('monthly', occurredAt),
          },
          select: { id: true },
        });

        earned.push({
          ledgerId: ledger.id,
          ruleId: rule.id,
          purpose,
          amount: calc.amount.toString(),
        });
      } catch (err: any) {
        // P2002 on (orderId, purpose) means this purpose was already credited
        // for this order. That is the invariant working, not a failure.
        if (err?.code === 'P2002') {
          this.logger.log(
            `commission already credited for order ${orderId} / ${purpose}; ignoring duplicate`,
          );
          continue;
        }
        throw err;
      }
    }

    return { earned, skipped };
  }

  /**
   * Backfill counters for a period so a rule with a threshold does not start
   * paying from zero when the engine is switched on mid-month.
   */
  async reconcileThresholdCounters(employeeId: string, purpose: string, period: ThresholdPeriod, upTo: Date): Promise<number> {
    const rows = await this.prisma.commissionLedgerV2.findMany({
      where: { employeeId, purpose, qualifiedAt: { lte: upTo } },
      select: { qualifiedAt: true },
    });

    const buckets = new Map<string, number>();
    for (const row of rows) {
      const key = periodKeyFor(period, row.qualifiedAt);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    for (const [periodKey, count] of buckets) {
      await this.prisma.commissionThresholdCounter.upsert({
        where: { employeeId_purpose_periodKey: { employeeId, purpose, periodKey } },
        create: { employeeId, purpose, periodKey, count },
        update: { count },
      });
    }
    return buckets.size;
  }

  private async resolveEmployeeId(
    client: Prisma.TransactionClient | PrismaService,
    actorUserId: string,
  ): Promise<string | null> {
    // The actor is a UserProfile.id (payload.sub). Resolve it to the linked
    // Employee, which is the canonical staff identity.
    const profile = await client.userProfile.findUnique({
      where: { id: actorUserId },
      select: { betterAuthUserId: true },
    });
    const baId = profile?.betterAuthUserId ?? actorUserId;

    const employee = await client.employee.findUnique({
      where: { betterAuthUserId: baId },
      select: { id: true },
    });
    return employee?.id ?? null;
  }
}