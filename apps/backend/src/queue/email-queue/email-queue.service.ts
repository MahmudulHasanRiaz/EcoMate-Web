import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface EmailJob {
  to: string;
  subject: string;
  template?: string;
  context?: Record<string, any>;
}

@Injectable()
export class EmailQueueService {
  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async send(data: EmailJob) {
    if (!data.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.to)) {
      throw new Error(`Invalid email address: ${data.to}`);
    }
    await this.emailQueue.add('send', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
