import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PhysicalInventoryController } from './physical-inventory.controller';
import { InventoryService } from './inventory.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';
import { StockModule } from '../stock/stock.module';
import { StoresModule } from '../stores/stores.module';

@Module({
  controllers: [InventoryController, PhysicalInventoryController],
  providers: [InventoryService, ManagedStockLedgerService],
  exports: [InventoryService, ManagedStockLedgerService],
  // P5: inventory writers notify StockStatusSyncService post-commit.
  imports: [StockModule, StoresModule],
})
export class InventoryModule {}
