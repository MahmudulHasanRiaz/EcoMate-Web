import { Module } from '@nestjs/common';
import { PackingController } from './packing.controller';
import { PackingService } from './packing.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  controllers: [PackingController],
  providers: [PackingService],
  imports: [OrdersModule],
})
export class PackingModule {}
