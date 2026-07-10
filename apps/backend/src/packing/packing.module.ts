import { Module, forwardRef } from '@nestjs/common';
import { PackingController } from './packing.controller';
import { PackingService } from './packing.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  controllers: [PackingController],
  providers: [PackingService],
  imports: [forwardRef(() => OrdersModule)],
})
export class PackingModule {}
