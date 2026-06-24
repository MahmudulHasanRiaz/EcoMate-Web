import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface ImportJob {
  type: 'products' | 'orders';
  filePath: string;
  userId: string;
}

@Injectable()
export class ImportQueueService {
  constructor(@InjectQueue('import') private importQueue: Queue) {}

  async schedule(data: ImportJob) {
    await this.importQueue.add('process', data);
  }
}
