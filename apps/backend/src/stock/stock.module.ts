import { Module, Global } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockRouterService } from './stock-router.service';
import { CostingLotService } from './costing-lot.service';
import { CancelReturnStockService } from './cancel-return-stock.service';
import { OrderStockDeductService } from './order-stock-deduct.service';
import { StockReconciliationService } from './stock-reconciliation.service';
import { StoresModule } from '../stores/stores.module';

@Global()
@Module({
  // P5: choke-point stock notify resolves StockStatusSyncService from here.
  // Acyclic: StoresModule imports only PrismaModule + its own queues.
  imports: [StoresModule],
  providers: [StockService, StockRouterService, CostingLotService, CancelReturnStockService, OrderStockDeductService, StockReconciliationService],
  exports: [StockService, StockRouterService, CostingLotService, CancelReturnStockService, OrderStockDeductService, StockReconciliationService],
})
export class StockModule {}
