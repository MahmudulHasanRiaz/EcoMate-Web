import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Periodic aggregation recalculation and retention cleanup.
 *
 * Handles two concerns:
 *  1. Recalculate hourly/daily/block aggregates from raw events
 *     (runs as a fallback to ensure accuracy even if a processor missed an update)
 *  2. Clean up expired events per SecurityRetentionPolicy
 */
@Injectable()
export class EventAggregatorService {
  private readonly logger = new Logger(EventAggregatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalculate hourly aggregates for a given time range.
   * Idempotent — safe to call multiple times.
   */
  async recalculateHourly(from: Date, to: Date): Promise<number> {
    // Delete existing aggregates in the range, then re-insert from raw events
    await this.prisma.securityEventHourly.deleteMany({
      where: {
        bucket: { gte: from, lte: to },
      },
    });

    const result = await this.prisma.$executeRawUnsafe(`
      INSERT INTO "SecurityEventHourly" ("id", "tenant", "bucket", "eventType", "severity", "category", "count", "updatedAt")
      SELECT
        gen_random_uuid()::text,
        "tenant",
        date_trunc('hour', "timestamp") as bucket,
        "eventType",
        "severity",
        "category",
        COUNT(*)::int as count,
        NOW() as "updatedAt"
      FROM "SecurityEvent"
      WHERE "timestamp" >= $1 AND "timestamp" <= $2
      GROUP BY "tenant", date_trunc('hour', "timestamp"), "eventType", "severity", "category"
      ON CONFLICT ("tenant", "bucket", "eventType", "severity", "category")
      DO UPDATE SET "count" = EXCLUDED."count", "updatedAt" = NOW()
    `, from.toISOString(), to.toISOString());

    const count = Number(result) || 0;
    this.logger.log(`Recalculated ${count} hourly aggregate rows`);
    return count;
  }

  /**
   * Recalculate daily aggregates for a given date range.
   */
  async recalculateDaily(from: Date, to: Date): Promise<number> {
    await this.prisma.securityEventDaily.deleteMany({
      where: {
        date: { gte: from, lte: to },
      },
    });

    const result = await this.prisma.$executeRawUnsafe(`
      INSERT INTO "SecurityEventDaily" ("id", "tenant", "date", "eventType", "severity", "category", "count", "updatedAt")
      SELECT
        gen_random_uuid()::text,
        "tenant",
        date_trunc('day', "timestamp")::date as day,
        "eventType",
        "severity",
        "category",
        COUNT(*)::int as count,
        NOW() as "updatedAt"
      FROM "SecurityEvent"
      WHERE "timestamp" >= $1 AND "timestamp" <= $2
      GROUP BY "tenant", date_trunc('day', "timestamp"), "eventType", "severity", "category"
      ON CONFLICT ("tenant", "date", "eventType", "severity", "category")
      DO UPDATE SET "count" = EXCLUDED."count", "updatedAt" = NOW()
    `, from.toISOString(), to.toISOString());

    const count = Number(result) || 0;
    this.logger.log(`Recalculated ${count} daily aggregate rows`);
    return count;
  }

  /**
   * Delete expired raw events per retention policy.
   * Uses batched DELETE with SKIP LOCKED to avoid long table locks.
   */
  async cleanExpiredEvents(): Promise<{ deleted: number }> {
    const policies = await this.prisma.securityRetentionPolicy.findMany();
    let totalDeleted = 0;

    // Application-level defaults when no DB policy row exists
    const defaultPolicies: Array<{
      category: string;
      severity: string;
      days: number;
      criticalDays: number | null;
    }> = [
      { category: 'RATE_LIMIT', severity: 'INFO', days: 30, criticalDays: null },
      { category: 'RATE_LIMIT', severity: 'LOW', days: 30, criticalDays: null },
      { category: 'RATE_LIMIT', severity: 'MEDIUM', days: 30, criticalDays: null },
      { category: 'RATE_LIMIT', severity: 'HIGH', days: 90, criticalDays: null },
      { category: 'RATE_LIMIT', severity: 'CRITICAL', days: 180, criticalDays: 365 },
      { category: 'AUTH', severity: 'INFO', days: 30, criticalDays: null },
      { category: 'AUTH', severity: 'LOW', days: 90, criticalDays: null },
      { category: 'AUTH', severity: 'MEDIUM', days: 90, criticalDays: null },
      { category: 'AUTH', severity: 'HIGH', days: 180, criticalDays: null },
      { category: 'AUTH', severity: 'CRITICAL', days: 365, criticalDays: 730 },
      { category: 'BLOCK', severity: 'INFO', days: 90, criticalDays: null },
      { category: 'BLOCK', severity: 'LOW', days: 90, criticalDays: null },
      { category: 'BLOCK', severity: 'MEDIUM', days: 90, criticalDays: null },
      { category: 'BLOCK', severity: 'HIGH', days: 180, criticalDays: null },
      { category: 'BLOCK', severity: 'CRITICAL', days: 365, criticalDays: 730 },
      { category: 'SYSTEM', severity: 'INFO', days: 30, criticalDays: null },
      { category: 'SYSTEM', severity: 'LOW', days: 30, criticalDays: null },
      { category: 'SYSTEM', severity: 'MEDIUM', days: 30, criticalDays: null },
      { category: 'SYSTEM', severity: 'HIGH', days: 90, criticalDays: null },
      { category: 'SYSTEM', severity: 'CRITICAL', days: 180, criticalDays: 365 },
    ];

    const allPolicies = new Map<string, { days: number; criticalDays: number | null }>();

    for (const p of policies) {
      allPolicies.set(`${p.category}:${p.severity}`, {
        days: p.retentionDays,
        criticalDays: p.criticalRetentionDays,
      });
    }
    for (const p of defaultPolicies) {
      if (!allPolicies.has(`${p.category}:${p.severity}`)) {
        allPolicies.set(`${p.category}:${p.severity}`, {
          days: p.days,
          criticalDays: p.criticalDays,
        });
      }
    }

    for (const [key, policy] of allPolicies) {
      const [category, severity] = key.split(':');
      const cutoff = new Date(Date.now() - policy.days * 86400000);

      // Batch delete non-override events
      let batch: number;
      do {
        batch = await this.prisma.$executeRaw`
          DELETE FROM "SecurityEvent"
          WHERE "id" IN (
            SELECT "id" FROM "SecurityEvent"
            WHERE "createdAt" < ${cutoff}
              AND "category"::text = ${category}
              AND "severity"::text = ${severity}
              AND "retentionOverride" = false
            LIMIT 1000
            FOR UPDATE SKIP LOCKED
          )
        `;
        totalDeleted += Number(batch);
        if (Number(batch) === 1000) {
          await new Promise((r) => setTimeout(r, 50)); // yield between batches
        }
      } while (Number(batch) === 1000);

      // Critical override: delete retentionOverride=true events past criticalDays
      if (policy.criticalDays) {
        const criticalCutoff = new Date(Date.now() - policy.criticalDays * 86400000);
        do {
          batch = await this.prisma.$executeRaw`
            DELETE FROM "SecurityEvent"
            WHERE "id" IN (
              SELECT "id" FROM "SecurityEvent"
              WHERE "createdAt" < ${criticalCutoff}
                AND "category"::text = ${category}
                AND "severity"::text = ${severity}
                AND "retentionOverride" = true
              LIMIT 1000
              FOR UPDATE SKIP LOCKED
            )
          `;
          totalDeleted += Number(batch);
          if (Number(batch) === 1000) {
            await new Promise((r) => setTimeout(r, 50));
          }
        } while (Number(batch) === 1000);
      }
    }

    // Clean stale aggregates older than 365 days
    const aggCutoff = new Date(Date.now() - 365 * 86400000);
    await this.prisma.securityEventHourly.deleteMany({
      where: { bucket: { lt: aggCutoff } },
    });
    await this.prisma.securityEventDaily.deleteMany({
      where: { date: { lt: aggCutoff } },
    });
    await this.prisma.securityBlockDaily.deleteMany({
      where: { date: { lt: aggCutoff } },
    });

    if (totalDeleted > 0) {
      this.logger.log(`Retention cleanup: deleted ${totalDeleted} expired events`);
    }
    return { deleted: totalDeleted };
  }
}
