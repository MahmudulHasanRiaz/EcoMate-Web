import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { appendOrderTimeline } from '../orders/order-timeline.util';
import {
  CLOSED_DISPATCH_STATUSES,
  DispatchCancelEvaluation,
  courierLabel,
  evaluateDispatchCancelEligibility,
} from './dispatch-cancel-eligibility';

/**
 * Cancel a DISPATCHED order (owner directive, 2026-10-21).
 *
 * A dispatched order can only be cancelled while the parcel is still with us
 * AND the courier has a cancel API we can push to. The flow is deliberately
 * split in two halves so the irreversible external call never sits inside a
 * database transaction:
 *
 *   1. prepare() — evaluate the eligibility (server-side, authoritative) and
 *      push the courier cancels. Nothing is written here; a failure throws
 *      and the order + dispatch stay exactly as they were.
 *   2. apply() — inside the ORDER's transaction: mark the dispatches
 *      cancelled, store the courier's reference and write the audit entry.
 *
 * The rules themselves live in dispatch-cancel-eligibility.ts (pure, shared
 * with the admin dialog).
 */

export type DispatchCancelPlanEntry = {
  id: string;
  courier: string;
  status: string;
  consignmentId: string | null;
  trackingCode: string | null;
} & DispatchCancelEvaluation;

export type CourierCancelOutcome = {
  dispatchId: string;
  courier: string;
  /** The courier's own booking id we cancelled. */
  reference: string;
  /** Whatever the courier answered (stored on the dispatch for the audit). */
  response: unknown;
};

export type DispatchCancelPlan = {
  orderId: string;
  /** The order's live dispatches (not CANCELLED) with their eligibility. */
  dispatches: DispatchCancelPlanEntry[];
  /** The dispatches that may be cancelled with their courier — ALL or NONE. */
  cancellable: DispatchCancelPlanEntry[];
  /** Why the plan cannot be executed (null when it can). */
  blockedReason: string | null;
  /** Filled after the courier pushes succeeded. */
  outcomes: CourierCancelOutcome[];
};

@Injectable()
export class DispatchCancelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The order's live dispatches + each one's eligibility. No writes.
   */
  async evaluateOrder(orderId: string): Promise<DispatchCancelPlan> {
    const dispatches = await this.prisma.dispatch.findMany({
      where: {
        orderId,
        status: { notIn: [...CLOSED_DISPATCH_STATUSES] as any },
      },
      select: {
        id: true,
        courier: true,
        status: true,
        consignmentId: true,
        trackingCode: true,
        pickedUpAt: true,
        handedOverAt: true,
        deliveredAt: true,
        courierStatus: true,
        courierStatusAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const entries: DispatchCancelPlanEntry[] = (dispatches ?? []).map((d) => ({
      id: d.id,
      courier: d.courier,
      status: String(d.status),
      consignmentId: d.consignmentId ?? null,
      trackingCode: d.trackingCode ?? null,
      ...evaluateDispatchCancelEligibility({
        courier: d.courier,
        status: d.status,
        pickedUpAt: d.pickedUpAt,
        handedOverAt: d.handedOverAt,
        deliveredAt: d.deliveredAt,
        courierStatus: d.courierStatus,
        courierStatusAt: d.courierStatusAt,
      }),
    }));

    // ALL live dispatches must be eligible — one blocker aborts the whole
    // cancel (the directive's multi-dispatch rule).
    const blocked = entries.find((e) => !e.eligible);

    return {
      orderId,
      dispatches: entries,
      cancellable: blocked ? [] : entries,
      blockedReason: blocked?.reason ?? null,
      outcomes: [],
    };
  }

  /**
   * Evaluate + push the courier cancels. Throws when the plan is blocked or
   * when a courier refuses — in both cases NOTHING was written, so the order
   * and its dispatch are untouched.
   */
  async prepare(orderId: string, actor?: string): Promise<DispatchCancelPlan> {
    const plan = await this.evaluateOrder(orderId);
    if (plan.dispatches.length === 0) return plan;

    if (plan.blockedReason) {
      throw new BadRequestException(plan.blockedReason);
    }

    const outcomes: CourierCancelOutcome[] = [];
    for (const dispatch of plan.cancellable) {
      outcomes.push(await this.pushCourierCancel(dispatch, actor));
    }
    return { ...plan, outcomes };
  }

  /**
   * Push ONE courier cancel. The courier call is external and irreversible —
   * a failure aborts everything (the caller has not written anything yet).
   */
  protected async pushCourierCancel(
    dispatch: DispatchCancelPlanEntry,
    actor?: string,
  ): Promise<CourierCancelOutcome> {
    const label = courierLabel(dispatch.courier);
    const reference = dispatch.consignmentId || dispatch.trackingCode;
    if (!reference) {
      throw new BadRequestException(
        `The ${label} dispatch has no consignment/tracking id yet — the booking cannot be cancelled with the courier.`,
      );
    }

    const reason = `Order cancelled by ${actor || 'staff'}`;
    try {
      const response = await this.callCourierCancel(
        dispatch.courier,
        reference,
        reason,
      );
      return {
        dispatchId: dispatch.id,
        courier: dispatch.courier,
        reference,
        response,
      };
    } catch (e) {
      throw new ServiceUnavailableException(
        `${label} could not cancel the booking (${errorMessage(e)}). ` +
          `The order and its dispatch were left unchanged.`,
      );
    }
  }

  /**
   * The courier client call. Lazily loaded (the same pattern the orders
   * service uses for bulk dispatch) so no module cycle is introduced.
   */
  protected async callCourierCancel(
    courier: string,
    reference: string,
    reason: string,
  ): Promise<unknown> {
    const { CourierManagerService } = await import(
      '../courier-manager/courier-manager.service.js'
    );
    const { CourierTokenService } = await import(
      '../courier-manager/courier-token.service.js'
    );
    const { CacheService } = await import('../cache/cache.service.js');
    const mgr = new CourierManagerService(
      this.prisma,
      new CourierTokenService(this.prisma, new CacheService()),
    );
    if (courier === 'carrybee') {
      return mgr.cancelCarrybeeOrder(reference, reason);
    }
    if (courier === 'redx') {
      return mgr.cancelRedxParcel(reference, reason);
    }
    throw new BadRequestException(
      `${courierLabel(courier)} bookings cannot be cancelled from here — cancel the booking in the ${courierLabel(courier)} panel first, then cancel the order.`,
    );
  }

  /**
   * Apply the cancellations inside the ORDER's transaction: the dispatches
   * become CANCELLED, the courier's reference is stored and the audit entry
   * is appended to the order's timeline.
   */
  async apply(
    tx: Prisma.TransactionClient,
    plan: DispatchCancelPlan,
    actor?: string,
  ): Promise<void> {
    const outcomes = plan.outcomes ?? [];
    if (outcomes.length === 0) return;

    const now = new Date();
    const entries: any[] = [];
    for (const outcome of outcomes) {
      await tx.dispatch.updateMany({
        where: { id: outcome.dispatchId, status: { not: 'CANCELLED' } },
        data: {
          status: 'CANCELLED',
          courierCancelRef: outcome.reference,
          courierCancelAt: now,
          courierCancelResponse: (outcome.response ?? null) as any,
        },
      });
      entries.push({
        type: 'dispatch.cancelled',
        visibility: 'private',
        timestamp: now.toISOString(),
        note:
          `Dispatch cancelled with ${courierLabel(outcome.courier)} ` +
          `(booking ${outcome.reference}) — the courier booking was cancelled ` +
          `as part of the order cancellation.`,
        performedBy: actor || 'system',
        courier: outcome.courier,
        dispatchId: outcome.dispatchId,
        courierReference: outcome.reference,
      });
    }

    if (entries.length > 0) {
      await appendOrderTimeline(tx, plan.orderId, entries);
    }
  }
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message?: unknown }).message ?? e);
  }
  return String(e);
}
