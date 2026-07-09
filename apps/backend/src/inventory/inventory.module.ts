import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PhysicalInventoryController } from './physical-inventory.controller';
import { InventoryService } from './inventory.service';
import { ManagedStockLedgerService } from './managed-stock-ledger.service';

@Module({
  controllers: [InventoryController, PhysicalInventoryController],
  providers: [InventoryService, ManagedStockLedgerService],
  exports: [InventoryService, ManagedStockLedgerService],
})
export class InventoryModule {}
