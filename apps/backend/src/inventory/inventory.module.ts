import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PhysicalInventoryController } from './physical-inventory.controller';
import { InventoryService } from './inventory.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';
import { StockModule } from '../stock/stock.module';

@Module({
  controllers: [InventoryController, PhysicalInventoryController],
  providers: [InventoryService, ManagedStockLedgerService],
  exports: [InventoryService, ManagedStockLedgerService],
  imports: [StockModule],
})
export class InventoryModule {}
