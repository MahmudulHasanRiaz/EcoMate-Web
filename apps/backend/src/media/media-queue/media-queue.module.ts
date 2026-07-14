import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from '../../storage/storage.service';
import { MediaQueueService } from './media-queue.service';
import { MediaQueueProcessor } from './media-queue.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'media' }), PrismaModule],
  providers: [MediaQueueService, MediaQueueProcessor, StorageService],
  exports: [MediaQueueService],
})
export class MediaQueueModule {}
