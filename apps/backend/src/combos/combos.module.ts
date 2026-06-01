import { Module } from '@nestjs/common';
import { CombosController } from './combos.controller';
import { CombosService } from './combos.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [CombosController],
  providers: [CombosService, MediaService, StorageService],
  exports: [CombosService],
})
export class CombosModule {}
