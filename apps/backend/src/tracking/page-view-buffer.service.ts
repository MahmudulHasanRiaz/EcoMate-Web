import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface PageViewEntry {
  url: string;
  referrer: string | null;
  source: string | null;
  userAgent: string;
  ip: string;
  sessionId: string | null;
  timestamp: Date;
}

@Injectable()
export class PageViewBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(PageViewBufferService.name);
  private buffer: PageViewEntry[] = [];
  private readonly FLUSH_INTERVAL = 5_000;
  private readonly FLUSH_THRESHOLD = 100;
  private flushTimer: ReturnType<typeof setInterval>;
  private activeFlush: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error(`Timer flush failed: ${(err as Error).message}`);
      });
    }, this.FLUSH_INTERVAL);
  }

  push(entry: PageViewEntry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.FLUSH_THRESHOLD) {
      this.flush().catch((err) => {
        this.logger.error(`Threshold flush failed: ${(err as Error).message}`);
      });
    }
  }

  async flush(): Promise<void> {
    if (this.activeFlush) return this.activeFlush;
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    const promise = this.prisma.pageView
      .createMany({
        data: batch,
        skipDuplicates: true,
      })
      .then(() => {
        this.logger.debug(`Flushed ${batch.length} page views`);
      })
      .catch((err: unknown) => {
        // Requeue failed batch at front, preserving original order
        this.buffer.unshift(...batch);
        this.logger.error(
          `Batch insert failed (${batch.length} entries requeued): ${(err as Error).message}`,
        );
        throw err;
      });

    this.activeFlush = promise;

    try {
      await promise;
    } finally {
      if (this.activeFlush === promise) {
        this.activeFlush = null;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);

    // Await any active flush (rejected batch already requeued)
    if (this.activeFlush) {
      try {
        await this.activeFlush;
      } catch {
        /* entries already requeued */
      }
    }

    // One final bounded drain — no loop
    if (this.buffer.length > 0) {
      try {
        await this.flush();
      } catch {
        this.logger.error(
          `Failed to flush ${this.buffer.length} page views during shutdown — data retained in memory`,
        );
      }
    }
  }
}
