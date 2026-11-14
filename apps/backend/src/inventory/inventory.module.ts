import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PhysicalInventoryController } from './physical-inventory.controller';
import { InventoryService } from './inventory.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';
import { ReconciliationFinderService } from '../reconciliation/reconciliation-finder.service';
import { ReconciliationApplyService } from '../reconciliation/reconciliation-apply.service';
import { ReconciliationFixAllService } from '../reconciliation/reconciliation-fix-all.service';
import { Q8SettleService } from '../reconciliation/q8-settle.service';
import { BackupModule } from '../backup/backup.module';
import { StockModule } from '../stock/stock.module';
import { StoresModule } from '../stores/stores.module';

@Module({
  controllers: [InventoryController, PhysicalInventoryController],
  providers: [
    InventoryService,
    ManagedStockLedgerService,
    ReconciliationFinderService,
    ReconciliationApplyService,
    ReconciliationFixAllService,
    Q8SettleService,
  ],
  exports: [
    InventoryService,
    ManagedStockLedgerService,
    ReconciliationFinderService,
    ReconciliationApplyService,
    ReconciliationFixAllService,
    Q8SettleService,
  ],
  // P5: inventory writers notify StockStatusSyncService post-commit.
  imports: [StockModule, BackupModule, StoresModule],
})
export class InventoryModule {}
