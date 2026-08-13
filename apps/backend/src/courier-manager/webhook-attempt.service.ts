import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAttemptOutcome, WebhookAttemptStage } from '@prisma/client';

const RETENTION_DAYS = 30;
const MAX_RECENT_ATTEMPTS = 50;

export interface LogAttemptParams {
  courier: string;
  method?: string;
  path: string;
  responseStatus?: number;
  outcome: WebhookAttemptOutcome;
  failureStage?: WebhookAttemptStage;
  correlationId?: string;
  sourceIp?: string;
  authResult?: string;
  notificationType?: string;
  consignmentId?: string;
  invoice?: string;
  courierEvent?: string;
  message?: string;
  isDuplicate?: boolean;
  durationMs?: number;
}

export interface WebhookAttemptSummary {
  lastReceivedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastHttpStatus: number | null;
  lastFailureReason: string | null;
}

@Injectable()
export class WebhookAttemptService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookAttemptService.name);
  private readonly CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // First cleanup after 1 hour (gives system time to start)
    setTimeout(() => this.runCleanup(), 3600_000);
    this.cleanupTimer = setInterval(() => this.runCleanup(), this.CLEANUP_INTERVAL_MS);
    this.logger.log(`Webhook attempt retention cleanup scheduled: every 24 hours (${RETENTION_DAYS} day retention)`);
  }

  private async runCleanup(): Promise<void> {
    try {
      const deleted = await this.cleanupOldAttempts();
      if (deleted > 0) {
        this.logger.log(`Webhook attempt cleanup: removed ${deleted} attempts older than ${RETENTION_DAYS} days`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Webhook attempt cleanup failed: ${msg}`);
    }
  }

  async onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async logAttempt(params: LogAttemptParams): Promise<string> {
    const attempt = await this.prisma.webhookAttempt.create({
      data: {
        courier: params.courier,
        method: params.method ?? 'POST',
        path: params.path,
        responseStatus: params.responseStatus,
        outcome: params.outcome,
        failureStage: params.failureStage,
        correlationId: params.correlationId,
        sourceIp: params.sourceIp,
        authResult: params.authResult,
        notificationType: params.notificationType,
        consignmentId: params.consignmentId,
        invoice: params.invoice,
        courierEvent: params.courierEvent,
        message: params.message,
        isDuplicate: params.isDuplicate ?? false,
        completedAt: new Date(),
        durationMs: params.durationMs,
      },
    });
    return attempt.id;
  }

  async startAttempt(
    courier: string,
    path: string,
    correlationId?: string,
    sourceIp?: string,
  ): Promise<{ id: string; receivedAt: Date }> {
    const attempt = await this.prisma.webhookAttempt.create({
      data: {
        courier,
        path,
        correlationId,
        sourceIp,
        outcome: WebhookAttemptOutcome.UNKNOWN_ERROR,
      },
    });
    return { id: attempt.id, receivedAt: attempt.receivedAt };
  }

  async completeAttempt(
    id: string,
    params: {
      responseStatus?: number;
      outcome: WebhookAttemptOutcome;
      failureStage?: WebhookAttemptStage;
      authResult?: string;
      notificationType?: string;
      consignmentId?: string;
      invoice?: string;
      courierEvent?: string;
      message?: string;
      isDuplicate?: boolean;
      durationMs?: number;
    },
  ): Promise<void> {
    await this.prisma.webhookAttempt.update({
      where: { id },
      data: {
        responseStatus: params.responseStatus,
        outcome: params.outcome,
        failureStage: params.failureStage,
        authResult: params.authResult,
        notificationType: params.notificationType,
        consignmentId: params.consignmentId,
        invoice: params.invoice,
        courierEvent: params.courierEvent,
        message: params.message,
        isDuplicate: params.isDuplicate ?? false,
        completedAt: new Date(),
        durationMs: params.durationMs,
      },
    });
  }

  async getSummary(courier: string): Promise<WebhookAttemptSummary> {
    const [lastReceived, lastSuccess, lastFailure] = await Promise.all([
      this.prisma.webhookAttempt.findFirst({
        where: { courier },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true, responseStatus: true },
      }),
      this.prisma.webhookAttempt.findFirst({
        where: { courier, outcome: 'SUCCESS' },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      }),
      this.prisma.webhookAttempt.findFirst({
        where: { courier, outcome: { not: 'SUCCESS' } },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true, outcome: true, message: true, responseStatus: true },
      }),
    ]);

    return {
      lastReceivedAt: lastReceived?.receivedAt ?? null,
      lastSuccessAt: lastSuccess?.receivedAt ?? null,
      lastFailureAt: lastFailure?.receivedAt ?? null,
      lastHttpStatus: lastReceived?.responseStatus ?? null,
      lastFailureReason: lastFailure
        ? `${lastFailure.outcome}${lastFailure.message ? `: ${lastFailure.message}` : ''}`
        : null,
    };
  }

  async getRecentAttempts(
    courier: string,
    opts?: { outcome?: WebhookAttemptOutcome; limit?: number },
  ): Promise<unknown[]> {
    const limit = Math.min(opts?.limit ?? 20, MAX_RECENT_ATTEMPTS);
    return this.prisma.webhookAttempt.findMany({
      where: {
        courier,
        ...(opts?.outcome ? { outcome: opts.outcome } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        receivedAt: true,
        completedAt: true,
        durationMs: true,
        responseStatus: true,
        outcome: true,
        failureStage: true,
        correlationId: true,
        notificationType: true,
        consignmentId: true,
        invoice: true,
        courierEvent: true,
        message: true,
        isDuplicate: true,
        authResult: true,
      },
    });
  }

  async getAttemptDetail(id: string): Promise<unknown> {
    return this.prisma.webhookAttempt.findUnique({
      where: { id },
      select: {
        id: true,
        courier: true,
        receivedAt: true,
        completedAt: true,
        durationMs: true,
        method: true,
        path: true,
        responseStatus: true,
        outcome: true,
        failureStage: true,
        correlationId: true,
        sourceIp: true,
        authResult: true,
        notificationType: true,
        consignmentId: true,
        invoice: true,
        courierEvent: true,
        message: true,
        isDuplicate: true,
      },
    });
  }

  async cleanupOldAttempts(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const result = await this.prisma.webhookAttempt.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} webhook attempts older than ${RETENTION_DAYS} days`);
    }
    return result.count;
  }
}
