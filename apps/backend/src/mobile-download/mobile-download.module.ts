import { Module } from '@nestjs/common';
import { MobileDownloadController } from './mobile-download.controller';

@Module({
  controllers: [MobileDownloadController],
})
export class MobileDownloadModule {}
