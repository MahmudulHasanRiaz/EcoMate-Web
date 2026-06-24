import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportQueueService } from './import-queue.service';
import { ImportQueueProcessor } from './import-queue.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'import' })],
  providers: [ImportQueueService, ImportQueueProcessor],
  exports: [ImportQueueService],
})
export class ImportQueueModule {}
