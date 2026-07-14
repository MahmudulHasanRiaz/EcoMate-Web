import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { MediaService } from '../media/media.service';
import { MediaResolverService } from '../media/media-resolver.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, MediaService, MediaResolverService, StorageService],
})
export class CategoriesModule {}
