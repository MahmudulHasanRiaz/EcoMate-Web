import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [UploadController],
  providers: [MediaService, StorageService],
  exports: [MediaService, StorageService],
})
export class UploadModule {}
