import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RtnService } from '../../rtn/rtn.service';
import {
  normalizeScanIdentifier,
  resolveScanIdentifier,
  orderItemPreview,
} from '../scanner-resolver';
import {
  DispatchPreview,
  ResolveOutcome,
  ScanActor,
  ScanLinkedCandidate,
  ScanPurposeHandler,
  ScanResult,
} from '../scanner.types';
import { loadLinkedReturnCandidates } from './linked-return-candidates';

const ORDER_NUMBER = /^(ORD|RTN)-\d{6}-\d{4}$/;
const RETURN_NUMBER = /^RTN-\d{6}-\d{4}$/;

/**
 * Picker hygiene (2026-10-28): the scanner picker renders candidates
 * verbatim, so the same courier booking twice is a wrong tap waiting to
 * happen. An order can carry two Dispatch rows for one booking (manual row +
 * webhook row), so dedupe by row id first, then by consignment id (a courier
 * booking id is unique per booking — a repeated consignment is the same
 * dispatch). Rows without a consignment dedupe by id only. Keep-first
 * preserves the resolver's order (newest dispatch first).
 */
function dedupeDispatches(dispatches: DispatchPreview[]): DispatchPreview[] {
  const seenIds = new Set<string>();
  const seenConsignments = new Set<string>();
  const out: DispatchPreview[] = [];
  for (const d of dispatches) {
    if (seenIds.has(d.id)) continue;
    if (d.consignmentId && seenConsignments.has(d.consignmentId)) continue;
    seenIds.add(d.id);
    if (d.consignmentId) seenConsignments.add(d.consignmentId);
    out.push(d);
  }
  return out;
}

/**
 * Purpose 2 — Process return (merged task).
 *
 * Resolve accepts EVERY return identifier: a courier dispatch id / tracking
 * code, an order number / QR, or an RTN display id (staff-created returns AND
 * exchange returns). Candidates of BOTH kinds may match one order — the picker
 * then lists every one of them, and the operator's choice is staged; nothing
 * is ever executed by a scan. Staged rows keep their internal purpose so
 * Process executes through the correct existing path.
 *
 * Execute delegates ALL domain logic to RtnService.finalizeDispatchReturn:
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
    const normalized = normalizeScanIdentifier(identifier);

    // Direct RTN display id → exactly that leg. The generic resolver treats
    // RTN as an Order displayId, so a staff-created / exchange Return row
    // needs its own lookup BEFORE the generic path.
    if (RETURN_NUMBER.test(normalized)) {
      const direct = await this.resolveReturnDisplayId(normalized);
      if (direct) return direct;
    }

    const outcome = await resolveScanIdentifier(this.prisma, identifier);
    if (outcome.status === 'not_found') {
      return { ...outcome, linked: outcome.linked ?? [] };
    }

    // Dispatch-only identifiers (consignment / tracking) resolve the dispatch
    // and are never widened to the order's other return legs — the scanned
    // parcel is unambiguous.
    if (!ORDER_NUMBER.test(normalized)) {
      await this.enrichDispatches(outcome);
      return { ...outcome, linked: outcome.linked ?? [] };
    }

    const orderId = outcome.order?.id ?? outcome.dispatches[0]?.orderId ?? null;
    const linked = orderId
      ? await loadLinkedReturnCandidates(this.prisma, orderId)
      : [];
    // Picker hygiene (2026-10-28): a dispatch and a Return row for the same
    // order are two faces of ONE return, and offering both is not just
    // confusing — it can restore the same goods twice. Dispatch finalize
    // (finalizeDispatchReturn) restores per order/RTN-order lines and never
    // touches Return rows, while leg receive (restoreStockForReturn) restores
    // per Return-row quantities guarded only by that row's stockReconciled
    // flag — neither guard sees the other path, so processing both faces
    // double-restores in either order. When a Return row already records the
    // order's return, the leg path owns it (manual receive recording WHO +
    // WHEN, with damage split) and the dispatch option is suppressed. A
    // dispatch stays a candidate only when no Return row covers the order's
    // return. Exchange-only children (info-only, no Return row) do NOT
    // suppress: they are not a recorded return.
    const dedupedDispatches = dedupeDispatches(outcome.dispatches);
    outcome.dispatches = linked.some((c) => c.kind === 'return')
      ? []
      : dedupedDispatches;
    await this.enrichDispatches(outcome);

    const total = outcome.dispatches.length + linked.length;
    if (total === 0) {
      return {
        ...outcome,
        status: 'not_found',
        dispatches: outcome.dispatches,
        linked,
        message: 'No active return/exchange or returnable dispatch was found for this order.',
      };
    }
    if (total > 1) {
      return {
        ...outcome,
        status: 'selection_required',
        dispatches: outcome.dispatches,
        linked,
        message:
          'Multiple return options are linked to this order. Select the dispatch, return, or exchange to continue.',
      };
    }
    const only = linked[0];
    return {
      ...outcome,
      status: 'resolved',
      dispatches: outcome.dispatches,
      linked,
      message: only
        ? `One active ${only.labelKind ?? only.kind} ${only.displayId} is linked to this order — ready to process.`
        : 'One returnable dispatch is linked to this order — ready to stage.',
    };
  }

  /**
   * A scanned RTN display id maps to ONE Return row. The candidate is built
   * through the SAME shared loader as order scans (item previews, coverage,
   * stage-time processability), then filtered to the scanned leg so the picker
   * is never widened to the order's other returns.
   */
  private async resolveReturnDisplayId(
    identifier: string,
  ): Promise<ResolveOutcome | null> {
    const ret = (await this.prisma.return.findFirst({
      where: { displayId: { equals: identifier, mode: 'insensitive' } },
      include: { order: { select: { displayId: true } } },
    })) as any;
    if (!ret) return null;

    const linked = await loadLinkedReturnCandidates(this.prisma, ret.orderId);
    const candidate = linked.find(
      (c: ScanLinkedCandidate) => c.kind === 'return' && c.id === ret.id,
    );
    if (!candidate) {
      return {
        status: 'not_found',
        identifier,
        dispatches: [],
        order: null,
        linked: [],
        message: `No active return/exchange found for "${identifier}".`,
      };
    }

    const orderDisplayId = ret.order?.displayId as string | undefined;
    const orderOutcome = orderDisplayId
      ? await resolveScanIdentifier(this.prisma, orderDisplayId)
      : null;
    return {
      status: 'resolved',
      identifier,
      dispatches: [],
      order: orderOutcome?.order ?? null,
      linked: [candidate],
      message: `One active ${candidate.labelKind ?? candidate.kind} ${candidate.displayId} is ready to process.`,
    };
  }

  /**
   * Stage-time truth for the scanner: what will be returned, and whether the
   * dispatch can be finalized at all. Mirrors finalizeDispatchReturn's
   * eligibility gates WITHOUT mutating anything. Two bounded queries.
   */
  private async enrichDispatches(outcome: ResolveOutcome): Promise<void> {
    if (outcome.dispatches.length === 0) return;
    const orderIds = [...new Set(outcome.dispatches.map((d) => d.orderId))];
    // The include is TYPED against the generated Prisma client, so a field
    // that does not exist on the model is a COMPILE error, not a runtime 500.
    // (Product has no scalar `image` — only `images`; the display image is
    // derived from images[0]. ProductVariant DOES have `image`.)
    const itemInclude = {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
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
    } satisfies Prisma.OrderItemInclude;

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
