/**
 * Hourly order-reconcile scheduler — central-commerce P6 (BR-10).
 *
 * Registers the idempotent BullMQ repeatable (`order-reconcile-tick`,
 * hourly, Asia/Dhaka) on module init. The tick itself only enqueues
 * per-store bounded jobs (BR-21); the 3-day window + widening bounds live in
 * StoreOrderReconcileService. Multi-instance-safe: repeatable jobs are owned
 * by Redis, not the process (§3.3 convention).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class StoreOrderScheduler implements OnModuleInit {
  private readonly logger = new Logger(StoreOrderScheduler.name);

  constructor(
    @InjectQueue('store-reconcile') private readonly reconcileQ: Queue,
  ) {}

  async onModuleInit() {
    try {
      const repeats = await this.reconcileQ.getRepeatableJobs();
      const has = repeats.some((r) => r.name === 'order-reconcile-tick');
      if (!has) {
        await this.reconcileQ.add(
          'order-reconcile-tick',
          {},
          {
            repeat: {
              pattern: '0 * * * *',
              tz: 'Asia/Dhaka',
            },
            removeOnComplete: 20,
            removeOnFail: 20,
          },
        );
        this.logger.log('registered hourly order-reconcile-tick (Asia/Dhaka)');
      }
    } catch (err) {
      // Redis unavailable in unit-test context — the tick simply doesn't run.
      this.logger.warn(`order reconcile scheduler not registered: ${err}`);
    }
  }
}
