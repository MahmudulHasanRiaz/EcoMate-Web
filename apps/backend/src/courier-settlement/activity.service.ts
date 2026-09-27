// ── Invoice activity trail (§5, §14.3, §16). Append-only, idempotent per
// (invoiceId, action, dedupeKey) — the unique index makes retries safe.

import { Injectable } from '@nestjs/common';
import type { CourierSettlementActivityAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ActivityInput {
  invoiceId: string;
  action: CourierSettlementActivityAction;
  actor?: string | null;
  detail?: Record<string, unknown>;
  dedupeKey?: string | null;
}

@Injectable()
export class CourierSettlementActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record an activity; a repeat with the same dedupeKey is a no-op. */
  async record(input: ActivityInput) {
    try {
      return await this.prisma.courierSettlementActivity.create({
        data: {
          invoiceId: input.invoiceId,
          action: input.action,
          actor: input.actor ?? null,
          detail: (input.detail ?? {}) as never,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
    } catch (e: unknown) {
      if (isUniqueViolation(e)) return null; // idempotent replay
      throw e;
    }
  }

  async list(invoiceId: string) {
    return this.prisma.courierSettlementActivity.findMany({
      where: { invoiceId },
      orderBy: { timestamp: 'asc' },
    });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}