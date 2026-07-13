import { Module, Global } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { CostingLotService } from './costing-lot.service';

@Global()
@Module({
  providers: [StockService, StockRouterService, CostingLotService],
  exports: [StockService, StockRouterService, CostingLotService],
})
export class StockModule {}
