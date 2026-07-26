import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  BackupService,
  type LegacyBackupMigrationData,
  type QueuedRestoreData,
} from './backup.service';

interface BackupJobData {
  operation?: 'restore' | 'migrate-legacy' | 'reconcile';
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

    if (data.operation === 'reconcile' || job.name === 'lifecycle-recovery') {
      await this.backup.reconcileLifecycleJobs();
    } else if (data.operation === 'restore') {
      await this.backup.runQueuedRestore(data as unknown as QueuedRestoreData);
    } else if (data.operation === 'migrate-legacy') {
      await this.backup.migrateLegacyBackup(
        data as unknown as LegacyBackupMigrationData,
      );
    } else if (data.backupId) {
      await this.backup.runBackupPipeline(data.backupId);
    } else if (data.type === 'scheduled') {
      await this.backup.triggerScheduled(data.scope || 'db_only');
    }
  }
}
