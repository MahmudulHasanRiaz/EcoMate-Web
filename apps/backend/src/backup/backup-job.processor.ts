import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BackupService } from './backup.service';

interface BackupJobData {
  backupId?: string;
  scope?: 'db_only' | 'db_files';
  type?: 'manual' | 'scheduled';
}

@Processor('backup')
export class BackupJobProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupJobProcessor.name);

  constructor(private readonly backup: BackupService) {
    super();
  }

  async process(job: Job<BackupJobData>): Promise<void> {
    const data = job.data;

    if (data.backupId) {
      await this.backup.runBackupPipeline(data.backupId);
    } else if (data.type === 'scheduled') {
      const { id } = await this.backup.triggerManual(data.scope || 'db_only');
    }
  }
}
