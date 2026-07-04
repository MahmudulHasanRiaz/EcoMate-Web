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
  private flushing = false;

  constructor(private readonly prisma: PrismaService) {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
  }

  push(entry: PageViewEntry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  async flush() {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    try {
      await this.prisma.pageView.createMany({ data: batch, skipDuplicates: true });
      this.logger.debug(`Flushed ${batch.length} page views`);
    } catch (err) {
      this.logger.error(`Batch insert failed: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  onModuleDestroy() {
    clearInterval(this.flushTimer);
    this.flush();
  }
}
