import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface TrackingJob {
  eventId: string;
  eventName: string;
  eventTime: number;
  userId?: string;
  userData: Record<string, any>;
  customData?: Record<string, any>;
}

@Injectable()
export class TrackingQueueService {
  private readonly logger = new Logger(TrackingQueueService.name);

  constructor(@InjectQueue('tracking') private trackingQueue: Queue) {}

  async enqueue(job: TrackingJob) {
    try {
      await this.trackingQueue.add('send', job, {
        jobId: job.eventId,
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      this.logger.debug(`Tracking event queued: ${job.eventName} [${job.eventId}]`);
    } catch (err) {
      this.logger.error(`Failed to enqueue tracking event: ${err}`);
    }
  }
}
