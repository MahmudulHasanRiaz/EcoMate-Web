import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaResolverService } from './media-resolver.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaResolverService, StorageService],
  exports: [MediaService, MediaResolverService],
})
export class MediaModule {}
