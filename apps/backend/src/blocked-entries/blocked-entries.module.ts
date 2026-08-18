import { Module } from '@nestjs/common';
import {
  BlockedEntriesController,
  BlockedEntriesPublicController,
} from './blocked-entries.controller';
import { BlockedEntriesService } from './blocked-entries.service';

@Module({
  controllers: [BlockedEntriesController, BlockedEntriesPublicController],
  providers: [BlockedEntriesService],
  exports: [BlockedEntriesService],
})
export class BlockedEntriesModule {}
