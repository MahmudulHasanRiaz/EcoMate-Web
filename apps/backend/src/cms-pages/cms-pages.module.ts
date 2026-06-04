import { Module } from '@nestjs/common';
import { CmsPagesController } from './cms-pages.controller';
import { CmsPagesService } from './cms-pages.service';

@Module({
  controllers: [CmsPagesController],
  providers: [CmsPagesService],
  exports: [CmsPagesService],
})
export class CmsPagesModule {}
