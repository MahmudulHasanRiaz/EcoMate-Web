import { Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { StorageService } from '../storage/storage.service';
import { MediaService } from '../media/media.service';

@Module({
  controllers: [SystemSettingsController],
  providers: [StorageService, MediaService],
})
export class SystemSettingsModule {}
