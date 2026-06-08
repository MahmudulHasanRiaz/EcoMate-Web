import { Module } from '@nestjs/common';
import { SizeChartsController } from './size-charts.controller';
import { SizeChartsService } from './size-charts.service';

@Module({
  controllers: [SizeChartsController],
  providers: [SizeChartsService],
  exports: [SizeChartsService],
})
export class SizeChartsModule {}
