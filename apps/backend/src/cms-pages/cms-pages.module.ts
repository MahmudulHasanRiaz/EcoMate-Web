import { Module } from '@nestjs/common';
import { CmsPagesController } from './cms-pages.controller';
import { CmsPagesService } from './cms-pages.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  controllers: [CmsPagesController],
  providers: [CmsPagesService],
  exports: [CmsPagesService],
})
export class CmsPagesModule {}
