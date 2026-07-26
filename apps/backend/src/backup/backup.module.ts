import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';
import {
  BackupController,
  BackupDownloadController,
} from './backup.controller';
import { BackupJobProcessor } from './backup-job.processor';
import { StorageService } from '../storage/storage.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: 'backup' },
      { name: 'email' },
      { name: 'import' },
      { name: 'tracking' },
      { name: 'security-events' },
      { name: 'security-aggregate' },
    ),
  ],
  controllers: [BackupController, BackupDownloadController],
  providers: [BackupService, BackupJobProcessor, StorageService],
  exports: [BackupService],
})
export class BackupModule {}
