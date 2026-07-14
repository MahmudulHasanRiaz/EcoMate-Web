import { Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { StorageService } from '../storage/storage.service';
import { MediaService } from '../media/media.service';
import { MediaResolverService } from '../media/media-resolver.service';

@Module({
  controllers: [SystemSettingsController],
  providers: [StorageService, MediaService, MediaResolverService],
})
export class SystemSettingsModule {}
