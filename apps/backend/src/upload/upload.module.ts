import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [UploadController],
  providers: [StorageService],
  exports: [StorageService],
})
export class UploadModule {}
