import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmailJob } from './email-queue.service';

@Processor('email')
export class EmailQueueProcessor extends WorkerHost {
  async process(job: Job<EmailJob>): Promise<void> {
    const { to, subject } = job.data;
    console.log(`[EmailQueue] Sending email to ${to}: ${subject}`);
  }
}
