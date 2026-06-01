import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  controllers: [RefundsController],
  providers: [RefundsService],
  imports: [InventoryModule],
})
export class RefundsModule {}
