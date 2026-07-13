import { Module, Global } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';

@Global()
@Module({
  providers: [StockService, StockRouterService],
  exports: [StockService, StockRouterService],
})
export class StockModule {}
