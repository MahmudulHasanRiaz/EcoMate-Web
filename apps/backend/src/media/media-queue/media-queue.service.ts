import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

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
  ) {}

  async onModuleInit(): Promise<void> {
    await this.mediaQueue.removeRepeatable('recover', { every: 300_000 });
    await this.mediaQueue.add('recover', {}, {
      repeat: { every: 300_000 },
      attempts: 1,
    });
    this.logger.log('Registered periodic recovery job (every 5 minutes)');
  }

  async schedule(mediaId: string): Promise<void> {
    await this.mediaQueue.add('process', { mediaId } satisfies MediaJob, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  async deleteDerivatives(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { derivativeManifest: true },
    });
    if (!media?.derivativeManifest) return;

    const manifest = media.derivativeManifest as Record<string, string>;
    const r2Base = await this.getR2PublicBase();

    for (const url of Object.values(manifest)) {
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
        processingStatus: 'UPLOADED',
        createdAt: { lt: cutoff },
      },
      take: 200,
      select: { id: true },
    });

    for (const media of stuck) {
      await this.mediaQueue.add('process', { mediaId: media.id } satisfies MediaJob, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        priority: 100,
      });
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
        await this.mediaQueue.add('process', { mediaId: media.id } satisfies MediaJob, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          priority: 100,
        });
        queued++;
      }

      cursor = batch[batch.length - 1].id;
      if (toEnqueue.length < batch.length) break;
    }

    this.logger.log(`Backfill queued ${queued} media for processing`);
    return { queued };
  }
}
