import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReturnsService } from '../../returns/returns.service';
import { normalizeScanIdentifier, resolveScanIdentifier } from '../scanner-resolver';
import { loadLinkedReturnCandidates } from './linked-return-candidates';
import {
  ResolveOutcome,
  ScanActor,
  ScanLinkedCandidate,
  ScanPurposeHandler,
  ScanResult,
} from '../scanner.types';

/**
 * Hardening (3) — Return / Exchange Receive (backend part).
 *
 * resolve(identifier): an ORDER barcode (or a dispatch barcode belonging to
 * an order) → the order's ACTIVE linked returns (status != CLOSED) plus its
 * exchange-order children. Exactly one → resolved with it; several →
 * selection_required with the picker list; none → not_found
 * ("No active return/exchange for this order.").
 *
 * execute({ identifier, returnId?, exchangeId? }): receiving runs through the
 * guarded stock funnel (restoreStockForReturn — flag-guarded, idempotent per
 * return, so a double-scan of order barcode + return id is a duplicate, never
 * a second restore). The ORDER row is never written here — it stays
 * derived-only. Exchanges are info-only (their own order flow fulfils them).
 * Without a selection → error asking the picker to choose (phase-2 UI).
 */
@Injectable()
export class ReturnReceivePurpose implements ScanPurposeHandler {
  readonly purpose = 'RETURN_RECEIVE' as const;
  readonly label = 'Return / Exchange Receive';
  readonly description =
    'Receive a returned parcel against its linked return. Resolves an order barcode to linked returns/exchanges without ever marking the order itself.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly returns: ReturnsService,
  ) {}

  async resolve(identifier: string): Promise<ResolveOutcome> {
    const outcome = await resolveScanIdentifier(this.prisma, identifier);
    if (outcome.status === 'not_found') return outcome;
    const orderId = outcome.order?.id ?? outcome.dispatches[0]?.orderId ?? null;
    if (!orderId) {
      return {
        ...outcome,
        status: 'not_found',
        message: 'No active return/exchange for this order.',
      };
    }
    const linked = await this.linkedCandidates(orderId);
    if (linked.length === 0) {
      return {
        ...outcome,
        status: 'not_found',
        linked,
        message: 'No active return/exchange for this order.',
      };
    }
    if (linked.length === 1) {
      const only = linked[0];
      return {
        ...outcome,
        status: 'resolved',
        linked,
        message:
          `One active ${only.kind} ${only.displayId} is linked to this order — ` +
          `ready to receive.`,
      };
    }
    return {
      ...outcome,
      status: 'selection_required',
      linked,
      message:
        'Multiple returns/exchanges are linked to this order. Select one to continue.',
    };
  }

  async execute(
    params: {
      identifier: string;
      returnId?: string;
      exchangeId?: string;
      items?: Array<{
        productId: string;
        variantId?: string | null;
        quantity: number;
        damagedQuantity?: number;
      }>;
    },
    actor: ScanActor,
  ): Promise<ScanResult> {
    if (params.returnId) {
      return this.receiveReturn(params.identifier, params.returnId, actor, params.items);
    }
    if (params.exchangeId) {
      return this.describeExchange(params.identifier, params.exchangeId);
    }
    return {
      status: 'error',
      identifier: params.identifier,
      title: 'Select a return or exchange',
      message: 'Select a return or exchange to continue.',
    };
  }

  private async linkedCandidates(orderId: string): Promise<ScanLinkedCandidate[]> {
    return loadLinkedReturnCandidates(this.prisma, orderId);
  }

  private async receiveReturn(
    identifier: string,
    returnId: string,
    actor: ScanActor,
    items?: Array<{
      productId: string;
      variantId?: string | null;
      quantity: number;
      damagedQuantity?: number;
    }>,
  ): Promise<ScanResult> {
    const ret = await this.prisma.return.findUnique({ where: { id: returnId } });
    if (!ret) {
      return {
        status: 'error',
        identifier,
        title: 'Return not found',
        message: `No return found for "${returnId}".`,
      };
    }
    // The scanned barcode selects the ORDER; the return id selects the leg —
    // a leg of another order is rejected, never cross-received. A scan of the
    // leg's OWN RTN display id needs no cross-check (staff returns have no
    // Return-Order row to resolve).
    const ownDisplayId = normalizeScanIdentifier((ret as any).displayId ?? '');
    if (identifier && normalizeScanIdentifier(identifier) !== ownDisplayId) {
      const outcome = await resolveScanIdentifier(this.prisma, identifier);
      const orderId = outcome.order?.id ?? outcome.dispatches[0]?.orderId ?? null;
      if (orderId && (ret as any).orderId !== orderId) {
        return {
          status: 'error',
          identifier,
          title: `${(ret as any).displayId ?? returnId} — Wrong order`,
          message:
            `Return ${(ret as any).displayId ?? returnId} does not belong to ` +
            `this order. Scan the matching order barcode.`,
        };
      }
    }
    if ((ret as any).status === 'CLOSED') {
      return {
        status: 'error',
        identifier,
        title: `${(ret as any).displayId ?? returnId} — Closed`,
        message: 'This return is CLOSED and cannot be received.',
      };
    }
    if ((ret as any).stockReconciled || (ret as any).status === 'RESTOCKED') {
      return {
        status: 'duplicate',
        identifier,
        title: `${(ret as any).displayId ?? returnId} — Already Received`,
        message: 'This return was already received. No stock was restored again.',
      };
    }
    try {
      const received = (await this.returns.restoreStockForReturn(returnId, {
        ...(items && items.length > 0 ? { items } : {}),
        performedBy: actor.email,
      })) as any;
      const lines = Array.isArray(received?.items) ? received.items : [];
      const receivedUnits = lines.reduce(
        (s: number, l: any) => s + (Number(l?.quantity) || 0),
        0,
      );
      const damagedUnits = lines.reduce(
        (s: number, l: any) => s + (Number(l?.damagedQuantity) || 0),
        0,
      );
      return {
        status: 'success',
        identifier,
        title: `${received?.displayId ?? (ret as any).displayId ?? returnId} — Received`,
        message:
          damagedUnits > 0
            ? `Return received — ${Math.max(0, receivedUnits - damagedUnits)} restored · ${damagedUnits} damaged (not restocked).`
            : 'Return received and restocked (idempotent per return).',
        details: {
          returnId: received?.id ?? returnId,
          returnDisplayId: received?.displayId ?? (ret as any).displayId,
          orderId: (ret as any).orderId,
          receivedUnits,
          damagedUnits,
        },
      };
    } catch (e: any) {
      const msg = e?.response?.message ?? e?.message ?? 'Receive failed.';
      return {
        status: 'error',
        identifier,
        title: `${(ret as any).displayId ?? returnId} — Receive failed`,
        message: Array.isArray(msg) ? msg.join(', ') : String(msg),
      };
    }
  }

  private async describeExchange(identifier: string, exchangeId: string): Promise<ScanResult> {
    const exchange = await this.prisma.order.findUnique({
      where: { id: exchangeId },
      include: { status: true },
    });
    if (!exchange || (exchange as any).trashedAt) {
      return {
        status: 'error',
        identifier,
        title: 'Exchange not found',
        message: `No exchange found for "${exchangeId}".`,
      };
    }
    // Info-only: exchanges fulfil through their own order flow — no mutation
    // here, and the original order is never marked.
    return {
      status: 'success',
      identifier,
      title: `${(exchange as any).displayId ?? exchangeId} — Exchange`,
      message:
        `Exchange ${(exchange as any).displayId ?? exchangeId} ` +
        `(${(exchange as any).status?.name ?? 'unknown status'}) is fulfilled ` +
        `through its own order flow — no stock action taken here.`,
      details: {
        exchangeId: (exchange as any).id,
        exchangeDisplayId: (exchange as any).displayId,
      },
    };
  }
}
