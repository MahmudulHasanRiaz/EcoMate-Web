import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveScanIdentifier } from '../scanner-resolver';
import {
  ResolveOutcome,
  ScanActor,
  ScanPurposeHandler,
  ScanResult,
} from '../scanner.types';

/**
 * Purpose 4 — Sticker Print (optional, non-blocking).
 * The existing sticker print page (/admin/op/print/sticker/:id) already
 * consumes an order context and auto-prints. This purpose resolves the
 * scanned identifier to that order and hands the print URL back — no
 * duplicate printing subsystem is invented.
 */
@Injectable()
export class StickerPrintPurpose implements ScanPurposeHandler {
  readonly purpose = 'STICKER_PRINT' as const;
  readonly label = 'Sticker Print';
  readonly description =
    'Resolve an order and open its sticker label for printing. Uses the existing print page — no separate print pipeline.';

  constructor(private readonly prisma: PrismaService) {}

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
    return outcome;
  }

  async execute(
    params: { identifier: string },
    _actor: ScanActor,
  ): Promise<ScanResult> {
    const outcome = await resolveScanIdentifier(this.prisma, params.identifier);
    if (!outcome.order) {
      return {
        status: 'error',
        identifier: params.identifier,
        title: 'Order not found',
        message: outcome.message ?? 'No order found for this identifier.',
      };
    }
    const order = outcome.order;
    return {
      status: 'success',
      identifier: params.identifier,
      title: `${order.displayId} — Sticker Print`,
      message: 'Sticker label ready to print.',
      details: {
        orderId: order.id,
        printUrl: `/admin/op/print/sticker/${order.id}`,
      },
    };
  }
}
