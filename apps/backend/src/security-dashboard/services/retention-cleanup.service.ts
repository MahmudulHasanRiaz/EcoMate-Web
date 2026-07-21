import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventAggregatorService } from './event-aggregator.service';

/**
 * Periodic retention cleanup job.
 * Runs every 6 hours via OnModuleInit interval.
 * Cleans expired SecurityEvent rows and stale aggregates per
 * SecurityRetentionPolicy configuration.
 */
@Injectable()
export class RetentionCleanupService implements OnModuleInit {
  private readonly logger = new Logger(RetentionCleanupService.name);
  private readonly CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

  constructor(private readonly aggregator: EventAggregatorService) {}

  onModuleInit() {
    // Run first cleanup after 1 hour (gives system time to start)
    setTimeout(() => this.runCleanup(), 3600_000);
    // Then repeat every 6 hours
    setInterval(() => this.runCleanup(), this.CLEANUP_INTERVAL_MS);
    this.logger.log('Retention cleanup scheduled: every 6 hours');
  }

  private async runCleanup() {
    this.logger.log('Starting periodic retention cleanup...');
    try {
      const result = await this.aggregator.cleanExpiredEvents();
      if (result.deleted > 0) {
        this.logger.log(`Retention cleanup: ${result.deleted} events removed`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Retention cleanup failed: ${message}`);
    }
  }

  /**
   * One-shot cleanup (for manual trigger or first deployment).
   */
  async runOnce(): Promise<{ deleted: number }> {
    return this.aggregator.cleanExpiredEvents();
  }
}
