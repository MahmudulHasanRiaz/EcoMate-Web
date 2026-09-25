/**
 * SyncRunService — central-commerce §8.1 (P4).
 *
 * Owns SyncRun begin/finish (+windowDays/wideningReason), SyncRunItem writes
 * and SyncAttempt history. `finish()` computes PARTIAL when failed > 0 AND
 * (created + updated) > 0. All writes awaited — never swallowed (§4.2).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SyncScope = 'PRODUCT' | 'STOCK' | 'ORDER_INGEST' | 'ORDER_PUSH' | 'RECONCILE' | 'MAINTENANCE' | 'PUBLISH';
export type TriggerType = 'MANUAL' | 'SCHEDULED' | 'WEBHOOK' | 'RETRY' | 'SYSTEM';

@Injectable()
export class SyncRunService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(opts: {
    scope: SyncScope;
    triggerType?: TriggerType;
    storeId?: string;
    initiatedById?: string;
    windowDays?: number;
    wideningReason?: string;
    correlationId?: string;
  }) {
    return this.prisma.syncRun.create({
      data: {
        scope: opts.scope as any,
        triggerType: (opts.triggerType ?? 'MANUAL') as any,
        storeId: opts.storeId,
        initiatedById: opts.initiatedById,
        windowDays: opts.windowDays,
        wideningReason: opts.wideningReason,
        correlationId: opts.correlationId,
        status: 'RUNNING' as any,
      },
    });
  }

  async recordItem(
    runId: string,
    item: {
      storeId?: string;
      productId?: string;
      objectType: string;
      externalObjectId?: string;
      status: string;
      reason?: string;
      field?: string;
      auditLevel?: string;
      durationMs?: number;
      errorCategory?: string;
    },
  ) {
    await this.prisma.syncRunItem.create({
      data: {
        runId,
        storeId: item.storeId,
        productId: item.productId,
        objectType: item.objectType as any,
        externalObjectId: item.externalObjectId,
        status: item.status as any,
        reason: item.reason,
        field: item.field,
        auditLevel: item.auditLevel,
        durationMs: item.durationMs,
        errorCategory: item.errorCategory,
      },
    });
  }

  async recordAttempt(attempt: {
    runId?: string;
    storeId?: string;
    objectType: string;
    objectKey: string;
    productId?: string;
    field?: string;
    attemptNo?: number;
    status: string;
    errorCategory?: string;
    errorMessage?: string;
    nextRetryAt?: Date;
  }) {
    await this.prisma.syncAttempt.create({
      data: {
        runId: attempt.runId,
        storeId: attempt.storeId,
        objectType: attempt.objectType as any,
        objectKey: attempt.objectKey,
        productId: attempt.productId,
        field: attempt.field,
        attemptNo: attempt.attemptNo ?? 1,
        status: attempt.status as any,
        errorCategory: attempt.errorCategory,
        errorMessage: attempt.errorMessage,
        nextRetryAt: attempt.nextRetryAt,
      },
    });
  }

  async upsertIssue(issue: {
    storeId: string;
    code: string;
    objectType: string;
    objectKey: string;
    productId?: string;
    field?: string;
    message: string;
  }) {
    const existing = await this.prisma.storeSyncIssue.findUnique({
      where: { storeId_code_objectKey: { storeId: issue.storeId, code: issue.code, objectKey: issue.objectKey } },
    });
    if (existing) {
      return this.prisma.storeSyncIssue.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, message: issue.message },
      });
    }
    return this.prisma.storeSyncIssue.create({
      data: {
        storeId: issue.storeId,
        code: issue.code,
        objectType: issue.objectType as any,
        objectKey: issue.objectKey,
        productId: issue.productId,
        field: issue.field,
        message: issue.message,
        status: 'OPEN' as any,
      },
    });
  }

  async finish(runId: string, counts: { created: number; updated: number; skipped?: number; failed: number }) {
    const failed = counts.failed;
    const succeeded = counts.created + counts.updated;
    const status = failed === 0 ? 'SUCCESS' : succeeded > 0 ? 'PARTIAL' : 'FAILED';
    return this.prisma.syncRun.update({
      where: { id: runId },
      data: {
        status: status as any,
        createdCount: counts.created,
        updatedCount: counts.updated,
        skippedCount: counts.skipped ?? 0,
        failedCount: failed,
        totalCount: succeeded + failed + (counts.skipped ?? 0),
        finishedAt: new Date(),
      },
    });
  }

  async cancel(runId: string) {
    return this.prisma.syncRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED' as any, finishedAt: new Date() },
    });
  }

  async countAttempts(storeId: string, objectKey: string): Promise<number> {
    return (this.prisma as any).syncAttempt.count({ where: { storeId, objectKey } });
  }
}
