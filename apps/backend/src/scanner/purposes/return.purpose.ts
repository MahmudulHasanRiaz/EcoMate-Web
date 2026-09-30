import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RtnService } from '../../rtn/rtn.service';
import { resolveScanIdentifier } from '../scanner-resolver';
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
      return {
        ...outcome,
        status: 'selection_required',
        message: 'Multiple dispatches are linked to this order. Select the dispatch to continue.',
      };
    }
    return outcome;
  }

  async execute(
    params: { identifier: string; dispatchId?: string; dispatchIds?: string[] },
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

      const rtnNote = result.rtn
        ? `RTN ${result.rtn.displayId} → Returned; ${result.restoredItems.length} item(s) restored to stock.`
        : `Order ${result.order.displayId} → Returned; stock restored.`;

      return {
        status: 'success',
        identifier: params.identifier,
        title: `${dispatch?.consignmentId ?? ''} — Returned`,
        message: rtnNote,
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
