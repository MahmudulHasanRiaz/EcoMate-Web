import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ImportJob } from './import-queue.service';

@Processor('import')
export class ImportQueueProcessor extends WorkerHost {
  async process(job: Job<ImportJob>): Promise<void> {
    console.log(
      `[ImportQueue] Processing ${job.data.type} import for user ${job.data.userId}`,
    );
  }
}
