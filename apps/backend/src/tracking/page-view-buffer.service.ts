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
  // SECURITY (2026-10-25, F20): hard cap. The old buffer was unbounded:
  // a sustained flood (or a DB outage that kept requeueing failed
  // batches) grew process memory without limit. Over-cap entries are
  // dropped oldest-first and counted — losing page-view analytics under
  // flood is acceptable; OOMing the API is not.
  private readonly MAX_BUFFER = 10_000;
  private droppedCount = 0;
  private flushTimer: ReturnType<typeof setInterval>;
  private activeFlush: Promise<void> | null = null;

  /** Entries discarded by the cap (monitoring/tests). */
  getDroppedCount(): number {
    return this.droppedCount;
  }

  constructor(private readonly prisma: PrismaService) {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error(`Timer flush failed: ${(err as Error).message}`);
      });
    }, this.FLUSH_INTERVAL);
  }

  push(entry: PageViewEntry) {
    if (this.buffer.length >= this.MAX_BUFFER) {
      this.buffer.shift();
      this.droppedCount++;
      if (this.droppedCount % 1000 === 0) {
        this.logger.warn(
          `Page-view buffer cap hit: ${this.droppedCount} entries dropped (oldest-first)`,
        );
      }
    }
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

    const promise = this.flushBufferedEntries();
    this.activeFlush = promise;

    try {
      await promise;
    } finally {
      if (this.activeFlush === promise) {
        this.activeFlush = null;
      }
    }
  }

  private async flushBufferedEntries(): Promise<void> {
    // Keep the batch in memory while `public` is being replaced.  Splicing
    // only after the durable restore guard passes also makes the skipped
    // flush lossless; the next timer tick will retry it.
    if (await this.prisma.isRestoreWriteBlocked()) return;
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    try {
      await this.prisma.pageView.createMany({
        data: batch,
        skipDuplicates: true,
      });
      this.logger.debug(`Flushed ${batch.length} page views`);
    } catch (err: unknown) {
      // Requeue failed batch at front, preserving original order — but
      // still capped: a batch requeued while new views arrived must not
      // push the buffer past MAX_BUFFER.
      const overflow = this.buffer.length + batch.length - this.MAX_BUFFER;
      const requeued = [...batch, ...this.buffer].slice(0, this.MAX_BUFFER);
      if (overflow > 0) {
        this.droppedCount += overflow;
        this.logger.warn(
          `Page-view buffer cap hit on requeue: ${overflow} entries dropped`,
        );
      }
      this.buffer = requeued;
      this.logger.error(
        `Batch insert failed (${batch.length} entries requeued): ${(err as Error).message}`,
      );
      throw err;
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
