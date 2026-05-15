import { Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [SystemSettingsController],
  providers: [StorageService],
})
export class SystemSettingsModule {}
