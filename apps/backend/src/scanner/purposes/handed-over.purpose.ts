import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DispatchService } from '../../dispatch/dispatch.service';
import { resolveScanIdentifier } from '../scanner-resolver';
import {
  ResolveOutcome,
  ScanActor,
  ScanPurposeHandler,
  ScanResult,
} from '../scanner.types';

/**
 * Purpose 1 — Dispatch → Handed Over.
 * Eligibility is derived from the existing Dispatch state machine: only
 * DISPATCHED → HANDED_OVER is valid. Already HANDED_OVER returns a
 * deterministic 'duplicate' result — the stock deduction inside
 * DispatchService.updateStatus is flag-gated and reference-idempotent, so a
 * repeated scan can never deduct twice.
 */
@Injectable()
export class HandedOverPurpose implements ScanPurposeHandler {
  readonly purpose = 'DISPATCH_HANDED_OVER' as const;
  readonly label = 'Dispatch → Handed Over';
  readonly description =
    'Mark a dispatch as handed over to the courier. Runs the existing Handed Over side effects (order advance + idempotent stock deduction).';

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: DispatchService,
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
    // ── Batch mode: hand over every queued dispatch ──
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
        title: `Batch — ${succeeded} handed over, ${failed} failed`,
        message:
          failed === 0
            ? `All ${succeeded} dispatches handed over (stock deduction idempotent).`
            : `${succeeded} succeeded, ${failed} not eligible (see details).`,
        details: { results, succeeded, failed },
      };
    }

    const dispatch = params.dispatchId
      ? await this.prisma.dispatch.findUnique({ where: { id: params.dispatchId } })
      : null;
    if (!dispatch) {
      return {
        status: 'error',
        identifier: params.identifier,
        title: 'Dispatch not found',
        message: 'Dispatch not found.',
      };
    }

    if (dispatch.status === 'HANDED_OVER') {
      return {
        status: 'duplicate',
        identifier: params.identifier,
        title: `${dispatch.consignmentId} — Already Handed Over`,
        message:
          'This dispatch was already handed over. No stock was deducted again.',
        courier: dispatch.courier,
        oldState: 'HANDED_OVER',
        newState: 'HANDED_OVER',
      };
    }

    if (dispatch.status !== 'DISPATCHED') {
      return {
        status: 'error',
        identifier: params.identifier,
        title: `${dispatch.consignmentId} — Not eligible`,
        message: `This dispatch cannot be marked Handed Over from its current state (${dispatch.status}).`,
        courier: dispatch.courier,
        oldState: dispatch.status,
      };
    }

    try {
      const result = await this.dispatchService.updateStatus(
        dispatch.id,
        'HANDED_OVER',
        actor.email,
      );
      if (!result) {
        return {
          status: 'error',
          identifier: params.identifier,
          title: `${dispatch.consignmentId} — Not eligible`,
          message: `This dispatch cannot be marked Handed Over from its current state.`,
          courier: dispatch.courier,
          oldState: dispatch.status,
        };
      }
      return {
        status: 'success',
        identifier: params.identifier,
        title: `${dispatch.consignmentId} — Handed Over`,
        message: 'Dispatch handed over to the courier. Stock deducted (idempotent).',
        courier: dispatch.courier,
        oldState: 'DISPATCHED',
        newState: 'HANDED_OVER',
        details: { dispatchId: dispatch.id, orderId: dispatch.orderId },
      };
    } catch (e: any) {
      const msg = e?.response?.message ?? e?.message ?? 'Handover failed.';
      return {
        status: 'error',
        identifier: params.identifier,
        title: `${dispatch.consignmentId} — Handover failed`,
        message: Array.isArray(msg) ? msg.join(', ') : String(msg),
        courier: dispatch.courier,
        oldState: dispatch.status,
      };
    }
  }
}
