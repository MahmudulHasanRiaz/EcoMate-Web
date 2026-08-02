import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  DispatchJob,
  TrackingDispatcherService,
} from './tracking-dispatcher.service';

/**
 * BullMQ worker for the `tracking` queue (replaces the legacy TrackingQueueProcessor,
 * whose job shape was the pre-capture `TrackingJob`). Each job is an outbox relay
 * claim — `{ snapshotId, outboxId, attemptCount }` — handed to the dispatcher, which
 * resolves the snapshot + context and drives every provider adapter independently.
 */
@Processor('tracking')
export class TrackingDispatcherProcessor extends WorkerHost {
  constructor(private readonly dispatcher: TrackingDispatcherService) {
    super();
  }

  async process(job: Job<DispatchJob>): Promise<void> {
    await this.dispatcher.process(job.data, job.id?.toString());
  }
}
