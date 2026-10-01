import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SalesChannelController } from './sales-channel.controller';
import { SalesChannelService } from './sales-channel.service';
import { SourcePlatformsService } from './source-platforms.service';

@Module({
  imports: [PrismaModule],
  controllers: [SalesChannelController],
  providers: [SalesChannelService, SourcePlatformsService],
  exports: [SalesChannelService, SourcePlatformsService],
})
export class SalesChannelModule {}
