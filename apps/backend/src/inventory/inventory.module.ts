import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PhysicalInventoryController } from './physical-inventory.controller';
import { InventoryService } from './inventory.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';
import { ReconciliationFinderService } from '../reconciliation/reconciliation-finder.service';
import { ReconciliationApplyService } from '../reconciliation/reconciliation-apply.service';
import { Q8SettleService } from '../reconciliation/q8-settle.service';
import { StockModule } from '../stock/stock.module';

@Module({
  controllers: [InventoryController, PhysicalInventoryController],
  providers: [
    InventoryService,
    ManagedStockLedgerService,
    ReconciliationFinderService,
    ReconciliationApplyService,
    Q8SettleService,
  ],
  exports: [
    InventoryService,
    ManagedStockLedgerService,
    ReconciliationFinderService,
    ReconciliationApplyService,
    Q8SettleService,
  ],
  imports: [StockModule],
})
export class InventoryModule {}
