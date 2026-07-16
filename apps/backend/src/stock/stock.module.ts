import { Module, Global } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { CostingLotService } from './costing-lot.service';
import { CancelReturnStockService } from './cancel-return-stock.service';

@Global()
@Module({
  providers: [StockService, StockRouterService, CostingLotService, CancelReturnStockService],
  exports: [StockService, StockRouterService, CostingLotService, CancelReturnStockService],
})
export class StockModule {}
