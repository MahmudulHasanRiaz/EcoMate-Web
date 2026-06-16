import { Module } from '@nestjs/common';
import { BlockSettingsController } from './block-settings.controller';
import { BlockSettingsService } from './block-settings.service';

@Module({
  controllers: [BlockSettingsController],
  providers: [BlockSettingsService],
  exports: [BlockSettingsService],
})
export class BlockSettingsModule {}
