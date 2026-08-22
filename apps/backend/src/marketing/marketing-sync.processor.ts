import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { MarketingSyncService } from './marketing-sync.service';
import { MARKETING_QUEUE } from './marketing.constants';

export interface MarketingJob {
  type: 'sync-all' | 'sync-account';
  adAccountId?: string;
  forceInsights?: boolean;
}

@Processor(MARKETING_QUEUE)
export class MarketingSyncProcessor extends WorkerHost {
  constructor(private readonly sync: MarketingSyncService) {
    super();
  }

  async process(job: Job<MarketingJob>): Promise<any> {
    if (job.data.type === 'sync-account' && job.data.adAccountId) {
      return this.sync.syncAdAccount(job.data.adAccountId, job.data.forceInsights);
    }
    return this.sync.syncAll(job.data.forceInsights);
  }
}

export async function enqueueMarketingSync(
  queue: Queue<MarketingJob, any, string>,
  payload: MarketingJob,
  jobId?: string,
) {
  return queue.add(payload.type, payload, {
    ...(jobId ? { jobId } : {}),
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 200,
    removeOnFail: 100,
  });
}