import { Module } from '@nestjs/common';
import { BlockedEntriesController } from './blocked-entries.controller';
import { BlockedEntriesService } from './blocked-entries.service';

@Module({
  controllers: [BlockedEntriesController],
  providers: [BlockedEntriesService],
  exports: [BlockedEntriesService],
})
export class BlockedEntriesModule {}
