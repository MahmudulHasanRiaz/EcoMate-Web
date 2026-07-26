import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

const BACKUP_MAINTENANCE_CACHE_KEY = 'system:backup-maintenance';

export interface MediaJob {
  mediaId: string;
}

@Injectable()
export class MediaQueueService implements OnModuleInit {
  private readonly logger = new Logger(MediaQueueService.name);

  constructor(
    @InjectQueue('media') private mediaQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Bull's queue pause is global. A second backend replica must not resume it
    // while another replica is taking a full snapshot or restoring one.
    const maintenance = await this.cache.get(BACKUP_MAINTENANCE_CACHE_KEY);
    let durableOwner = true;
    try {
      const restoreSignals = await this.prisma.$queryRaw<
        Array<{ active: boolean }>
      >(
        Prisma.sql`
          SELECT (
            EXISTS (
              SELECT 1
              FROM pg_stat_activity
              WHERE datname = current_database()
                AND application_name = 'ecomate-backup-restore'
            )
            OR EXISTS (
              SELECT 1
              FROM "ecomate_control"."backup_restore_operation"
              WHERE "phase" IN (
                'preparing',
                'database_committed',
                'failed_after_commit'
              )
            )
          ) AS "active"
        `,
      );
      durableOwner =
        Boolean(restoreSignals[0]?.active) ||
        Boolean(
          await this.prisma.backupJob.findFirst({
            where: {
              OR: [
                { status: 'restoring' },
                { status: 'running', scope: 'db_files' },
              ],
            },
            select: { id: true },
          }),
        );
    } catch {
      // Fail closed while migrations/restore may make the lifecycle catalog
      // temporarily unavailable.
      durableOwner = true;
    }
    if (!maintenance && !durableOwner) {
      await this.mediaQueue.resume();
    } else {
      await this.mediaQueue.pause();
      this.logger.log('Media queue remains paused for backup maintenance');
    }
    await this.mediaQueue.removeRepeatable('recover', { every: 300_000 });
    await this.mediaQueue.add(
      'recover',
      {},
      {
        repeat: { every: 300_000 },
        attempts: 1,
      },
    );
    this.logger.log('Registered periodic recovery job (every 5 minutes)');
  }

  async pauseAndDrain(timeoutMs = 60_000): Promise<void> {
    await this.mediaQueue.pause();
    const deadline = Date.now() + timeoutMs;
    while ((await this.mediaQueue.getActiveCount()) > 0) {
      if (Date.now() >= deadline) {
        throw new Error(
          'Timed out waiting for active media processing before backup maintenance',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async resume(): Promise<void> {
    await this.mediaQueue.resume();
  }

  async schedule(
    mediaId: string,
    options: { priority?: number } = {},
  ): Promise<void> {
    await this.mediaQueue.add('process', { mediaId } satisfies MediaJob, {
      jobId: `media-${mediaId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
      ...options,
    });
  }

  async deleteDerivatives(
    mediaId: string,
    manifestSnapshot?: unknown,
  ): Promise<void> {
    const manifestValue =
      manifestSnapshot === undefined
        ? (
            await this.prisma.media.findUnique({
              where: { id: mediaId },
              select: { derivativeManifest: true },
            })
          )?.derivativeManifest
        : manifestSnapshot;
    if (
      !manifestValue ||
      typeof manifestValue !== 'object' ||
      Array.isArray(manifestValue)
    ) {
      return;
    }

    const manifest = manifestValue as Record<string, unknown>;
    const r2Base = await this.getR2PublicBase();

    for (const url of Object.values(manifest)) {
      if (typeof url !== 'string') continue;
      let key: string;
      if (url.startsWith('/uploads/')) {
        key = url.replace('/uploads/', '');
      } else if (r2Base && url.startsWith(r2Base)) {
        key = url.replace(r2Base, '');
      } else {
        continue;
      }
      await this.storage.delete(key).catch(() => {});
    }
    this.logger.log(`Cleaned up derivatives for media ${mediaId}`);
  }

  private async getR2PublicBase(): Promise<string | null> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: 'storage_r2_public_url' },
      });
      if (row?.value) return row.value.replace(/\/$/, '') + '/';
    } catch {}
    return null;
  }

  async recoverStuck(sinceMinutes = 5): Promise<{ recovered: number }> {
    const cutoff = new Date(Date.now() - sinceMinutes * 60_000);
    const stuck = await this.prisma.media.findMany({
      where: {
        processingStatus: { in: ['UPLOADED', 'PROCESSING'] },
        updatedAt: { lt: cutoff },
      },
      take: 200,
      select: { id: true },
    });

    for (const media of stuck) {
      await this.schedule(media.id, { priority: 100 });
    }

    if (stuck.length > 0) {
      this.logger.log(`Recovery: re-queued ${stuck.length} stuck media`);
    }
    return { recovered: stuck.length };
  }

  async backfill(
    opts: { batchSize?: number; max?: number } = {},
  ): Promise<{ queued: number }> {
    const batchSize = Math.min(opts.batchSize ?? 50, 100);
    const maxEnqueue = opts.max ?? 10_000;
    let cursor: string | undefined;
    let queued = 0;

    while (queued < maxEnqueue) {
      const batch = await this.prisma.media.findMany({
        where: { processingStatus: 'UPLOADED' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: batchSize,
        orderBy: { id: 'asc' },
        select: { id: true },
      });

      if (batch.length === 0) break;

      const remaining = maxEnqueue - queued;
      const toEnqueue = batch.slice(0, remaining);

      for (const media of toEnqueue) {
        await this.schedule(media.id, { priority: 100 });
        queued++;
      }

      cursor = batch[batch.length - 1].id;
      if (toEnqueue.length < batch.length) break;
    }

    this.logger.log(`Backfill queued ${queued} media for processing`);
    return { queued };
  }
}
