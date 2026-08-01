import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mergeContext, ContextInput, StoredIdentifiers } from './context-merge';

@Injectable()
export class TrackingContextService {
  private readonly logger = new Logger(TrackingContextService.name);
  constructor(private readonly prisma: PrismaService) {}

  async upsertContext(
    ctxId: string,
    input: ContextInput,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize per ctxId: read current row, merge, then upsert (no lost updates).
        const row = await tx.trackingContext.findUnique({ where: { ctxId } });

        // Convert row to appropriate format for mergeContext
        const existing = row
          ? {
              identifiers: (row.identifiers ?? {}) as unknown as StoredIdentifiers,
              url: row.url || undefined,
              referrer: row.referrer || undefined,
            }
          : null;

        const merged = mergeContext(existing, input);

        const identifiers = merged.identifiers as unknown as Prisma.InputJsonValue;
        await tx.trackingContext.upsert({
          where: { ctxId },
          create: {
            ctxId,
            externalId: crypto.randomUUID(), // server-generated, stable per journey
            ip,
            userAgent,
            url: merged.url ?? undefined,
            referrer: merged.referrer ?? undefined,
            identifiers,
          },
          update: {
            url: merged.url ?? undefined,
            referrer: merged.referrer ?? undefined,
            identifiers,
          },
        });
      });
    } catch (err) {
      this.logger.warn(`Failed to upsert tracking context ${ctxId}: ${err}`);
    }
  }

  async getByCtxId(ctxId: string) {
    return this.prisma.trackingContext.findUnique({ where: { ctxId } });
  }
}