import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { resolveScanIdentifier } from '../scanner-resolver';
import {
  ResolveOutcome,
  ScanActor,
  ScanPurposeHandler,
  ScanResult,
} from '../scanner.types';

/**
 * Purpose 3 — Order → Status Update.
 * The scanner NEVER implements its own transition logic: execution goes
 * through OrdersService.updateStatus, the same domain operation the normal
 * order UI uses. If the state machine rejects Current → Target, the scanner
 * rejects it too — including Partial → anything-but-Return-Pending.
 */
@Injectable()
export class OrderStatusPurpose implements ScanPurposeHandler {
  readonly purpose = 'ORDER_STATUS' as const;
  readonly label = 'Order → Status Update';
  readonly description =
    'Scan one or more orders, then apply a status change. Every transition is validated against the same order state machine the admin UI uses — no scanner bypass.';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  async resolve(identifier: string): Promise<ResolveOutcome> {
    const outcome = await resolveScanIdentifier(this.prisma, identifier);
    if (outcome.status === 'not_found') return outcome;
    if (!outcome.order) {
      return {
        ...outcome,
        status: 'not_found',
        message: 'No order found for this identifier.',
      };
    }
    if (outcome.order.kind === 'RETURN') {
      return {
        ...outcome,
        status: 'not_found',
        message:
          'This is a Return Order — its status is managed by the return workflow, not by order status updates.',
      };
    }
    return outcome;
  }

  async execute(
    params: {
      identifier: string;
      orderId?: string;
      orderIds?: string[];
      targetStatusId?: string;
    },
    actor: ScanActor,
  ): Promise<ScanResult> {
    // ── Batch mode: apply ONE target status to a queue of scanned orders ──
    // Every order is still validated individually against the order state
    // machine — a batch can never bypass a transition for a single order.
    if (params.orderIds && params.orderIds.length > 0) {
      if (!params.targetStatusId) {
        return {
          status: 'error',
          identifier: params.identifier,
          title: 'No target status',
          message: 'Select a target status before applying the batch.',
        };
      }
      const results: any[] = [];
      let succeeded = 0;
      let failed = 0;
      for (const orderId of params.orderIds) {
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          include: { status: true },
        });
        if (!order || order.trashedAt) {
          results.push({ orderId, ok: false, message: 'Order not found.' });
          failed++;
          continue;
        }
        if (order.kind === 'RETURN') {
          results.push({
            orderId,
            displayId: order.displayId,
            ok: false,
            message: 'Return Order — managed by the return workflow.',
          });
          failed++;
          continue;
        }
        try {
          const updated = await this.ordersService.updateStatus(
            order.id,
            { statusId: params.targetStatusId, note: 'Scanner batch status update' },
            actor.userId,
            actor.email,
          );
          results.push({
            orderId,
            displayId: order.displayId,
            ok: true,
            oldStatus: order.status.name,
            newStatus: updated.status.name,
          });
          succeeded++;
        } catch (e: any) {
          const msg = e?.response?.message ?? e?.message ?? 'Status update failed.';
          results.push({
            orderId,
            displayId: order.displayId,
            ok: false,
            message: Array.isArray(msg) ? msg.join(', ') : String(msg),
          });
          failed++;
        }
      }
      const status = failed === 0 ? 'success' : succeeded === 0 ? 'error' : 'warning';
      return {
        status,
        identifier: params.identifier,
        title: `Batch — ${succeeded} updated, ${failed} failed`,
        message:
          failed === 0
            ? `All ${succeeded} orders transitioned to the target status.`
            : `${succeeded} succeeded, ${failed} rejected by the state machine (see details).`,
        details: { results, succeeded, failed, targetStatusId: params.targetStatusId },
      };
    }

    if (!params.orderId || !params.targetStatusId) {
      return {
        status: 'error',
        identifier: params.identifier,
        title: 'Incomplete scan',
        message: 'An order and a target status are required.',
      };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: { status: true },
    });
    if (!order || order.trashedAt) {
      return {
        status: 'error',
        identifier: params.identifier,
        title: 'Order not found',
        message: 'Order not found.',
      };
    }
    if (order.kind === 'RETURN') {
      return {
        status: 'error',
        identifier: params.identifier,
        title: `${order.displayId} — Return Order`,
        message:
          'This is a Return Order — its status is managed by the return workflow.',
        oldState: order.status.name,
      };
    }

    try {
      const updated = await this.ordersService.updateStatus(
        order.id,
        { statusId: params.targetStatusId, note: 'Scanner status update' },
        actor.userId,
        actor.email,
      );
      return {
        status: 'success',
        identifier: params.identifier,
        title: `${order.displayId} — ${updated.status.name}`,
        message: `Order status changed ${order.status.name} → ${updated.status.name}.`,
        oldState: order.status.name,
        newState: updated.status.name,
        details: { orderId: order.id },
      };
    } catch (e: any) {
      const msg = e?.response?.message ?? e?.message ?? 'Status update failed.';
      return {
        status: 'error',
        identifier: params.identifier,
        title: `${order.displayId} — Status update failed`,
        message: Array.isArray(msg) ? msg.join(', ') : String(msg),
        oldState: order.status.name,
      };
    }
  }
}
