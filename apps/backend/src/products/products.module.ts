import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, MediaService, StorageService],
})
export class ProductsModule {}
