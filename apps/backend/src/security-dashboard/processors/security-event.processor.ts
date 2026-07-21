import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventCategory, SecurityEventSeverity } from '@prisma/client';

interface EventJobData {
  id: string;
  dedupKey: string;
  tenant: string;
  eventType: string;
  severity: SecurityEventSeverity;
  category: SecurityEventCategory;
  source: string;
  timestamp: string;
  actorType: string;
  ipAddress?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  browserTrustId?: string | null;
  phone?: string | null;
  trustTier?: string | null;
  riskScore?: number | null;
  metadataVersion: number;
  metadata: Record<string, unknown>;
  correlationId?: string | null;
  parentCorrelationId?: string | null;
  description?: string | null;
  retentionOverride?: boolean;
}

@Processor('security-events')
export class SecurityEventProcessor extends WorkerHost {
  private readonly logger = new Logger(SecurityEventProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<EventJobData>): Promise<void> {
    const data = job.data;

    try {
      // ── Step 1: Insert raw event (dedupKey constraint handles retry duplicates) ──
      await this.prisma.securityEvent
        .create({
          data: {
            id: data.id,
            dedupKey: data.dedupKey,
            tenant: data.tenant,
            eventType: data.eventType,
            severity: data.severity,
            category: data.category,
            source: data.source,
            timestamp: new Date(data.timestamp),
            actorType: data.actorType as any,
            ipAddress: data.ipAddress ?? null,
            userId: data.userId ?? null,
            sessionId: data.sessionId ?? null,
            browserTrustId: data.browserTrustId ?? null,
            phone: data.phone ?? null,
            trustTier: data.trustTier ?? null,
            riskScore: data.riskScore ?? null,
            metadataVersion: data.metadataVersion,
            metadata: data.metadata as any,
            correlationId: data.correlationId ?? null,
            parentCorrelationId: data.parentCorrelationId ?? null,
            description: data.description ?? null,
            retentionOverride: data.retentionOverride ?? false,
          },
        })
        .catch((err: any) => {
          // P2002 = unique constraint violation (dedupKey collision) — expected on retry
          if (err?.code === 'P2002') {
            this.logger.debug(`DedupKey collision (expected on retry): ${data.dedupKey}`);
            return null;
          }
          throw err;
        });

      // ── Step 2: Update hourly aggregate ──
      const hour = new Date(data.timestamp);
      hour.setMinutes(0, 0, 0);

      await this.prisma.securityEventHourly.upsert({
        where: {
          tenant_bucket_eventType_severity_category: {
            tenant: data.tenant,
            bucket: hour,
            eventType: data.eventType,
            severity: data.severity,
            category: data.category,
          },
        },
        create: {
          tenant: data.tenant,
          bucket: hour,
          eventType: data.eventType,
          severity: data.severity,
          category: data.category,
          count: 1,
        },
        update: { count: { increment: 1 } },
      });

      // ── Step 3: Update daily aggregate ──
      const day = new Date(data.timestamp);
      day.setHours(0, 0, 0, 0);

      await this.prisma.securityEventDaily.upsert({
        where: {
          tenant_date_eventType_severity_category: {
            tenant: data.tenant,
            date: day,
            eventType: data.eventType,
            severity: data.severity,
            category: data.category,
          },
        },
        create: {
          tenant: data.tenant,
          date: day,
          eventType: data.eventType,
          severity: data.severity,
          category: data.category,
          count: 1,
        },
        update: { count: { increment: 1 } },
      });

      // ── Step 4: Update block daily summary (only for block-related events) ──
      if (
        data.eventType === 'auto_block_created' ||
        data.eventType === 'block_created_manual' ||
        data.eventType === 'block_unblocked'
      ) {
        const blockSource =
          data.eventType === 'auto_block_created' ? 'auto' : 'manual';
        const targetType = data.ipAddress ? 'ip' : 'phone';

        const isIncrement = data.eventType !== 'block_unblocked';

        await this.prisma.securityBlockDaily.upsert({
          where: {
            tenant_date_blockSource_targetType: {
              tenant: data.tenant,
              date: day,
              blockSource,
              targetType,
            },
          },
          create: {
            tenant: data.tenant,
            date: day,
            blockSource,
            targetType,
            count: isIncrement ? 1 : 0,
          },
          update: {
            count: isIncrement ? { increment: 1 } : { decrement: 1 },
          },
        });
      }

      this.logger.debug(`Processed event ${data.id}: ${data.eventType}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to process security event ${data.id}: ${message}`,
      );
      // Re-throw to trigger BullMQ retry/DLQ
      throw err;
    }
  }
}
