import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupJobProcessor } from './backup-job.processor';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'backup' }),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupJobProcessor],
  exports: [BackupService],
})
export class BackupModule {}