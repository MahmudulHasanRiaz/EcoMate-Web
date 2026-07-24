import { Module } from '@nestjs/common';
import { MobileBuilderController } from './mobile-builder.controller';

@Module({
  controllers: [MobileBuilderController],
})
export class MobileBuilderModule {}
