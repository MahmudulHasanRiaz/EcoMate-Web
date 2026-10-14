// ── expectedCod resolver (PRD §2.1, §2.3) — DB adaptor over the pure function.
//
// Loads the minimum facts (paymentOptionType, total, trashedAt, status name,
// cash Payment rows) then delegates to the pure `expectedCod`. Divergence
// between the cash-payment sum and Order.total is surfaced as a flag; the
// caller turns it into the YELLOW `EXPECTED_COD_DIVERGENCE` exception.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  expectedCod,
  type ExpectedCodResult,
  type ExpectedCodOrderInput,
} from './economics';

export type { ExpectedCodResult } from './economics';

@Injectable()
export class ExpectedCodResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForOrder(orderId: string): Promise<ExpectedCodResult | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        paymentOptionType: true,
        trashedAt: true,
        total: true,
        status: { select: { name: true } },
        payments: { select: { amount: true, gatewayCode: true, status: true, appliedCreditAmount: true } },
      },
    });
    if (!order) return null;
    return this.resolveFromLoaded({
      paymentOptionType: order.paymentOptionType,
      trashedAt: order.trashedAt,
      statusName: order.status?.name ?? null,
      total: toNumber(order.total),
      payments: order.payments.map((p) => ({
        amount: toNumber(p.amount),
        gatewayCode: p.gatewayCode,
        status: String(p.status),
        appliedCreditAmount: toNumber((p as { appliedCreditAmount?: unknown }).appliedCreditAmount),
      })),
    });
  }

  /** Pure adapter — usable from bulk paths that already loaded the facts. */
  resolveFromLoaded(order: ExpectedCodOrderInput): ExpectedCodResult {
    return expectedCod(order);
  }
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}