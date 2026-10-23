import { Module, Global } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { CostingLotService } from './costing-lot.service';
import { CancelReturnStockService } from './cancel-return-stock.service';
import { OrderStockDeductService } from './order-stock-deduct.service';
import { StockReconciliationService } from './stock-reconciliation.service';
import { InitialPhysicalStockService } from './initial-physical-stock.service';

@Global()
@Module({
  providers: [StockService, StockRouterService, CostingLotService, CancelReturnStockService, OrderStockDeductService, StockReconciliationService, InitialPhysicalStockService],
  exports: [StockService, StockRouterService, CostingLotService, CancelReturnStockService, OrderStockDeductService, StockReconciliationService, InitialPhysicalStockService],
})
export class StockModule {}
