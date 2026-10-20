import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RtnService } from '../../rtn/rtn.service';
import { resolveScanIdentifier, orderItemPreview } from '../scanner-resolver';
import {
  ResolveOutcome,
  ScanActor,
  ScanPurposeHandler,
  ScanResult,
} from '../scanner.types';

/**
 * Purpose 2 — Dispatch → Return.
 * Delegates ALL domain logic to RtnService.finalizeDispatchReturn:
 *  - full return:    original Return Pending → Returned + restoreForOrder
 *  - partial return: RTN Return Pending → Returned + exact RTN quantities
 *  - unresolved Partial order: recoverable business exception (no mutation)
 *  - already settled: deterministic 'duplicate' result (no second restoration)
 */
@Injectable()
export class ReturnPurpose implements ScanPurposeHandler {
  readonly purpose = 'DISPATCH_RETURN' as const;
  readonly label = 'Dispatch → Return';
  readonly description =
    'Finalize a returned dispatch. Full returns close the original order; Partial returns close the RTN and restore exactly the returned quantities to stock.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly rtnService: RtnService,
  ) {}

  async resolve(identifier: string): Promise<ResolveOutcome> {
    const outcome = await resolveScanIdentifier(this.prisma, identifier);
    if (outcome.status === 'not_found') return outcome;
    if (outcome.dispatches.length > 1) {
      await this.enrichDispatches(outcome);
      return {
        ...outcome,
        status: 'selection_required',
        message: 'Multiple dispatches are linked to this order. Select the dispatch to continue.',
      };
    }
    await this.enrichDispatches(outcome);
    return outcome;
  }

  /**
   * Stage-time truth for the scanner: what will be returned, and whether the
   * dispatch can be finalized at all. Mirrors finalizeDispatchReturn's
   * eligibility gates WITHOUT mutating anything. Two bounded queries.
   */
  private async enrichDispatches(outcome: ResolveOutcome): Promise<void> {
    if (outcome.dispatches.length === 0) return;
    const orderIds = [...new Set(outcome.dispatches.map((d) => d.orderId))];
    const itemInclude = {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          image: true,
          images: true,
          warehouseId: true,
        },
      },
      variant: {
        select: {
          id: true,
          productId: true,
          sku: true,
          image: true,
          images: true,
          attributeValues: {
            select: {
              attributeValue: {
                select: {
                  value: true,
                  hexCode: true,
                  attribute: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    };

    const [orders, rtns] = await Promise.all([
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: {
          status: true,
          items: { include: itemInclude },
          returns: {
            where: { status: { not: 'CLOSED' } },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.order.findMany({
        where: { returnOfOrderId: { in: orderIds } },
        include: {
          status: true,
          items: { include: itemInclude },
        },
      }),
    ]);
    const orderById = new Map((orders as any[]).map((o) => [o.id, o]));
    const rtnByOriginal = new Map(
      (rtns as any[]).map((r) => [r.returnOfOrderId, r]),
    );

    for (const d of outcome.dispatches) {
      const order = orderById.get(d.orderId);
      if (!order) continue;
      const rtn = rtnByOriginal.get(order.id) ?? null;
      const eligibleDispatch = ['RETURN_PENDING', 'PARTIAL', 'RETURNED'].includes(
        d.status,
      );
      const partialOrder = order.status?.name === 'Partial';
      const rtnPending = rtn?.status?.name === 'Return Pending';
      const fullReturnPending = order.status?.name === 'Return Pending';
      const partialResolved =
        order.status?.name === 'Delivered' && rtnPending;
      const fullHeal =
        order.status?.name === 'Delivered' &&
        !rtn &&
        (d.status === 'RETURN_PENDING' || d.status === 'RETURNED');

      let processable = true;
      let reason: string | null = null;
      if (!eligibleDispatch) {
        processable = false;
        reason = `Cannot be marked Returned from its current state (${d.status}).`;
      } else if (partialOrder) {
        processable = false;
        reason =
          'This Partial order has not been resolved into a Return Order yet.';
      } else if (!fullReturnPending && !partialResolved && !fullHeal) {
        processable = false;
        reason =
          d.status === 'RETURNED'
            ? 'Already returned — stock was settled earlier. No action needed.'
            : `This dispatch cannot be marked Returned from its current state (${d.status}).`;
      }

      const sourceItems = partialResolved && rtn ? rtn.items : order.items;
      d.items = (Array.isArray(sourceItems) ? sourceItems : [])
        .slice(0, 20)
        .map((it: any) => orderItemPreview(it))
        .filter(Boolean) as any;
      d.processable = processable;
      d.reason = reason;
    }
  }

  async execute(
    params: {
      identifier: string;
      dispatchId?: string;
      dispatchIds?: string[];
      items?: Array<{
        productId: string;
        variantId?: string | null;
        quantity: number;
        damagedQuantity?: number;
      }>;
    },
    actor: ScanActor,
  ): Promise<ScanResult> {
    // ── Batch mode: finalize the return of every queued dispatch ──
    if (params.dispatchIds && params.dispatchIds.length > 0) {
      const results: any[] = [];
      let succeeded = 0;
      let failed = 0;
      for (const dispatchId of params.dispatchIds) {
        const res = await this.execute({ identifier: params.identifier, dispatchId }, actor);
        results.push({ dispatchId, ...res });
        if (res.status === 'success' || res.status === 'duplicate') succeeded++;
        else failed++;
      }
      const status = failed === 0 ? 'success' : succeeded === 0 ? 'error' : 'warning';
      return {
        status,
        identifier: params.identifier,
        title: `Batch — ${succeeded} returned, ${failed} failed`,
        message:
          failed === 0
            ? `All ${succeeded} dispatches finalized (stock restoration idempotent).`
            : `${succeeded} succeeded, ${failed} rejected (see details).`,
        details: { results, succeeded, failed },
      };
    }

    if (!params.dispatchId) {
      return {
        status: 'error',
        identifier: params.identifier,
        title: 'Select a dispatch',
        message:
          'Multiple dispatches are linked to this order. Select the dispatch to continue.',
      };
    }

    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id: params.dispatchId },
      select: { consignmentId: true, courier: true, status: true },
    });

    try {
      const result = await this.rtnService.finalizeDispatchReturn(
        params.dispatchId,
        actor,
        params.items,
      );

      if (result.outcome === 'already_returned') {
        return {
          status: 'duplicate',
          identifier: params.identifier,
          title: `${dispatch?.consignmentId ?? ''} — Already Returned`,
          message: 'This return was already completed. No stock was restored again.',
          courier: result.dispatch.courier,
          oldState: result.dispatch.status,
          newState: result.dispatch.status,
        };
      }

      const damaged = (result.restoredItems ?? []).filter(
        (i: any) => Number(i.damagedQuantity) > 0,
      );
      const damagedUnits = damaged.reduce(
        (s: number, i: any) => s + Number(i.damagedQuantity),
        0,
      );
      const restoredUnits = (result.restoredItems ?? []).reduce(
        (s: number, i: any) => s + Number(i.quantity || 0),
        0,
      );
      const rtnNote = result.rtn
        ? `RTN ${result.rtn.displayId} → Returned; ${result.restoredItems.length} item(s) restored to stock.`
        : `Order ${result.order.displayId} → Returned; stock restored.`;

      return {
        status: 'success',
        identifier: params.identifier,
        title: `${dispatch?.consignmentId ?? ''} — Returned`,
        message:
          damagedUnits > 0
            ? `${rtnNote} ${restoredUnits} unit(s) restored · ${damagedUnits} damaged (not restocked).`
            : rtnNote,
        courier: result.dispatch.courier,
        oldState: result.dispatch.oldStatus,
        newState: 'RETURNED',
        details: {
          dispatchId: result.dispatch.id,
          orderId: result.order.id,
          orderStatus: result.order.status,
          rtnId: result.rtn?.id ?? null,
          rtnDisplayId: result.rtn?.displayId ?? null,
          restoredItems: result.restoredItems,
          restoredUnits,
          damagedUnits,
        },
      };
    } catch (e: any) {
      const msg = e?.response?.message ?? e?.message ?? 'Return failed.';
      return {
        status: 'error',
        identifier: params.identifier,
        title: `${dispatch?.consignmentId ?? params.identifier} — Return failed`,
        message: Array.isArray(msg) ? msg.join(', ') : String(msg),
        courier: dispatch?.courier,
        oldState: dispatch?.status,
      };
    }
  }
}
